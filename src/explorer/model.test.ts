/**
 * EXP-REDESIGN: the pure GhostDAG view model behind the direction-B screens.
 * Every figure on the home and DAG pages is computed here from real RPC
 * records, so the rules (which blocks count, what is "unknown") are pinned.
 */
import { describe, expect, it } from "vitest";
import {
  deriveSelectedChain,
  colorBlocks,
  mergedBy,
  mergeRate,
  redRate,
  producerShare,
  blocksPerSlot,
  finalityRuler,
  finalityOf,
  dagLayout,
  anticoneInWindow,
  type LedgerBlock,
} from "./model";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

function blk(n: number, o: Partial<LedgerBlock> = {}): LedgerBlock {
  return {
    hash: H(n),
    height: n,
    blueScore: n,
    blueWork: String(n * 10),
    selectedParent: n > 1 ? H(n - 1) : null,
    mergeParents: [],
    timestamp: 1_700_000_000 + n,
    txCount: 0,
    miner: null,
    slot: null,
    ...o,
  };
}

// 1 <- 2 <- 3 <- 5 (chain), plus side block 4 (child of 2) merged by 5,
// and side tip 6 (child of 3, lighter than 5).
const B1 = blk(1);
const B2 = blk(2, { miner: "0xaa" });
const B3 = blk(3, { miner: "0xaa" });
const B4 = blk(4, { height: 3, blueScore: 3, blueWork: "25", selectedParent: H(2), miner: "0xbb" });
const B5 = blk(5, { height: 4, blueScore: 5, blueWork: "60", selectedParent: H(3), mergeParents: [H(4)], miner: "0xaa" });
const B6 = blk(6, { height: 4, blueScore: 4, blueWork: "40", selectedParent: H(3), miner: "0xcc" });
const ALL = [B1, B2, B3, B4, B5, B6];

describe("deriveSelectedChain", () => {
  it("follows selected parents from the tip with the most blue work", () => {
    expect(deriveSelectedChain(ALL, [H(5), H(6)])).toEqual([H(5), H(3), H(2), H(1)]);
  });
  it("falls back to childless blocks when the tip set is unknown", () => {
    expect(deriveSelectedChain(ALL, [])).toEqual([H(5), H(3), H(2), H(1)]);
  });
  it("compares blue work as big integers, not strings", () => {
    const a = blk(10, { blueWork: "9", selectedParent: null });
    const b = blk(11, { blueWork: "10", selectedParent: null });
    expect(deriveSelectedChain([a, b], [])).toEqual([H(11)]);
  });
  it("is empty for no blocks", () => {
    expect(deriveSelectedChain([], [])).toEqual([]);
  });
});

describe("colorBlocks", () => {
  const chain = [H(5), H(3), H(2), H(1)];
  it("marks chain blocks and leaves the rest unknown without GhostDAG data", () => {
    const c = colorBlocks(ALL, chain, null);
    expect(c[H(5)]).toBe("chain");
    expect(c[H(4)]).toBe("unknown");
    expect(c[H(6)]).toBe("unknown");
  });
  it("colors mergeset members blue or red when GhostDAG data is served", () => {
    const g = { [H(5)]: { mergesetBlues: [H(3), H(4)], mergesetReds: [] }, [H(3)]: { mergesetBlues: [H(2)], mergesetReds: [] } };
    const c = colorBlocks(ALL, chain, g);
    expect(c[H(4)]).toBe("blue");
    expect(c[H(6)]).toBe("unmerged");
    const g2 = { [H(5)]: { mergesetBlues: [H(3)], mergesetReds: [H(4)] } };
    expect(colorBlocks(ALL, chain, g2)[H(4)]).toBe("red");
  });
});

describe("mergedBy", () => {
  it("finds the chain block whose header lists the side block as a merge parent", () => {
    expect(mergedBy(ALL, [H(5), H(3), H(2), H(1)], null)).toEqual({ [H(4)]: H(5) });
  });
  it("prefers the GhostDAG mergeset when served", () => {
    const g = { [H(3)]: { mergesetBlues: [H(2), H(4)], mergesetReds: [] } };
    expect(mergedBy(ALL, [H(5), H(3), H(2), H(1)], g)[H(4)]).toBe(H(3));
  });
});

describe("mergeRate", () => {
  it("is the share of chain blocks with at least one merge parent", () => {
    expect(mergeRate(ALL, [H(5), H(3), H(2), H(1)])).toEqual({ merging: 1, total: 4, rate: 0.25 });
  });
  it("is null with no chain", () => {
    expect(mergeRate([], [])).toBeNull();
  });
});

describe("redRate", () => {
  it("is null without GhostDAG data", () => {
    expect(redRate([H(5)], null)).toBeNull();
  });
  it("sums mergeset reds over chain blocks", () => {
    const g = { [H(5)]: { mergesetBlues: [H(3)], mergesetReds: [H(4)] }, [H(3)]: { mergesetBlues: [H(2)], mergesetReds: [] } };
    expect(redRate([H(5), H(3)], g)).toEqual({ blues: 2, reds: 1, rate: 1 / 3 });
  });
});

describe("producerShare", () => {
  it("counts blocks per miner, largest first, skipping unknown miners", () => {
    expect(producerShare(ALL)).toEqual([
      { producer: "0xaa", n: 3, share: 0.6 },
      { producer: "0xbb", n: 1, share: 0.2 },
      { producer: "0xcc", n: 1, share: 0.2 },
    ]);
  });
});

