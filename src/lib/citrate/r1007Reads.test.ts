/**
 * Per-entity r1007 reads used by /api/blocks/[id] and /api/tx/[hash], plus the
 * per-instance capability cache. Each read runs only when its method was
 * detected, and a failed read is reported as null, never invented.
 */
import { describe, expect, it } from "vitest";
import { blockR1007, txR1007, makeCapabilityCache } from "./r1007Reads";
import { NO_R1007, type Requester } from "./r1007";

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const counting = (impl: Requester) => {
  const calls: string[] = [];
  const req: Requester = async (m, p) => {
    calls.push(m);
    return impl(m, p);
  };
  return { req, calls };
};

describe("blockR1007", () => {
  it("reads nothing when no r1007 feature is detected", async () => {
    const { req, calls } = counting(async () => {
      throw new Error("should not be called");
    });
    expect(await blockR1007(req, NO_R1007, H(1), 7)).toEqual({ capabilities: NO_R1007, ghostdag: null, siblings: null, finality: null });
    expect(calls).toEqual([]);
  });
  it("returns GhostDAG data, siblings and finality when served", async () => {
    const caps = { ...NO_R1007, ghostdagData: true, blocksAtHeight: true, finalityStatus: true };
    const { req } = counting(async (m) => {
      if (m === "citrate_getGhostdagData") return { blueScore: "0x7", blueWork: "0x9", selectedParent: H(0), mergesetBlues: [H(0)], mergesetReds: [] };
      if (m === "citrate_getBlocksAtHeight") return [H(1), H(2)];
      if (m === "citrate_getFinalityStatus") return { published: false, finalized: null, pending: [] };
      throw new Error(m);
    });
    const r = await blockR1007(req, caps, H(1), 7);
    expect(r.ghostdag?.blueScore).toBe(7);
    expect(r.siblings).toEqual([H(2)]);
    expect(r.finality?.published).toBe(false);
  });
  it("reports a failed read as null", async () => {
    const caps = { ...NO_R1007, ghostdagData: true };
    const { req } = counting(async () => {
      throw new Error("boom");
    });
    expect((await blockR1007(req, caps, H(1), 7)).ghostdag).toBeNull();
  });
});

describe("txR1007", () => {
  it("is empty without citrate_getAcceptingBlock", async () => {
    const { req, calls } = counting(async () => null);
    expect(await txR1007(req, NO_R1007, H(9))).toEqual({ capabilities: NO_R1007, acceptance: null, finality: null });
    expect(calls).toEqual([]);
  });
  it("returns the accepting block and its inclusions", async () => {
    const caps = { ...NO_R1007, acceptingBlock: true };
    const { req } = counting(async () => ({ acceptingBlockHash: H(5), acceptingHeight: "0x5", inclusions: [{ blockHash: H(4), dagHeight: 4, color: "blue", outcome: "executed" }] }));
    const r = await txR1007(req, caps, H(9));
    expect(r.acceptance?.acceptingBlockHash).toBe(H(5));
    expect(r.acceptance?.inclusions).toHaveLength(1);
  });
});

describe("makeCapabilityCache", () => {
  it("probes once per TTL and shares an in-flight probe", async () => {
    let t = 0;
    let probes = 0;
    const cache = makeCapabilityCache(async () => {
      probes += 1;
      return NO_R1007;
    }, { ttlMs: 1000, now: () => t });
    await Promise.all([cache(), cache()]);
    expect(probes).toBe(1);
    t = 500;
    await cache();
    expect(probes).toBe(1);
    t = 1600;
    await cache();
    expect(probes).toBe(2);
  });
  it("does not cache a failed probe", async () => {
    let n = 0;
    const cache = makeCapabilityCache(async () => {
      n += 1;
      if (n === 1) throw new Error("down");
      return NO_R1007;
    }, { ttlMs: 1000, now: () => 0 });
    await expect(cache()).rejects.toThrow("down");
    await expect(cache()).resolves.toEqual(NO_R1007);
  });
});
