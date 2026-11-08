/**
 * EXP-REDESIGN data layer: feature detection and tolerant parsing for the r1007
 * read methods the CNV-RPC lane adds (planset 02 §3, spec 06 §5.4 and §5.5).
 * The explorer must light up when a node serves them and say so honestly when
 * it does not, so detection is the contract under test here.
 */
import { describe, expect, it } from "vitest";
import {
  R1007_METHODS,
  isMethodNotFound,
  isRpcError,
  probeR1007Capabilities,
  parseGhostdagData,
  parseFinalityStatus,
  parseChainChanges,
  parseAcceptingBlock,
  parseBlocksAtHeight,
  parseDagCounts,
  type Requester,
} from "./r1007";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

class RpcErr extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

describe("method names (planned by CNV-RPC)", () => {
  it("are the names in planset 02 §3", () => {
    expect(R1007_METHODS).toEqual({
      blocksAtHeight: "citrate_getBlocksAtHeight",
      ghostdagData: "citrate_getGhostdagData",
      selectedChainChanges: "citrate_getSelectedChainChanges",
      acceptingBlock: "citrate_getAcceptingBlock",
      finalityStatus: "citrate_getFinalityStatus",
    });
  });
});

describe("isMethodNotFound", () => {
  it("matches JSON-RPC -32601 on the error or its cause chain", () => {
    expect(isMethodNotFound(new RpcErr(-32601, "Method not found"))).toBe(true);
    const wrapped = Object.assign(new Error("RPC Request failed."), { cause: new RpcErr(-32601, "x") });
    expect(isMethodNotFound(wrapped)).toBe(true);
  });
  it("matches the message when the code is lost", () => {
    expect(isMethodNotFound(new Error("the method citrate_getGhostdagData does not exist/is not available"))).toBe(true);
    expect(isMethodNotFound(new Error("Method not found"))).toBe(true);
  });
  it("does not match other RPC errors or plain failures", () => {
    expect(isMethodNotFound(new RpcErr(-32602, "Invalid params"))).toBe(false);
    expect(isMethodNotFound(new Error("fetch failed"))).toBe(false);
    expect(isMethodNotFound(null)).toBe(false);
  });
});

describe("isRpcError", () => {
  it("is true for a JSON-RPC error code anywhere in the cause chain", () => {
    expect(isRpcError(new RpcErr(-32000, "block not found"))).toBe(true);
    expect(isRpcError(Object.assign(new Error("wrap"), { cause: new RpcErr(-32602, "bad") }))).toBe(true);
  });
  it("is false for transport failures", () => {
    expect(isRpcError(new Error("fetch failed"))).toBe(false);
  });
});

describe("probeR1007Capabilities", () => {
  const today: Requester = async (method) => {
    if (method === "citrate_getDagStats") {
      return { totalBlocks: null, blueBlocks: null, redBlocks: null, tipsCount: 9, maxBlueScore: 1, currentTips: [], height: 1, ghostdagParams: { k: 18 } };
    }
    throw new RpcErr(-32601, "Method not found");
  };

  it("reports every r1007 feature off against today's node", async () => {
    const caps = await probeR1007Capabilities(today);
    expect(caps).toEqual({
      blocksAtHeight: false,
      ghostdagData: false,
      selectedChainChanges: false,
      acceptingBlock: false,
      finalityStatus: false,
      dagStatsCounts: false,
    });
  });

  it("treats a method that rejects the probe params as present", async () => {
    const upgraded: Requester = async (method) => {
      if (method === "citrate_getDagStats") return { totalBlocks: 10, blueBlocks: 9, redBlocks: 1 };
      if (method === "citrate_getFinalityStatus") return { published: false, finalized: null, pending: [] };
      if (method === "citrate_getGhostdagData") throw new RpcErr(-32000, "block not found");
      if (method === "citrate_getAcceptingBlock") return { acceptingBlockHash: null, inclusions: [] };
      if (method === "citrate_getBlocksAtHeight") return [];
      throw new RpcErr(-32601, "Method not found");
    };
    const caps = await probeR1007Capabilities(upgraded);
    expect(caps).toEqual({
      blocksAtHeight: true,
      ghostdagData: true,
      selectedChainChanges: false,
      acceptingBlock: true,
      finalityStatus: true,
      dagStatsCounts: true,
    });
  });

  it("rethrows a transport failure instead of reporting a feature off", async () => {
    const down: Requester = async () => {
      throw new Error("fetch failed");
    };
    await expect(probeR1007Capabilities(down)).rejects.toThrow("fetch failed");
  });
});

