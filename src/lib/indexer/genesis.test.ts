/**
 * EXP-S0 genesis guard. The index must record the chain's block 0 hash and the
 * indexer must refuse an RPC whose block 0 differs (a reroll would otherwise mix
 * two chains in one index). Runs against real SQL (PGlite with the repo's
 * migrations) and an in-test RPC that serves a fixed chain.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { blocks, indexerState } from "@/lib/db/schema";
import { checkGenesis, recordGenesis, genesisRefusalMessage, type GenesisRpc } from "./genesis";

const G_A = "0x" + "a1".repeat(32);
const G_B = "0x" + "b2".repeat(32);
const H5_A = "0x" + "c3".repeat(32);

/** RPC serving one chain: height -> hash. */
function chain(byHeight: Record<number, string>): GenesisRpc {
  const known = new Set(Object.values(byHeight).map((h) => h.toLowerCase()));
  return {
    blockHashAt: async (h) => byHeight[h] ?? null,
    hasBlock: async (hash) => known.has(hash.toLowerCase()),
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

async function seedBlock(hash: string, height: number) {
  await ctx.db.insert(blocks).values({ hash, height, blueScore: height, timestamp: 1_700_000_000 + height });
}
async function recorded(): Promise<string | null> {
  const [row] = await ctx.db.select().from(indexerState).where(eq(indexerState.id, 1));
  return row?.genesisHash ?? null;
}

describe("checkGenesis", () => {
  it("records block 0's hash on an empty index", async () => {
    const v = await checkGenesis(ctx.db, chain({ 0: G_A }));
    expect(v).toMatchObject({ ok: true, genesis: G_A, action: "recorded" });
    expect(await recorded()).toBe(G_A);
  });

  it("passes when the recorded genesis matches the RPC (case-insensitive)", async () => {
    await checkGenesis(ctx.db, chain({ 0: G_A }));
    const v = await checkGenesis(ctx.db, chain({ 0: G_A.toUpperCase().replace("0X", "0x") }));
    expect(v).toMatchObject({ ok: true, action: "matched" });
  });

  it("refuses when the RPC's block 0 differs from the recorded genesis", async () => {
    await checkGenesis(ctx.db, chain({ 0: G_A }));
    const v = await checkGenesis(ctx.db, chain({ 0: G_B }));
    expect(v).toMatchObject({ ok: false, reason: "genesis_mismatch", recordedGenesis: G_A, rpcGenesis: G_B });
    expect(await recorded()).toBe(G_A);
  });

  it("adopts the RPC genesis for a pre-guard index whose block 0 matches", async () => {
    await seedBlock(G_A, 0);
    await seedBlock(H5_A, 5);
    const v = await checkGenesis(ctx.db, chain({ 0: G_A, 5: H5_A }));
    expect(v).toMatchObject({ ok: true, action: "adopted", genesis: G_A });
    expect(await recorded()).toBe(G_A);
  });

  it("refuses a pre-guard index that holds another chain's block 0", async () => {
    await seedBlock(G_A, 0);
    const v = await checkGenesis(ctx.db, chain({ 0: G_B }));
    expect(v).toMatchObject({ ok: false, reason: "index_not_this_chain" });
    expect(await recorded()).toBeNull();
  });

  it("without a block 0 row, adopts only if the RPC knows the lowest indexed block", async () => {
    await seedBlock(H5_A, 5);
    const other = await checkGenesis(ctx.db, chain({ 0: G_B }));
    expect(other).toMatchObject({ ok: false, reason: "index_not_this_chain" });
    expect(await recorded()).toBeNull();

    const same = await checkGenesis(ctx.db, chain({ 0: G_A, 5: H5_A }));
    expect(same).toMatchObject({ ok: true, action: "adopted" });
  });

  it("ignores superseded rows when choosing the block to compare", async () => {
    await ctx.db.insert(blocks).values({ hash: G_B, height: 0, blueScore: 0, timestamp: 1, superseded: true });
    await seedBlock(H5_A, 5);
    const v = await checkGenesis(ctx.db, chain({ 0: G_A, 5: H5_A }));
    expect(v).toMatchObject({ ok: true, action: "adopted" });
  });

  it("throws (retryable) when the RPC serves no block 0", async () => {
    await expect(checkGenesis(ctx.db, chain({}))).rejects.toThrow(/block 0/);
    expect(await recorded()).toBeNull();
  });
});

describe("recordGenesis", () => {
  it("is write-once: a second hash never overwrites the first", async () => {
    expect(await recordGenesis(ctx.db, G_A)).toBe(G_A);
    expect(await recordGenesis(ctx.db, G_B)).toBe(G_A);
    expect(await recorded()).toBe(G_A);
  });

  it("keeps an existing cursor when it records", async () => {
    await ctx.db.insert(indexerState).values({ id: 1, lastHeight: 42, lastBlueScore: 40 });
    await recordGenesis(ctx.db, G_A);
    const [row] = await ctx.db.select().from(indexerState);
    expect(row).toMatchObject({ lastHeight: 42, genesisHash: G_A });
  });
});

describe("genesisRefusalMessage", () => {
  it("names both hashes and the reset command", () => {
    const msg = genesisRefusalMessage({
      ok: false,
      reason: "genesis_mismatch",
      recordedGenesis: G_A,
      rpcGenesis: G_B,
      detail: "",
    });
    expect(msg).toContain(G_A);
    expect(msg).toContain(G_B);
    expect(msg).toContain("pnpm indexer:reset --genesis");
    expect(msg).toContain("genesis_mismatch");
  });
});
