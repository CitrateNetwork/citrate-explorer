/**
 * EXP-S0/S1 RPC load: `citrate_getDagStats` is expensive on the node (it derives
 * the tip set from the block store). Every SSE stream, `/api/dag`, the block and
 * tx routes and the harness tools used to call it on their own. They now share
 * one per-instance snapshot: single-flight, a short TTL, failures not cached.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DagStats } from "./dag";
import { makeSharedDagStats } from "./sharedDagStats";

const stats = (maxBlueScore: number) =>
  ({
    totalBlocks: 1,
    blueBlocks: 1,
    redBlocks: 0,
    tipsCount: 1,
    maxBlueScore,
    currentTips: [],
    height: maxBlueScore,
    ghostdagParams: { k: 18, maxParents: 10, maxBlueScoreDiff: 0, pruningWindow: 0, finalityDepth: 100 },
  }) as DagStats;

describe("makeSharedDagStats", () => {
  it("concurrent callers share one RPC call", async () => {
    let calls = 0;
    let release!: (s: DagStats) => void;
    const read = makeSharedDagStats(
      () => {
        calls++;
        return new Promise<DagStats>((r) => (release = r));
      },
      { ttlMs: 5_000, now: () => 0 },
    );
    const all = Promise.all(Array.from({ length: 50 }, () => read()));
    release(stats(7));
    expect((await all).every((s) => s.maxBlueScore === 7)).toBe(true);
    expect(calls).toBe(1);
  });

  it("serves the snapshot for the TTL, then refreshes", async () => {
    let t = 0;
    let n = 0;
    const read = makeSharedDagStats(async () => stats(++n), { ttlMs: 5_000, now: () => t });
    expect((await read()).maxBlueScore).toBe(1);
    t = 4_999;
    expect((await read()).maxBlueScore).toBe(1);
    t = 5_000;
    expect((await read()).maxBlueScore).toBe(2);
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const read = makeSharedDagStats(
      async () => {
        if (fail) throw new Error("rpc down");
        return stats(3);
      },
      { ttlMs: 5_000, now: () => 0 },
    );
    await expect(read()).rejects.toThrow("rpc down");
    fail = false;
    expect((await read()).maxBlueScore).toBe(3);
  });
});

describe("web callers use the shared snapshot", () => {
  const ROOT = join(__dirname, "..", "..");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return files(p);
      return /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p) ? [p] : [];
    });
  }

  it("no route or harness op calls citrate_getDagStats directly", () => {
    const direct = [...files(join(ROOT, "app")), join(ROOT, "lib", "harness", "ops.ts")]
      .filter((p) => /\b(getDagStats\(|dagStats\(|liveDagStats\()/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ROOT, p));
    expect(direct).toEqual([]);
  });
});
