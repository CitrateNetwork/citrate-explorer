/**
 * EXP-REDESIGN: the `/api/ledger` snapshot. It reads only what the node
 * serves: header walks always, r1007 methods only when detected. A test node
 * stands in for the RPC (the requester), as in rpcBatch.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildLedgerSnapshot, makeChainFeed, LEDGER_SOURCES } from "./ledger";
import { NO_R1007, type Requester } from "./r1007";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const hex = (n: number) => "0x" + n.toString(16);

function header(n: number, o: Record<string, unknown> = {}) {
  return {
    hash: H(n),
    number: hex(n),
    timestamp: hex(1_700_000_000 + n),
    parentHash: H(n - 1),
    selectedParentHash: H(n - 1),
    mergeParentHashes: [],
    blueScore: hex(n),
    blueWork: hex(n * 100),
    miner: "0x" + "aa".repeat(20),
    transactions: [] as unknown[],
    ...o,
  };
}

/** A node at height 10 with one side block (0x...64) at height 9, merged by 10. */
function node(extra: Record<string, (p: unknown[]) => unknown> = {}): { req: Requester; calls: string[] } {
  const calls: string[] = [];
  const side = header(0x64, { number: hex(9), blueScore: hex(9), blueWork: hex(850), selectedParentHash: H(8) });
  const blocks: Record<string, ReturnType<typeof header>> = {};
  for (let n = 1; n <= 10; n++) blocks[H(n)] = header(n);
  blocks[H(10)] = header(10, {
    mergeParentHashes: [H(0x64)],
    transactions: [{ hash: H(0xabc), from: "0x" + "11".repeat(20), to: null, value: "0xde0b6b3a7640000", input: "0x6080" }],
  });
  blocks[H(0x64)] = side;
  const req: Requester = async (method, params) => {
    calls.push(method);
    if (extra[method]) return extra[method](params);
    switch (method) {
      case "eth_blockNumber":
        return hex(10);
      case "eth_getBlockByNumber": {
        const n = Number(BigInt(params[0] as string));
        return blocks[H(n)] ?? null;
      }
      case "eth_getBlockByHash":
        return blocks[params[0] as string] ?? null;
      default: {
        const e = new Error("Method not found") as Error & { code: number };
        e.code = -32601;
        throw e;
      }
    }
  };
  return { req, calls };
}

const stats = async () => ({
  totalBlocks: null,
  blueBlocks: null,
  redBlocks: null,
  tipsCount: 2,
  currentTips: [H(10), H(0x64)],
  maxBlueScore: 10,
  height: 10,
  ghostdagParams: { k: 18, finalityDepth: 100 },
});

describe("buildLedgerSnapshot against today's node", () => {
  it("walks headers, adds the tips by hash, and calls no r1007 method", async () => {
    const { req, calls } = node();
    const s = await buildLedgerSnapshot({ req, dagStats: stats, capabilities: NO_R1007 }, { heights: 5, txLimit: 5 });
    expect(s.head).toBe(10);
    expect(s.window).toEqual({ fromHeight: 6, toHeight: 10 });
    const hs = s.blocks.map((b) => b.hash);
    expect(hs).toContain(H(10));
    expect(hs).toContain(H(6));
    expect(hs).toContain(H(0x64)); // tip fetched by hash
    expect(s.blocks.find((b) => b.hash === H(0x64))?.source).toBe("tip");
    expect(s.blocks.find((b) => b.hash === H(10))?.mergeParents).toEqual([H(0x64)]);
    expect(s.ghostdag).toBeNull();
    expect(s.finality).toBeNull();
    expect(s.chainChanges).toBeNull();
    expect(s.dag?.tipsCount).toBe(2);
    expect(s.dag?.counts).toBeNull();
    expect(calls.some((c) => c.startsWith("citrate_get") && c !== "citrate_getDagStats")).toBe(false);
  });

  it("lists the newest transactions with value in SALT", async () => {
    const { req } = node();
    const s = await buildLedgerSnapshot({ req, dagStats: stats, capabilities: NO_R1007 }, { heights: 5, txLimit: 5 });
    expect(s.transactions).toEqual([
      {
        hash: H(0xabc),
        from: "0x" + "11".repeat(20),
        to: null,
        valueSalt: "1",
        blockHash: H(10),
        blockHeight: 10,
        timestamp: 1_700_000_010,
        isCreate: true,
        methodId: null,
      },
    ]);
  });

  it("names a data source for every figure", () => {
    for (const k of ["blocks", "tips", "mergeRate", "producers", "transactions", "colors", "finality", "chainChanges", "blocksPerSlot", "siblings", "redRate"]) {
      expect(LEDGER_SOURCES[k as keyof typeof LEDGER_SOURCES]).toBeTruthy();
    }
  });
});

describe("buildLedgerSnapshot against an r1007 node", () => {
  it("adds siblings, GhostDAG data and finality when the methods exist", async () => {
    const { req } = node({
      citrate_getBlocksAtHeight: (p) => (p[0] === hex(9) ? [H(9), H(0x64)] : []),
      citrate_getGhostdagData: (p) =>
        p[0] === H(10)
          ? { blueScore: hex(10), blueWork: hex(1000), selectedParent: H(9), mergesetBlues: [H(9)], mergesetReds: [H(0x64)] }
          : { blueScore: "0x1", blueWork: "0x1", selectedParent: null, mergesetBlues: [], mergesetReds: [] },
      citrate_getFinalityStatus: () => ({ published: true, finalized: { height: "0x5", blockHash: H(5) }, pending: [] }),
    });
    const caps = { ...NO_R1007, blocksAtHeight: true, ghostdagData: true, finalityStatus: true };
    const tipless = async () => ({ ...(await stats()), currentTips: [H(10)] });
    const s = await buildLedgerSnapshot({ req, dagStats: tipless, capabilities: caps }, { heights: 5, txLimit: 5 });
    expect(s.blocks.find((b) => b.hash === H(0x64))?.source).toBe("sibling");
    expect(s.ghostdag?.[H(10)].mergesetReds).toEqual([H(0x64)]);
    expect(s.finality?.finalized?.height).toBe(5);
  });
});

describe("makeChainFeed", () => {
  it("records a selected-chain change between two observed tips", async () => {
    let t = 1000;
    const feed = makeChainFeed(() => t);
    const req: Requester = async (_m, p) => (p[0] === H(1) ? { removed: [H(1)], added: [H(2), H(3)] } : { removed: [], added: [] });
    await feed.observe(req, H(1));
    t = 2000;
    await feed.observe(req, H(3));
    expect(feed.snapshot()).toEqual({ since: 1000, events: [{ at: 2000, removed: [H(1)], added: [H(2), H(3)] }] });
  });
  it("records nothing while the chain only extends", async () => {
    const feed = makeChainFeed(() => 1);
    const req: Requester = async () => ({ removed: [], added: [H(2)] });
    await feed.observe(req, H(1));
    await feed.observe(req, H(2));
    expect(feed.snapshot().events).toEqual([]);
  });
});
