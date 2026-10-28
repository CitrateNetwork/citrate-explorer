// The runbook's cutover sequence against a REAL Postgres: a fresh database, the smoke pass
// (`pnpm indexer:once`), then the continuous worker. The smoke pass ingests only the head. If it
// advanced the resume cursor, the worker would start at head+1 and genesis and every block below
// the head would never be indexed, while /api/health reported zero lag. The worker must index
// 0..head whatever state an earlier smoke pass (or a failed batch) left behind.
//
// The chain is a test double (vi.mock of the RPC layer); the database, the migrations, ingestBlock,
// the resume plan and the genesis guard are the production code.
//
// Runs only with TEST_DATABASE_URL (an admin URL to a THROWAWAY server: the test creates and drops
// its own database). Skipped in CI, which has no Postgres. Never point it at a real database.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ADMIN = process.env.TEST_DATABASE_URL;
const dbIt = ADMIN ? it : it.skip;

const HEAD = 5;
const hashAt = (h: number) => `0x${(h + 1).toString(16).padStart(64, "0")}`;

function fakeBlock(h: number) {
  return {
    hash: hashAt(h),
    height: h,
    blueScore: h,
    blueWork: String(h),
    selectedParent: h === 0 ? `0x${"0".repeat(64)}` : hashAt(h - 1),
    mergeParents: [],
    timestamp: 1_700_000_000 + h,
    baseFeePerGas: null,
    gasUsed: 0,
    gasLimit: 30_000_000,
    proposer: null,
    miner: null,
    txCount: 0,
    raw: { transactions: [] },
  };
}

vi.mock("@/lib/citrate/rpc", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/citrate/rpc")>();
  return {
    ...orig,
    getDagBlock: async (ref: number | "latest") => {
      const h = ref === "latest" ? HEAD : ref;
      return h >= 0 && h <= HEAD ? fakeBlock(h) : null;
    },
    dagStats: async () => ({ maxBlueScore: HEAD, ghostdagParams: { finalityDepth: 100 } }),
  };
});

vi.mock("@/lib/harness/client", () => ({
  harnessClient: () => ({ getBlockNumber: async () => BigInt(HEAD) }),
}));

const MIGRATIONS = join(__dirname, "..", "db", "migrations");
const DB_NAME = `fxexpl_smoke_${process.pid}`;

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

let url = "";

async function sql(text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text, params);
  } finally {
    await c.end();
  }
}

async function indexedHeights(): Promise<number[]> {
  const r = await sql(`SELECT DISTINCT height FROM blocks WHERE superseded = false ORDER BY height`);
  return r.rows.map((x) => Number(x.height));
}

/** The production wiring of scripts/indexer/run.ts, with the chain double behind it. */
async function harness() {
  const ingest = await import("./ingest");
  const loop = await import("./loop");
  const { getDb } = await import("@/lib/db/client");
  const { dbGenesisStore } = await import("./genesisStore");
  const { GenesisGate } = await import("./genesisGuard");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not set");
  const gate = () =>
    new GenesisGate(
      { rpc: { blockHashAt: async (h) => (h <= HEAD ? hashAt(h) : null) }, store: dbGenesisStore(db), expected: hashAt(0) },
      { intervalMs: 0 },
    );
  const ingested: number[] = [];
  const counting = (h: number) => {
    ingested.push(h);
    return ingest.ingestBlock(h);
  };
  return {
    ingest,
    smoke: () =>
      loop.indexerOnce({
        gate: gate(),
        headHeight: ingest.headHeight,
        ingestBlock: ingest.ingestBlock,
        reconcileFinality: ingest.reconcileFinality,
        dbEnabled: true,
      }),
    /** Starts the continuous worker from its resume plan and runs one tick. */
    async worker() {
      const plan = await ingest.resumePlan();
      const r = await loop.indexerTick(plan.next, {
        gate: gate(),
        headHeight: ingest.headHeight,
        ingestBlock: loop.skipIndexedThrough(plan.recoverThrough, ingest.isIndexed, counting),
        reconcileFinality: ingest.reconcileFinality,
        dbEnabled: true,
        parallel: 1,
      });
      return { plan, r };
    },
    ingested,
  };
}

describe("smoke pass then continuous worker (real Postgres)", () => {
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
    for (const stmt of migrationSql()) await sql(stmt);
    process.env.DATABASE_URL = url;
    vi.resetModules();
  });

  beforeEach(async () => {
    if (!ADMIN) return;
    await sql(`TRUNCATE blocks, dag_edges, indexer_state`);
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

  dbIt("fresh database: smoke, then the worker indexes genesis..head", async () => {
    const h = await harness();
    const s = await h.smoke();
    expect(s).toMatchObject({ allowed: true, head: HEAD, result: { persisted: true, height: HEAD } });
    // The smoke pass recorded the genesis but did not claim progress.
    const st = await sql(`SELECT last_height, genesis_hash FROM indexer_state WHERE id = 1`);
    expect(st.rows[0]).toMatchObject({ genesis_hash: hashAt(0) });
    expect(Number(st.rows[0].last_height)).toBe(0);

    const { plan, r } = await h.worker();
    expect(plan.next).toBe(0);
    expect(r).toEqual({ next: HEAD + 1, allowed: true });
    expect(await indexedHeights()).toEqual([0, 1, 2, 3, 4, 5]);
    // The head the smoke pass already wrote is not fetched again.
    expect(h.ingested).toEqual([0, 1, 2, 3, 4]);
  });

  dbIt("a cursor an older smoke pass advanced to the head: the worker still backfills from genesis", async () => {
    const h = await harness();
    await h.ingest.ingestBlock(HEAD); // the pre-fix smoke pass: cursor = HEAD, only HEAD indexed
    const { plan } = await h.worker();
    expect(plan).toEqual({ next: 0, recoverThrough: HEAD });
    expect(await indexedHeights()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(h.ingested).toEqual([0, 1, 2, 3, 4]);
  });

  dbIt("an interior hole below the cursor (a failed batch) is filled; indexed heights are not refetched", async () => {
    const h = await harness();
    for (const b of [0, 1, 3]) await h.ingest.ingestBlock(b);
    const { plan } = await h.worker();
    expect(plan).toEqual({ next: 2, recoverThrough: 3 });
    expect(await indexedHeights()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(h.ingested).toEqual([2, 4, 5]);
  });

  dbIt("a contiguous index resumes at cursor + 1 with nothing to recover", async () => {
    const h = await harness();
    for (let b = 0; b <= 2; b++) await h.ingest.ingestBlock(b);
    const { plan } = await h.worker();
    expect(plan).toEqual({ next: 3, recoverThrough: -1 });
    expect(h.ingested).toEqual([3, 4, 5]);
  });

  dbIt("an empty database starts at genesis", async () => {
    const h = await harness();
    const { plan } = await h.worker();
    expect(plan).toEqual({ next: 0, recoverThrough: -1 });
    expect(await indexedHeights()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
