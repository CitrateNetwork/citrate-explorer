import { describe, it, expect } from "vitest";
import { getDagBlock, dagStats, isFinal, parseDagBlock } from "./rpc";
import type { DagStats } from "./dag";

const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

function fakeStats(maxBlueScore: number): DagStats {
  return {
    totalBlocks: 0,
    blueBlocks: 0,
    redBlocks: 0,
    tipsCount: 1,
    maxBlueScore,
    currentTips: [],
    height: 0,
    ghostdagParams: {
      k: 18,
      maxParents: 10,
      maxBlueScoreDiff: 1000,
      pruningWindow: 100000,
      finalityDepth: 100,
    },
  };
}

describe("isFinal boundary (WP-1.2, unit)", () => {
  it("is false at depth 99 and true at depth 100", () => {
    const stats = fakeStats(1000);
    expect(isFinal(901, stats)).toBe(false); // 1000-901 = 99
    expect(isFinal(900, stats)).toBe(true); // 1000-900 = 100
  });
});

describe("DAG RPC layer (WP-1.2, live)", () => {
  liveIt("getDagBlock('latest') exposes selectedParent + mergeParents", async () => {
    const block = await getDagBlock("latest");
    expect(block).not.toBeNull();
    expect(typeof block!.selectedParent).toBe("string");
    expect(Array.isArray(block!.mergeParents)).toBe(true);
    expect(block!.blueScore).toBeGreaterThanOrEqual(0);
  });

  liveIt("dagStats reports k=18, finalityDepth=100, and consistent tips", async () => {
    const stats = await dagStats();
    expect(stats.ghostdagParams.k).toBe(18);
    expect(stats.ghostdagParams.finalityDepth).toBe(100);
    expect(stats.tipsCount).toBeGreaterThanOrEqual(1);
    expect(stats.currentTips.length).toBe(stats.tipsCount);
  });

  liveIt("an old block is final against live stats", async () => {
    const stats = await dagStats();
    // A block 200 blue-score-equivalent heights back should be well past finality.
    const oldHeight = Math.max(1, stats.height - 200);
    const block = await getDagBlock(oldHeight);
    if (block) expect(isFinal(block.blueScore, stats)).toBe(true);
  });
});

describe("parseDagBlock — proposer vs miner attribution (CBF-S1 WP-3)", () => {
  // Mirrors the live 40204 shape: the node used to publish `miner` as the
  // proposer pubkey truncated to 20 bytes, so the explorer attributed every
  // block to 0x25b78e08309e0d4e0a4472512786ca7e1dac6e6a — an address nobody
  // controls — while the account that actually earned it was 0x0ecbcd85…363b.
  const PUBKEY =
    "0x25b78e08309e0d4e0a4472512786ca7e1dac6e6a3c9b1cab6b09a453ab6a8ad9";
  const COINBASE = "0x0ecbcd8557781161a41b34dee55ee5a00561363b";
  const TRUNCATED = "0x25b78e08309e0d4e0a4472512786ca7e1dac6e6a";

  const raw = {
    hash: "0xabc",
    number: "0x1",
    timestamp: "0x10",
    parentHash: "0xdef",
    miner: COINBASE,
    proposerPubkey: PUBKEY,
  };

  it("maps proposer to the full 32-byte consensus key, not a truncated address", () => {
    const b = parseDagBlock(raw);
    expect(b.proposer).toBe(PUBKEY);
    expect(b.proposer).not.toBe(TRUNCATED);
    // 0x + 64 hex chars
    expect(b.proposer).toHaveLength(66);
  });

  it("exposes the reward beneficiary separately as miner", () => {
    const b = parseDagBlock(raw);
    expect(b.miner).toBe(COINBASE);
    expect(b.miner).not.toBe(b.proposer);
  });

  it("falls back to legacy fields for blocks indexed from a pre-WP-3 node", () => {
    const legacy = parseDagBlock({
      hash: "0xabc",
      number: "0x1",
      timestamp: "0x10",
      parentHash: "0xdef",
      miner: TRUNCATED,
    });
    // Best available signal, and miner still reports what the node sent.
    expect(legacy.proposer).toBe(TRUNCATED);
    expect(legacy.miner).toBe(TRUNCATED);
  });
});
