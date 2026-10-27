// Deploy-order safety against a REAL Postgres at the pre-0005 schema (migrations 0000-0004 only),
// the state production is in between merge (auto-deploy) and `pnpm db:migrate`:
//  - the indexer's resume query still works (it reads only last_height);
//  - the genesis guard refuses with `not_migrated` instead of crashing;
//  - /api/health's genesis read reports "not migrated" instead of throwing;
//  - after 0005, the same index records its genesis.
// Runs only with TEST_DATABASE_URL (an admin URL to a THROWAWAY server: the test creates and drops
// its own database). Skipped in CI, which has no Postgres. Never point it at a real database.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ADMIN = process.env.TEST_DATABASE_URL;
const dbIt = ADMIN ? it : it.skip;

const R1005 = "0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1";
const MIGRATIONS = join(__dirname, "..", "db", "migrations");
const DB_NAME = `fxexpl_premig_${process.pid}`;

function migrationSql(prefixes: string[]): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && prefixes.some((p) => f.startsWith(p)))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let url = "";

describe("pre-0005 schema (real Postgres)", () => {
  beforeAll(async () => {
    if (!ADMIN) return;
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();
    const u = new URL(ADMIN);
    u.pathname = `/${DB_NAME}`;
    url = u.toString();
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    for (const stmt of migrationSql(["0000", "0001", "0002", "0003", "0004"])) await c.query(stmt);
    // An r1005-shaped index: block 0 and a cursor.
    await c.query(
      `INSERT INTO blocks (hash, height, blue_score, timestamp) VALUES ($1, 0, 0, 0), ($2, 1, 1, 1)`,
      [R1005, `0x${"11".repeat(32)}`],
    );
    await c.query(`INSERT INTO indexer_state (id, last_height, last_blue_score) VALUES (1, 1, 1)`);
    await c.end();
    process.env.DATABASE_URL = url;
    vi.resetModules();
  });

  afterAll(async () => {
    if (!ADMIN) return;
    const { getDb } = await import("@/lib/db/client");
    const db = getDb() as unknown as { $client?: { end(): Promise<void> } } | null;
    await db?.$client?.end();
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.end();
    delete process.env.DATABASE_URL;
  });

  dbIt("the indexer resumes from the cursor without the genesis columns", async () => {
    const { resumeHeight } = await import("./ingest");
    await expect(resumeHeight()).resolves.toBe(2);
  });

  dbIt("the genesis guard refuses with not_migrated (no crash)", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { dbGenesisStore } = await import("./genesisStore");
    const { GenesisGate } = await import("./genesisGuard");
    const db = getDb();
    expect(db).not.toBeNull();
    const gate = new GenesisGate(
      { rpc: { blockHashAt: async () => R1005 }, store: dbGenesisStore(db!), expected: R1005 },
      { intervalMs: 0 },
    );
    expect(await gate.allow()).toBe(false);
    expect(gate.refusal?.code).toBe("not_migrated");
  });

  dbIt("/api/health's genesis read reports not migrated", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { readGenesisState } = await import("./genesisStore");
    await expect(readGenesisState(getDb())).resolves.toEqual({ migrated: false });
  });

  dbIt("after migration 0005 the same index records its genesis", async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    for (const stmt of migrationSql(["0005"])) await c.query(stmt);
    await c.end();
    const { getDb } = await import("@/lib/db/client");
    const { dbGenesisStore, readGenesisState } = await import("./genesisStore");
    const { checkGenesis } = await import("./genesisGuard");
    const v = await checkGenesis({ rpc: { blockHashAt: async () => R1005 }, store: dbGenesisStore(getDb()!), expected: R1005 });
    expect(v.action).toBe("record");
    await expect(readGenesisState(getDb())).resolves.toMatchObject({ migrated: true, recorded: R1005, status: "ok" });
  });
});
