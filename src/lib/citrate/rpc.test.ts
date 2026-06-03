import { describe, it, expect } from "vitest";
import { getDagBlock, dagStats, isFinal } from "./rpc";
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
