import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { contractVerifications, verificationJobs, verifiedContracts } from "@/lib/db/schema";
import { migratedPglite } from "@/lib/db/tests/pglite";
import type { ChainDb } from "@/lib/indexer/types";
import {
  appendVerified,
  bestMatch,
  claimNextJob,
  enqueueJob,
  finishJob,
  getJob,
  listMatches,
  type NewVerifiedRow,
} from "./store";

/**
 * EXP-S2 store v2 against real Postgres (PGlite) with the repo's migrations:
 * append-only records, random ids, best-match ordering, the job queue, and the
 * forward migration of contract_verifications.
 */

const MIGRATIONS = join(__dirname, "..", "db", "migrations");
const G1 = "0x" + "a1".repeat(32);
const G2 = "0x" + "b2".repeat(32);
const ADDR = "0x" + "c3".repeat(20);
const CODE_HASH = "0x" + "d4".repeat(32);

/** The Postgres error message behind a rejected drizzle query (drizzle wraps it in `cause`). */
async function pgError(q: PromiseLike<unknown>): Promise<string> {
  try {
    await q;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return `${err.message} ${err.cause?.message ?? ""}`;
  }
  return "query succeeded";
}

function record(o: Partial<NewVerifiedRow> = {}): NewVerifiedRow {
  return {
    chainId: 40204,
    genesisHash: G1,
    address: ADDR,
    runtimeCodeHash: CODE_HASH,
    runtimeMaskedHash: "0x" + "e5".repeat(32),
    runtimeCodeLength: 100,
    matchType: "full",
    runtimeMatch: "full",
    creationMatch: null,
    sourceFormat: "solidity-standard-json-input",
    contractName: "A",
    fullyQualifiedName: "src/A.sol:A",
    stdJsonInput: "{}",
    ...o,
  };
}

const job = (address = ADDR) => ({
  kind: "verify" as const,
  origin: "etherscan" as const,
  chainId: 40204,
  genesisHash: G1,
  address,
  request: { address, compilerVersion: "0.8.26" },
});

describe("verification store v2 (PGlite)", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  let db: ChainDb;

  beforeAll(async () => {
    ctx = await migratedPglite();
    db = ctx.db as unknown as ChainDb;
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => ctx.truncateAll());

  it("verified records are append-only: UPDATE and DELETE are rejected by the database", async () => {
    const id = await appendVerified(db, record());
    expect(await pgError(db.update(verifiedContracts).set({ matchType: "partial" }).where(eq(verifiedContracts.id, id)))).toMatch(/append-only/);
    expect(await pgError(db.delete(verifiedContracts).where(eq(verifiedContracts.id, id)))).toMatch(/append-only/);
    const [row] = await db.select().from(verifiedContracts).where(eq(verifiedContracts.id, id));
    expect(row.matchType).toBe("full");
  });

  it("job ids are random UUIDs: identical submissions get distinct ids", async () => {
    const a = await enqueueJob(db, job());
    const b = await enqueueJob(db, job());
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await getJob(db, a))?.status).toBe("pending");
    expect((await getJob(db, b))?.status).toBe("pending");
  });

  it("a later failing submission for the same contract leaves the passing job and record as they were", async () => {
    const first = await enqueueJob(db, job());
    const claimed = await claimNextJob(db, "w1", 60_000);
    const recId = await appendVerified(db, record({ jobId: first }));
    await finishJob(db, claimed!.id, "w1", { status: "pass", code: "verified", message: "Full match", matchType: "full", verifiedContractId: recId });

    const second = await enqueueJob(db, job());
    const c2 = await claimNextJob(db, "w1", 60_000);
    expect(c2?.id).toBe(second);
    await finishJob(db, second, "w1", { status: "fail", code: "no_match", message: "no match" });

    const j1 = await getJob(db, first);
    expect(j1?.status).toBe("pass");
    expect(j1?.verifiedContractId).toBe(recId);
    expect((await getJob(db, second))?.status).toBe("fail");
    const best = await bestMatch(db, { genesisHash: G1, address: ADDR, runtimeCodeHash: CODE_HASH });
    expect(best?.id).toBe(recId);
    expect(best?.matchType).toBe("full");
  });

  it("best match first: full > partial > similar, then creation full > partial > unchecked, then earliest", async () => {
    const similar = await appendVerified(db, record({ matchType: "similar", runtimeMatch: "full" }));
    const partial = await appendVerified(db, record({ matchType: "partial", runtimeMatch: "partial", creationMatch: "full" }));
    const fullNoCreation = await appendVerified(db, record({ matchType: "full", creationMatch: null }));
    const fullCreation = await appendVerified(db, record({ matchType: "full", creationMatch: "full" }));
    const fullCreationLater = await appendVerified(db, record({ matchType: "full", creationMatch: "full" }));
    const order = (await listMatches(db, { genesisHash: G1, address: ADDR, runtimeCodeHash: CODE_HASH })).map((r) => r.id);
    expect(order).toEqual([fullCreation, fullCreationLater, fullNoCreation, partial, similar]);
  });

  it("keyed by genesis and runtime code hash: another chain or other code is not a match", async () => {
    await appendVerified(db, record({ genesisHash: G2 }));
    await appendVerified(db, record({ runtimeCodeHash: "0x" + "ff".repeat(32) }));
    expect(await bestMatch(db, { genesisHash: G1, address: ADDR, runtimeCodeHash: CODE_HASH })).toBeNull();
    const mine = await appendVerified(db, record());
    expect((await bestMatch(db, { genesisHash: G1, address: ADDR.toUpperCase().replace("0X", "0x"), runtimeCodeHash: CODE_HASH }))?.id).toBe(mine);
  });

  it("a legacy record (no genesis) is only a fallback when no v2 record exists", async () => {
    await db.insert(verifiedContracts).values({
      id: "legacy_x",
      chainId: 40204,
      genesisHash: null,
      address: ADDR,
      matchType: "full",
      runtimeMatch: "full",
      sourceFormat: "legacy",
      legacyGuid: "x",
      legacySource: "contract A {}",
    });
    expect((await bestMatch(db, { genesisHash: G1, address: ADDR, runtimeCodeHash: CODE_HASH }))?.id).toBe("legacy_x");
    const v2 = await appendVerified(db, record({ matchType: "partial", runtimeMatch: "partial" }));
    expect((await bestMatch(db, { genesisHash: G1, address: ADDR, runtimeCodeHash: CODE_HASH }))?.id).toBe(v2);
  });

  it("claims oldest first, never the same job twice, and reclaims a job whose lease expired", async () => {
    const a = await enqueueJob(db, job());
    const b = await enqueueJob(db, job());
    const c1 = await claimNextJob(db, "w1", 60_000);
    const c2 = await claimNextJob(db, "w2", 60_000);
    expect([c1?.id, c2?.id]).toEqual([a, b]);
    expect(c1?.attempts).toBe(1);
    expect(await claimNextJob(db, "w3", 60_000)).toBeNull();

    // w1 died: backdate its lease; another worker takes the job over.
    await db.execute(sql`update verification_jobs set locked_at = now() - interval '1 hour' where id = ${a}`);
    const again = await claimNextJob(db, "w3", 60_000);
    expect(again?.id).toBe(a);
    expect(again?.attempts).toBe(2);

    // The dead worker's late result is ignored; only the current claimant's lands.
    await finishJob(db, a, "w1", { status: "fail", code: "x", message: "stale" });
    expect((await getJob(db, a))?.status).toBe("running");
    await finishJob(db, a, "w3", { status: "pass", code: "verified", message: "ok" });
    expect((await getJob(db, a))?.status).toBe("pass");
  });
});

