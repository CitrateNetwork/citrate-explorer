/**
 * explorer#40 / EXP-S1: a block displaced by a reorg is marked `superseded`
 * (never deleted). Reads must not serve it, nor transactions that only it
 * contains, as if they were canonical. Real SQL via PGlite; `getDb()` is pointed
 * at it so the repository runs unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { blocks, transactions, tokenTransfers } from "@/lib/db/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => holder.db, isDbEnabled: () => true }));

import {
  addressActivity,
  addressTokenTransfers,
  classifyHash,
  findNativeTransfers,
  findTokenTransfers,
  getBlockByHeight,
  getRecentBlocks,
  getTxByHash,
  indexerHead,
  searchTransactions,
  topHolders,
} from "./repository";

const h32 = (b: string) => "0x" + b.repeat(32);
const LIVE5 = h32("a5");
const DEAD5 = h32("d5");
const DEAD9 = h32("d9");
const T_LIVE = h32("71");
const T_DEAD = h32("7d");
const FROM = "0x" + "11".repeat(20);
const TO = "0x" + "22".repeat(20);
const TOKEN = "0x" + "33".repeat(20);

type Ctx = Awaited<ReturnType<typeof migratedPglite>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await migratedPglite();
  holder.db = ctx.db;
}, 60_000);
beforeEach(async () => {
  await ctx.truncateAll();
  await ctx.db.insert(blocks).values([
    { hash: LIVE5, height: 5, blueScore: 5, timestamp: 1005 },
    // A sibling displaced at the same height, with a higher blue score, and an
    // orphaned higher block: neither may surface.
    { hash: DEAD5, height: 5, blueScore: 6, timestamp: 1006, superseded: true },
    { hash: DEAD9, height: 9, blueScore: 9, timestamp: 1009, superseded: true },
  ]);
  await ctx.db.insert(transactions).values([
    { hash: T_LIVE, blockHash: LIVE5, blockHeight: 5, from: FROM, to: TO, value: "10", timestamp: 1005 },
    { hash: T_DEAD, blockHash: DEAD9, blockHeight: 9, from: FROM, to: TO, value: "99", timestamp: 1009 },
  ]);
  await ctx.db.insert(tokenTransfers).values([
    { txHash: T_LIVE, blockHash: LIVE5, blockHeight: 5, timestamp: 1005, token: TOKEN, standard: "erc20", from: FROM, to: TO, value: "1", logIndex: 0 },
    { txHash: T_DEAD, blockHash: DEAD9, blockHeight: 9, timestamp: 1009, token: TOKEN, standard: "erc20", from: FROM, to: TO, value: "2", logIndex: 0 },
  ]);
});
afterAll(async () => {
  await ctx.close();
});

const hashes = (rows: unknown) => (rows as { hash?: string; txHash?: string }[]).map((r) => r.hash ?? r.txHash);

describe("repository reads exclude superseded blocks", () => {
  it("recent blocks, head, and block-by-height", async () => {
    expect(hashes(await getRecentBlocks(10))).toEqual([LIVE5]);
    expect(Number(await indexerHead())).toBe(5);
    expect(await getBlockByHeight(5)).toMatchObject({ hash: LIVE5 });
    expect(await getBlockByHeight(9)).toBeNull();
  });

  it("transactions that only a superseded block contains", async () => {
    expect(await getTxByHash(T_DEAD)).toBeNull();
    expect(await getTxByHash(T_LIVE)).toMatchObject({ hash: T_LIVE });
    const s = await searchTransactions(FROM as Address);
    expect(hashes((s as { results: unknown[] }).results)).toEqual([T_LIVE]);
    const n = await findNativeTransfers({});
    expect((n as { transfers: { hash: string }[] }).transfers.map((t) => t.hash)).toEqual([T_LIVE]);
    expect((n as { coverage: { maxHeight: number } }).coverage.maxHeight).toBe(5);
    expect(await addressActivity(FROM as Address)).toMatchObject({ sent: 1, tokenSent: 1 });
  });

  it("token transfers in a superseded block", async () => {
    const t = await findTokenTransfers({ token: TOKEN });
    expect((t as { transfers: { txHash: string }[] }).transfers.map((x) => x.txHash)).toEqual([T_LIVE]);
    const a = await addressTokenTransfers(TO as Address);
    expect(hashes((a as { results: unknown[] }).results)).toEqual([T_LIVE]);
    const top = await topHolders(TOKEN as Address);
    expect((top as { holders: { transfers: number }[] }).holders).toEqual([{ holder: TO, transfers: 1 }]);
  });

  it("omni-search does not classify a superseded block or its-only transaction", async () => {
    expect(await classifyHash(LIVE5)).toBe("block");
    expect(await classifyHash(DEAD9)).toBe("unknown");
    expect(await classifyHash(T_DEAD)).toBe("unknown");
    expect(await classifyHash(T_LIVE)).toBe("transaction");
  });
});
