import { describe, it, expect } from "vitest";
import { makeDagStatsCache } from "./dagStatsCache";
import type { DagStats } from "@/lib/citrate/dag";

const stats = (maxBlueScore: number) =>
  ({ maxBlueScore, ghostdagParams: { finalityDepth: 100 } }) as unknown as DagStats;

// citrate_getDagStats scans the node's whole block store on every call, so the
// indexer must not call it once per ingested block (2026-11-01: ~1.4 calls/s
// pinned the public RPC node's CPU).
describe("makeDagStatsCache", () => {
  it("calls the RPC once per TTL window, however many blocks are ingested", async () => {
    let calls = 0;
    let t = 0;
    const get = makeDagStatsCache(async () => stats(++calls), 5_000, () => t);
    for (let i = 0; i < 50; i++) expect((await get()).maxBlueScore).toBe(1);
    t = 4_999;
    expect((await get()).maxBlueScore).toBe(1);
    t = 5_000;
    expect((await get()).maxBlueScore).toBe(2);
    expect(calls).toBe(2);
  });

  it("shares one in-flight request between a parallel batch", async () => {
    let calls = 0;
    const get = makeDagStatsCache(async () => stats(++calls), 5_000, () => 0);
    const all = await Promise.all(Array.from({ length: 16 }, () => get()));
    expect(all.every((s) => s.maxBlueScore === 1)).toBe(true);
    expect(calls).toBe(1);
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const get = makeDagStatsCache(
      async () => {
        calls++;
        if (calls === 1) throw new Error("rpc down");
        return stats(calls);
      },
      5_000,
      () => 0,
    );
    await expect(get()).rejects.toThrow("rpc down");
    expect((await get()).maxBlueScore).toBe(2);
  });
});