describe("migration 0006 carries contract_verifications forward", () => {
  let dir: string;
  let client: PGlite;

  beforeAll(() => {
    // A migrations folder that stops at 0005, to seed rows the way production has them.
    dir = mkdtempSync(join(tmpdir(), "mig-"));
    cpSync(MIGRATIONS, dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((e) => e.tag < "0006");
    writeFileSync(journalPath, JSON.stringify(journal));
  });
  afterAll(async () => {
    await client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies every guid into the job queue and every passing row into verified_contracts, leaving the old table intact", async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: dir });
    await db.insert(contractVerifications).values([
      { guid: "vrf_full", address: "0xAbC0000000000000000000000000000000000001", status: "pass", matchType: "full", compilerVersion: "v0.8.26+commit.8a97fa7a", contractName: "src/A.sol:A", source: "{\"language\":\"Solidity\"}", abi: "[]", message: "Full match", verifiedAt: new Date("2026-10-01T00:00:00Z") },
      { guid: "vrf_old", address: "0xabc0000000000000000000000000000000000002", status: "pass", matchType: null, compilerVersion: "v0.8.20+commit.a1b79de6", contractName: "B.sol:B", source: "contract B {}", abi: "[]", message: "ok" },
      { guid: "vrf_fail", address: "0xabc0000000000000000000000000000000000001", status: "fail", message: "no contract's bytecode matched" },
      { guid: "vrf_pending", address: "0xabc0000000000000000000000000000000000003", status: "pending" },
    ]);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    const old = await db.select().from(contractVerifications);
    expect(old).toHaveLength(4);

    const jobs = await db.select().from(verificationJobs).orderBy(verificationJobs.id);
    expect(jobs.map((j) => [j.id, j.status, j.origin])).toEqual([
      ["vrf_fail", "fail", "legacy"],
      ["vrf_full", "pass", "legacy"],
      ["vrf_old", "pass", "legacy"],
      ["vrf_pending", "fail", "legacy"],
    ]);
    expect(jobs.find((j) => j.id === "vrf_pending")?.resultMessage).toMatch(/resubmit/);
    expect(jobs.find((j) => j.id === "vrf_full")?.verifiedContractId).toBe("legacy_vrf_full");

    const recs = await db.select().from(verifiedContracts).orderBy(verifiedContracts.id);
    expect(recs.map((r) => [r.id, r.address, r.matchType, r.genesisHash, r.legacyGuid])).toEqual([
      ["legacy_vrf_full", "0xabc0000000000000000000000000000000000001", "full", null, "vrf_full"],
      // A legacy pass with no recorded match type is not presented as full.
      ["legacy_vrf_old", "0xabc0000000000000000000000000000000000002", "partial", null, "vrf_old"],
    ]);
    expect(recs[0].contractName).toBe("A");
    expect(recs[0].fullyQualifiedName).toBe("src/A.sol:A");
    expect(recs[0].legacySource).toBe("{\"language\":\"Solidity\"}");
  });
});
