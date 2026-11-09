import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import * as schema from "./schema";
import { enqueueJob } from "@/lib/verify/store";
import type { ChainDb } from "@/lib/indexer/types";

/**
 * Migration 0006 sets the verification tables' privileges itself, for the roles
 * production uses (DEPLOY / docs/ops/VERIFY_V2_MIGRATION_RUNBOOK.md):
 *   - citratescan_web (the Vercel app): reads, and only enqueues jobs;
 *   - citratescan_verify (the verify worker, not the table owner): appends records,
 *     moves job state, reads the indexer's creations. Never edits or empties records.
 * Roles that do not exist (dev, CI) are skipped.
 */
const VERIFY_TABLES = ["verification_jobs", "verified_contracts", "contract_proxies", "verification_state"];
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"];

describe("migration 0006 privileges", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle>;
  const has = async (role: string, table: string, priv: string) =>
    (await client.query<{ ok: boolean }>(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, priv])).rows[0].ok;
  const col = async (role: string, table: string, column: string, priv: string) =>
    (await client.query<{ ok: boolean }>(`select has_column_privilege($1, $2, $3, $4) as ok`, [role, `public.${table}`, column, priv])).rows[0].ok;
  const privs = async (role: string, table: string) => {
    const out: string[] = [];
    for (const p of PRIVS) if (await has(role, table, p)) out.push(p);
    return out;
  };

  beforeAll(async () => {
    client = new PGlite();
    // As on production: default privileges hand the web role SELECT on new tables.
    await client.exec(`create role citratescan_web; create role citratescan_verify;
      alter default privileges in schema public grant select on tables to citratescan_web;`);
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
  });
  afterAll(async () => client.close());

  it("the web role reads the verification tables and can only enqueue jobs", async () => {
    // INSERT is column-level (request columns only; see the next test), so not table-wide.
    expect(await privs("citratescan_web", "verification_jobs")).toEqual(["SELECT"]);
    expect(await privs("citratescan_web", "verified_contracts")).toEqual(["SELECT"]);
    expect(await privs("citratescan_web", "contract_proxies")).toEqual(["SELECT"]);
    expect(await privs("citratescan_web", "verification_state")).toEqual([]);
  });

  it("the web role inserts only the request columns of a job, never its outcome", async () => {
    for (const c of ["id", "kind", "origin", "chain_id", "genesis_hash", "address", "request", "source_hash"]) {
      expect(await col("citratescan_web", "verification_jobs", c, "INSERT")).toBe(true);
    }
    for (const c of ["status", "verified_contract_id", "match_type", "result_code", "result_message", "attempts", "worker_id", "locked_at", "started_at", "finished_at", "created_at"]) {
      expect(await col("citratescan_web", "verification_jobs", c, "INSERT")).toBe(false);
    }
    // As the web role: an enqueue the way store.enqueueJob writes it works; one that sets an outcome is refused.
    await client.exec("set role citratescan_web");
    try {
      await client.exec(`insert into verification_jobs (id, kind, origin, chain_id, genesis_hash, address, request, source_hash) values ('w1', 'verify', 'etherscan', 40204, null, '0x01', '{}', null)`);
      await expect(client.exec(`insert into verification_jobs (id, origin, chain_id, address, request, status, verified_contract_id) values ('w2', 'etherscan', 40204, '0x01', '{}', 'pass', 'x')`)).rejects.toThrow(/permission denied/);
    } finally {
      await client.exec("reset role");
    }
    const { rows } = await client.query<{ id: string; status: string }>("select id, status from verification_jobs order by id");
    expect(rows).toEqual([{ id: "w1", status: "pending" }]);
  });

  it("the web app's own enqueue (store.enqueueJob) works as the web role", async () => {
    await client.exec("set role citratescan_web");
    let id: string;
    try {
      id = await enqueueJob(db as unknown as ChainDb, { kind: "verify", origin: "etherscan", chainId: 40204, genesisHash: null, address: "0x02", request: { a: 1 } });
    } finally {
      await client.exec("reset role");
    }
    const { rows } = await client.query<{ status: string; attempts: number; request: string }>("select status, attempts, request from verification_jobs where id = $1", [id]);
    expect(rows).toEqual([{ status: "pending", attempts: 0, request: '{"a":1}' }]);
  });

  it("the worker role appends records and moves job state, but cannot edit, delete or empty anything", async () => {
    expect(await privs("citratescan_verify", "verified_contracts")).toEqual(["SELECT", "INSERT"]);
    expect(await privs("citratescan_verify", "contract_proxies")).toEqual(["SELECT", "INSERT"]);
    expect(await privs("citratescan_verify", "verification_state")).toEqual(["SELECT", "INSERT", "UPDATE"]);
    // Job rows: inserted (legacy requeue) and their state columns updated, never the request itself.
    expect(await privs("citratescan_verify", "verification_jobs")).toEqual(["SELECT", "INSERT"]);
    for (const c of ["status", "worker_id", "locked_at", "started_at", "attempts", "finished_at", "result_code", "result_message", "match_type", "verified_contract_id"]) {
      expect(await col("citratescan_verify", "verification_jobs", c, "UPDATE")).toBe(true);
    }
    for (const c of ["id", "request", "address", "genesis_hash", "source_hash", "origin", "kind"]) {
      expect(await col("citratescan_verify", "verification_jobs", c, "UPDATE")).toBe(false);
    }
    expect(await privs("citratescan_verify", "transactions")).toEqual(["SELECT"]);
    expect(await privs("citratescan_verify", "receipts")).toEqual(["SELECT"]);
  });

  it("neither role owns the verification tables (an owner could disable the triggers)", async () => {
    const { rows } = await client.query<{ tablename: string; tableowner: string }>(
      `select tablename, tableowner from pg_tables where schemaname = 'public' and tablename = any($1)`,
      [VERIFY_TABLES],
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(["citratescan_web", "citratescan_verify"]).not.toContain(r.tableowner);
  });
});