describe("blocksPerSlot", () => {
  it("is null while headers carry no slot", () => {
    expect(blocksPerSlot(ALL)).toBeNull();
  });
  it("counts blocks per slot including empty slots", () => {
    const xs = [blk(1, { slot: 10 }), blk(2, { slot: 10 }), blk(3, { slot: 12 }), blk(4, { slot: 13 })];
    expect(blocksPerSlot(xs)).toEqual({ firstSlot: 10, perSlot: [2, 0, 1, 1], mean: 1, emptyShare: 0.25 });
  });
});

describe("finality", () => {
  const status = {
    published: true,
    voting: true,
    enforcement: false,
    mode: "observed",
    halted: false,
    interval: 50,
    quorumRule: null,
    finalized: { height: 100, blockHash: H(1), committeeSize: 4, voters: 4, quorumPct: 100, hasQuorum: true },
    pending: [{ height: 150, blockHash: H(2), committeeSize: 4, voters: 2, quorumPct: 50, hasQuorum: false }],
    dataSource: null,
  };
  it("places finalized, voting and tip marks on a ruler", () => {
    const r = finalityRuler(status, 160);
    expect(r).not.toBeNull();
    expect(r!.finalized).toBe(100);
    expect(r!.pending).toBe(150);
    expect(r!.pendingPct).toBe(50);
    expect(r!.tip).toBe(160);
    expect(r!.at(r!.lo)).toBe(0);
    expect(r!.at(r!.hi)).toBe(100);
    expect(r!.at(100)).toBeLessThan(r!.at(150));
  });
  it("draws no ruler for an unpublished or missing status", () => {
    expect(finalityRuler(null, 10)).toBeNull();
    expect(finalityRuler({ ...status, published: false, finalized: null, pending: [] }, 10)).toBeNull();
  });
  it("classifies a height against the checkpoint, never by depth", () => {
    expect(finalityOf(90, status)).toBe("finalized");
    expect(finalityOf(120, status)).toBe("voting");
    expect(finalityOf(155, status)).toBe("above");
    expect(finalityOf(1, null)).toBe("unknown");
  });
});

describe("dagLayout", () => {
  it("puts chain blocks on lane 0, siblings on other lanes, one column per blue score", () => {
    const L = dagLayout(ALL, new Set([H(5), H(3), H(2), H(1)]), 50);
    expect(L.minBlueScore).toBe(1);
    expect(L.maxBlueScore).toBe(5);
    expect(L.nodes[H(5)].lane).toBe(0);
    expect(L.nodes[H(5)].col).toBe(4);
    expect(L.nodes[H(4)].lane).not.toBe(0);
    expect(L.nodes[H(6)].lane).not.toBe(0);
    const spine = L.edges.filter((e) => e.kind === "spine").map((e) => [e.from, e.to]);
    expect(spine).toContainEqual([H(3), H(5)]);
    expect(L.edges.find((e) => e.from === H(4) && e.to === H(5))?.kind).toBe("merge");
    expect(L.edges.find((e) => e.from === H(3) && e.to === H(6))?.kind).toBe("selected");
  });
  it("keeps only the newest maxBlocks by blue score", () => {
    const L = dagLayout(ALL, new Set(), 2);
    expect(Object.keys(L.nodes).sort()).toEqual([H(5), H(6)].sort());
  });
});

describe("anticoneInWindow", () => {
  it("is every block that is neither past nor future", () => {
    expect(anticoneInWindow(H(4), ALL).sort()).toEqual([H(3), H(6)].sort());
    expect(anticoneInWindow(H(1), ALL)).toEqual([]);
  });
});

describe("inclusionView (tx page: included in X, accepted by chain block Y)", () => {
  it("uses the receipt block and says acceptance is unsupported on today's node", async () => {
    const { inclusionView } = await import("./model");
    expect(inclusionView({ blockHash: H(4), blockNumber: "4" }, null, false)).toEqual({
      included: { hash: H(4), height: 4, color: "unknown", source: "receipt" },
      accepted: null,
      state: "unsupported",
      duplicates: [],
    });
  });
  it("reads the executing inclusion and the accepting block from citrate_getAcceptingBlock", async () => {
    const { inclusionView } = await import("./model");
    const v = inclusionView({ blockHash: H(5), blockNumber: "5" }, {
      acceptingBlockHash: H(5),
      acceptingHeight: 5,
      inclusions: [
        { blockHash: H(4), dagHeight: 4, color: "blue", outcome: "executed" },
        { blockHash: H(6), dagHeight: 4, color: "red", outcome: "skipped:nonce" },
      ],
    }, true);
    expect(v.included).toEqual({ hash: H(4), height: 4, color: "blue", source: "acceptingBlock" });
    expect(v.accepted).toEqual({ hash: H(5), height: 5 });
    expect(v.state).toBe("accepted");
    expect(v.duplicates).toEqual([{ hash: H(6), height: 4, outcome: "skipped:nonce" }]);
  });
  it("is pending while no chain block has accepted it", async () => {
    const { inclusionView } = await import("./model");
    const v = inclusionView({ blockHash: null, blockNumber: null }, {
      acceptingBlockHash: null,
      acceptingHeight: null,
      inclusions: [{ blockHash: H(7), dagHeight: 7, color: "selected_parent", outcome: "pending" }],
    }, true);
    expect(v.state).toBe("pending");
    expect(v.included.color).toBe("chain");
    expect(v.accepted).toBeNull();
  });
});
