/**
 * explorer#40 / EXP-S1 ingest write path against real SQL (PGlite with the
 * repo's migrations) and an in-test chain source:
 *  - a block lands whole or not at all (a receipt read error fails the height,
 *    so the scheduler retries it, instead of committing a block without receipts);
 *  - a reorg re-ingest moves the transaction to the winning block (it used to
 *    keep the stale block hash: `onConflictDoNothing`), refreshes its receipt,
 *    and never duplicates logs;
 *  - the cursor is monotonic and owned by the loop, not by each ingest.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { blocks, indexerState, logs, receipts, transactions } from "@/lib/db/schema";
import { parseDagBlock, type DagBlock, type RawCitrateTx } from "@/lib/citrate/rpc";
import { advanceCursor, ingestBlock, type ChainSource, type IngestReceipt } from "./ingest";

const h32 = (b: string) => "0x" + b.repeat(32);
const A5 = h32("a5");
const B5 = h32("b5");
const C6 = h32("c6");
const T = h32("71");
const FROM = "0x" + "11".repeat(20);
const TO = "0x" + "22".repeat(20);

function tx(hash: string, index = 0): RawCitrateTx {
  return { hash, from: FROM, to: TO, value: "0x1", nonce: "0x0", gas: "0x5208", transactionIndex: `0x${index.toString(16)}` };
}
function block(hash: string, height: number, txs: RawCitrateTx[] = []): DagBlock {
  return parseDagBlock({
    hash,
    number: `0x${height.toString(16)}`,
    timestamp: `0x${(1_700_000_000 + height).toString(16)}`,
    parentHash: h32("00"),
    blueScore: `0x${height.toString(16)}`,
    transactions: txs,
  });
}
function receipt(over: Partial<IngestReceipt> = {}): IngestReceipt {
  return {
    status: "success",
    gasUsed: 21_000n,
    cumulativeGasUsed: 21_000n,
    contractAddress: null,
    logs: [{ address: TO, topics: [h32("e0")], data: "0x", logIndex: 0 }],
    ...over,
  };
}

/** A chain source whose blocks/receipts the test sets per case. */
function source(blocksByRef: Record<string, DagBlock>, receiptFor: (hash: string) => IngestReceipt): ChainSource {
  return {
    block: async (ref) => blocksByRef[String(ref)] ?? null,
    finalityStats: async () => {
      throw new Error("stats unavailable in this test");
    },
    receipt: async (hash) => receiptFor(hash),
    tokenMeta: async () => ({}),
  };
}

type Ctx = Awaited<ReturnType<typeof migratedPglite>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await migratedPglite();
}, 60_000);
beforeEach(async () => {
  await ctx.truncateAll();
});
afterAll(async () => {
  await ctx.close();
});

const txRow = async (hash: string) => (await ctx.db.select().from(transactions).where(eq(transactions.hash, hash)))[0];

describe("ingestBlock is all-or-nothing", () => {
  it("a receipt read error fails the height and writes nothing", async () => {
    const src = source({ 5: block(A5, 5, [tx(T)]) }, () => {
      throw new Error("receipt not available");
    });
    await expect(ingestBlock(5, { db: ctx.db, source: src })).rejects.toThrow(/receipt/);
    expect(await ctx.db.select().from(blocks)).toHaveLength(0);
    expect(await ctx.db.select().from(transactions)).toHaveLength(0);

    // The retry lands the whole block.
    const ok = source({ 5: block(A5, 5, [tx(T)]) }, () => receipt());
    const res = await ingestBlock(5, { db: ctx.db, source: ok });
    expect(res).toMatchObject({ persisted: true, hash: A5, txCount: 1 });
    expect(await ctx.db.select().from(receipts)).toHaveLength(1);
    expect(await ctx.db.select().from(logs)).toHaveLength(1);
  });

  it("fails when the RPC has no block at a height it reported", async () => {
    await expect(ingestBlock(9, { db: ctx.db, source: source({}, () => receipt()) })).rejects.toThrow(/no block at height 9/);
  });
});

describe("reorg re-ingest", () => {
  it("moves the transaction to the winning block and refreshes its receipt", async () => {
    await ingestBlock(5, { db: ctx.db, source: source({ 5: block(A5, 5, [tx(T)]) }, () => receipt()) });
    expect((await txRow(T)).blockHash).toBe(A5);

    const res = await ingestBlock(5, {
      db: ctx.db,
      source: source({ 5: block(B5, 5, [tx(T, 3)]) }, () => receipt({ status: "reverted", gasUsed: 30_000n })),
    });
    expect(res.superseded).toBe(1);
    const [a] = await ctx.db.select().from(blocks).where(eq(blocks.hash, A5));
    expect(a.superseded).toBe(true);
    expect(await txRow(T)).toMatchObject({ blockHash: B5, blockHeight: 5, txIndex: 3 });
    const [r] = await ctx.db.select().from(receipts).where(eq(receipts.txHash, T));
    expect(r).toMatchObject({ status: 0, gasUsed: 30_000 });
    expect(await ctx.db.select().from(logs).where(eq(logs.txHash, T))).toHaveLength(1);
  });

  it("re-ingesting the same block does not duplicate logs", async () => {
    const src = source({ 5: block(A5, 5, [tx(T)]) }, () => receipt());
    await ingestBlock(5, { db: ctx.db, source: src });
    await ingestBlock(5, { db: ctx.db, source: src });
    expect(await ctx.db.select().from(logs)).toHaveLength(1);
    expect(await ctx.db.select().from(blocks)).toHaveLength(1);
  });

  it("a transaction in a live block is not moved by another live block", async () => {
    await ingestBlock(5, { db: ctx.db, source: source({ 5: block(A5, 5, [tx(T)]) }, () => receipt()) });
    await ingestBlock(6, { db: ctx.db, source: source({ 6: block(C6, 6, [tx(T)]) }, () => receipt()) });
    expect((await txRow(T)).blockHash).toBe(A5);
  });
});

describe("cursor", () => {
  it("ingestBlock does not move the cursor; advanceCursor is monotonic", async () => {
    await ingestBlock(5, { db: ctx.db, source: source({ 5: block(A5, 5) }, () => receipt()) });
    expect(await ctx.db.select().from(indexerState)).toHaveLength(0);

    await advanceCursor(ctx.db, 10);
    await advanceCursor(ctx.db, 4);
    const [s] = await ctx.db.select().from(indexerState);
    expect(s.lastHeight).toBe(10);
    await advanceCursor(ctx.db, 12);
    expect((await ctx.db.select().from(indexerState))[0].lastHeight).toBe(12);
  });

  it("advanceCursor keeps the recorded genesis", async () => {
    await ctx.db.insert(indexerState).values({ id: 1, genesisHash: h32("99") });
    await advanceCursor(ctx.db, 3);
    expect((await ctx.db.select().from(indexerState))[0]).toMatchObject({ lastHeight: 3, genesisHash: h32("99") });
  });
});
