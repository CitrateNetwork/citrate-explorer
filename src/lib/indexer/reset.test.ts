/**
 * EXP-S0 `pnpm indexer:reset --genesis <hash> --confirm`: truncates the chain
 * tables in one transaction and re-seeds `indexer_state` with the new genesis.
 * Nothing is deleted without `--confirm`. User tables are never touched.
 * Real SQL via PGlite with the repo's migrations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedPglite } from "@/lib/db/tests/pglite";
import {
  blocks,
  dagEdges,
  transactions,
  receipts,
  logs,
  tokenTransfers,
  tokens,
  indexerState,
  watchlist,
  contractVerifications,
} from "@/lib/db/schema";
import { checkGenesis, type GenesisRpc } from "./genesis";
import { CHAIN_TABLE_NAMES, chainIndexCounts, parseResetArgs, resetChainIndex, runReset } from "./reset";

const G_OLD = "0x" + "11".repeat(32);
const G_NEW = "0x" + "22".repeat(32);
const TX = "0x" + "33".repeat(32);

const rpcWithGenesis = (g: string | null): GenesisRpc => ({
  blockHashAt: async (h) => (h === 0 ? g : null),
  hasBlock: async (hash) => hash === g,
});

type Ctx = Awaited<ReturnType<typeof migratedPglite>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await migratedPglite();
}, 60_000);
beforeEach(async () => {
  await ctx.truncateAll();
  // An index of the old chain, plus user rows that must survive.
  await ctx.db.insert(blocks).values({ hash: G_OLD, height: 0, blueScore: 0, timestamp: 1 });
  await ctx.db.insert(dagEdges).values({ childHash: G_OLD, parentHash: "0x00", kind: "selected_parent" });
  await ctx.db.insert(transactions).values({ hash: TX, blockHash: G_OLD, blockHeight: 0, from: "0xaa" });
  await ctx.db.insert(receipts).values({ txHash: TX, status: 1 });
  await ctx.db.insert(logs).values({ txHash: TX, logIndex: 0, address: "0xbb" });
  await ctx.db.insert(tokenTransfers).values({ txHash: TX, token: "0xbb", from: "0xaa", to: "0xcc", logIndex: 0 });
  await ctx.db.insert(tokens).values({ address: "0xbb", type: "erc20" });
  await ctx.db.insert(indexerState).values({ id: 1, lastHeight: 900, lastBlueScore: 880, genesisHash: G_OLD });
  await ctx.db.insert(watchlist).values({ subject: "sub-1", userAddress: "0xaa", target: "ciphertext" });
  await ctx.db.insert(contractVerifications).values({ guid: "g-1", address: "0xbb" });
});
afterAll(async () => {
  await ctx.close();
});

const quiet = { log: () => {}, error: () => {} };

describe("parseResetArgs", () => {
  it("requires --genesis as a 32-byte hex hash", () => {
    expect(() => parseResetArgs([])).toThrow(/--genesis/);
    expect(() => parseResetArgs(["--genesis", "0x1234"])).toThrow(/32-byte/);
    expect(() => parseResetArgs(["--genesis"])).toThrow(/--genesis/);
  });

  it("defaults to a dry run and lower-cases the hash", () => {
    expect(parseResetArgs(["--genesis", G_NEW.toUpperCase().replace("0X", "0x")])).toEqual({
      genesis: G_NEW,
      confirm: false,
      skipRpcCheck: false,
    });
    expect(parseResetArgs(["--genesis", G_NEW, "--confirm"]).confirm).toBe(true);
    expect(parseResetArgs([`--genesis=${G_NEW}`, "--confirm", "--skip-rpc-check"])).toEqual({
      genesis: G_NEW,
      confirm: true,
      skipRpcCheck: true,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseResetArgs(["--genesis", G_NEW, "--force"])).toThrow(/--force/);
  });
});

describe("resetChainIndex", () => {
  it("empties every chain table, seeds the new genesis, and keeps user tables", async () => {
    const before = await chainIndexCounts(ctx.db);
    expect(before.blocks).toBe(1);

    await resetChainIndex(ctx.db, G_NEW);

    const after = await chainIndexCounts(ctx.db);
    for (const t of CHAIN_TABLE_NAMES) expect(after[t], t).toBe(t === "indexer_state" ? 1 : 0);
    const [state] = await ctx.db.select().from(indexerState);
    expect(state).toMatchObject({ id: 1, lastHeight: 0, lastBlueScore: 0, genesisHash: G_NEW });
    expect(await ctx.db.select().from(watchlist)).toHaveLength(1);
    expect(await ctx.db.select().from(contractVerifications)).toHaveLength(1);

    // The guard now accepts the new chain and refuses the old one.
    expect(await checkGenesis(ctx.db, rpcWithGenesis(G_NEW))).toMatchObject({ ok: true, action: "matched" });
    expect(await checkGenesis(ctx.db, rpcWithGenesis(G_OLD))).toMatchObject({ ok: false, reason: "genesis_mismatch" });
  });
});

describe("runReset", () => {
  it("without --confirm deletes nothing and exits 0", async () => {
    const code = await runReset({ argv: ["--genesis", G_NEW], db: ctx.db, rpc: rpcWithGenesis(G_NEW), ...quiet });
    expect(code).toBe(0);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(1);
    const [state] = await ctx.db.select().from(indexerState);
    expect(state.genesisHash).toBe(G_OLD);
  });

  it("with --confirm resets when the RPC serves the given genesis", async () => {
    const code = await runReset({ argv: ["--genesis", G_NEW, "--confirm"], db: ctx.db, rpc: rpcWithGenesis(G_NEW), ...quiet });
    expect(code).toBe(0);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(0);
  });

  it("refuses (exit 4, nothing deleted) when the RPC's block 0 is not --genesis", async () => {
    const code = await runReset({ argv: ["--genesis", G_NEW, "--confirm"], db: ctx.db, rpc: rpcWithGenesis(G_OLD), ...quiet });
    expect(code).toBe(4);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(1);
  });

  it("refuses when the RPC is unreachable, unless --skip-rpc-check", async () => {
    const down: GenesisRpc = {
      blockHashAt: async () => {
        throw new Error("ECONNREFUSED");
      },
      hasBlock: async () => false,
    };
    expect(await runReset({ argv: ["--genesis", G_NEW, "--confirm"], db: ctx.db, rpc: down, ...quiet })).toBe(4);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(1);
    expect(
      await runReset({ argv: ["--genesis", G_NEW, "--confirm", "--skip-rpc-check"], db: ctx.db, rpc: down, ...quiet }),
    ).toBe(0);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(0);
  });

  it("exits 2 on bad arguments", async () => {
    expect(await runReset({ argv: ["--confirm"], db: ctx.db, rpc: rpcWithGenesis(G_NEW), ...quiet })).toBe(2);
    expect((await chainIndexCounts(ctx.db)).blocks).toBe(1);
  });
});