describe("parseGhostdagData", () => {
  it("reads camelCase hex fields", () => {
    const g = parseGhostdagData(
      {
        blueScore: "0x10",
        blueWork: "0xff",
        selectedParent: H(1),
        mergesetBlues: [H(1), H(2)],
        mergesetReds: [H(3)],
        blueAnticoneSize: 2,
      },
      H(9),
    );
    expect(g).toEqual({
      hash: H(9),
      blueScore: 16,
      blueWork: "255",
      selectedParent: H(1),
      mergesetBlues: [H(1), H(2)],
      mergesetReds: [H(3)],
      blueAnticoneSize: 2,
    });
  });
  it("reads snake_case and decimal fields", () => {
    const g = parseGhostdagData(
      { blue_score: 7, blue_work: "12", selected_parent: H(4), mergeset_blues: [], mergeset_reds: [H(5)] },
      H(6),
    );
    expect(g?.blueScore).toBe(7);
    expect(g?.blueWork).toBe("12");
    expect(g?.selectedParent).toBe(H(4));
    expect(g?.mergesetReds).toEqual([H(5)]);
    expect(g?.blueAnticoneSize).toBeNull();
  });
  it("returns null for an empty result", () => {
    expect(parseGhostdagData(null, H(1))).toBeNull();
    expect(parseGhostdagData({}, H(1))).toBeNull();
  });
});

describe("parseFinalityStatus (shape from r1007/s3-finality-voting finality_status.rs)", () => {
  it("parses a published view", () => {
    const f = parseFinalityStatus({
      published: true,
      voting: true,
      enforcement: false,
      mode: "observed",
      halted: false,
      interval: 50,
      voteDepth: 10,
      quorumRule: "more than 2/3 of the committee stake",
      finalized: { height: "0x64", blockHash: H(1), committeeSize: 4, voters: 4, quorumPct: 100, hasQuorum: true },
      pending: [{ height: "0x96", blockHash: H(2), committeeSize: 4, voters: 2, quorumPct: 50, hasQuorum: false }],
      dataSource: "CheckpointManager",
    });
    expect(f).toEqual({
      published: true,
      voting: true,
      enforcement: false,
      mode: "observed",
      halted: false,
      interval: 50,
      quorumRule: "more than 2/3 of the committee stake",
      finalized: { height: 100, blockHash: H(1), committeeSize: 4, voters: 4, quorumPct: 100, hasQuorum: true },
      pending: [{ height: 150, blockHash: H(2), committeeSize: 4, voters: 2, quorumPct: 50, hasQuorum: false }],
      dataSource: "CheckpointManager",
    });
  });
  it("parses an unpublished view without inventing a checkpoint", () => {
    const f = parseFinalityStatus({ published: false, finalized: null, pending: [], dataSource: "x" });
    expect(f?.published).toBe(false);
    expect(f?.finalized).toBeNull();
    expect(f?.pending).toEqual([]);
  });
});

describe("parseChainChanges", () => {
  it("accepts {removed, added}", () => {
    expect(parseChainChanges({ removed: [H(1)], added: [H(2), H(3)] })).toEqual({ removed: [H(1)], added: [H(2), H(3)] });
  });
  it("accepts the *ChainBlockHashes naming", () => {
    expect(parseChainChanges({ removedChainBlockHashes: [], addedChainBlockHashes: [H(2)] })).toEqual({ removed: [], added: [H(2)] });
  });
  it("returns null for garbage", () => {
    expect(parseChainChanges("nope")).toBeNull();
  });
});

describe("parseAcceptingBlock (spec 06 §5.4)", () => {
  it("parses inclusions with color and outcome", () => {
    const a = parseAcceptingBlock({
      acceptingBlockHash: H(5),
      acceptingHeight: "0x20",
      inclusions: [
        { blockHash: H(3), dagHeight: "0x1f", color: "blue", outcome: "executed" },
        { blockHash: H(4), dagHeight: 31, color: "red", outcome: "skipped:nonce" },
      ],
    });
    expect(a).toEqual({
      acceptingBlockHash: H(5),
      acceptingHeight: 32,
      inclusions: [
        { blockHash: H(3), dagHeight: 31, color: "blue", outcome: "executed" },
        { blockHash: H(4), dagHeight: 31, color: "red", outcome: "skipped:nonce" },
      ],
    });
  });
  it("keeps a pending tx pending", () => {
    const a = parseAcceptingBlock({ acceptingBlockHash: null, acceptingHeight: null, inclusions: [{ blockHash: H(3), dagHeight: 2, color: "unaccepted", outcome: "pending" }] });
    expect(a?.acceptingBlockHash).toBeNull();
    expect(a?.acceptingHeight).toBeNull();
    expect(a?.inclusions[0].outcome).toBe("pending");
  });
});

describe("parseBlocksAtHeight", () => {
  it("accepts a list of hashes", () => {
    expect(parseBlocksAtHeight([H(1), H(2)])).toEqual([H(1), H(2)]);
  });
  it("accepts a list of block objects", () => {
    expect(parseBlocksAtHeight([{ hash: H(1) }, { hash: H(2), number: "0x1" }])).toEqual([H(1), H(2)]);
  });
  it("accepts {blocks: [...]}", () => {
    expect(parseBlocksAtHeight({ blocks: [{ hash: H(7) }] })).toEqual([H(7)]);
  });
});

describe("parseDagCounts", () => {
  it("is null while the node returns null counts (chain#317)", () => {
    expect(parseDagCounts({ totalBlocks: null, blueBlocks: null, redBlocks: null })).toBeNull();
  });
  it("returns the counts once they are real numbers", () => {
    expect(parseDagCounts({ totalBlocks: 10, blueBlocks: 9, redBlocks: 1 })).toEqual({ total: 10, blue: 9, red: 1 });
  });
});
