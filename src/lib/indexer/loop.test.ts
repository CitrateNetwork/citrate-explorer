// Loop wiring: once the genesis gate refuses, the tick writes nothing more. In particular
// reconcileFinality (an UPDATE on blocks, with a cutoff from the refused RPC's DAG stats) must
// not run after a refusal mid-backfill.
import { describe, it, expect } from "vitest";
import { indexerTick, type TickDeps } from "./loop";
import type { IngestResult } from "./ingest";

function deps(allowSeq: boolean[], head = 10, parallel = 2) {
  const calls = { allow: 0, ingested: [] as number[], reconciled: 0 };
  const d: TickDeps = {
    gate: {
      async allow() {
        const v = allowSeq[Math.min(calls.allow, allowSeq.length - 1)];
        calls.allow++;
        return v;
      },
    },
    async headHeight() {
      return head;
    },
    async ingestBlock(h: number): Promise<IngestResult> {
      calls.ingested.push(h);
      return { persisted: true, height: h, hash: `0x${h}`, txCount: 0 };
    },
    async reconcileFinality() {
      calls.reconciled++;
      return 0;
    },
    dbEnabled: true,
    parallel,
  };
  return { d, calls };
}

describe("indexerTick", () => {
  it("ingests every batch and reconciles finality when the gate allows throughout", async () => {
    const { d, calls } = deps([true], 5, 2);
    const r = await indexerTick(0, d);
    expect(r).toEqual({ next: 6, allowed: true });
    expect(calls.ingested).toEqual([0, 1, 2, 3, 4, 5]);
    expect(calls.reconciled).toBe(1);
  });

  it("a refusal before the tick writes nothing", async () => {
    const { d, calls } = deps([false]);
    const r = await indexerTick(3, d);
    expect(r).toEqual({ next: 3, allowed: false });
    expect(calls.ingested).toEqual([]);
    expect(calls.reconciled).toBe(0);
  });

  it("a refusal mid-backfill stops ingest AND skips reconcileFinality", async () => {
    // tick check ok, batch 1 ok, batch 2 refused
    const { d, calls } = deps([true, true, false], 10, 2);
    const r = await indexerTick(0, d);
    expect(calls.ingested).toEqual([0, 1]);
    expect(calls.reconciled).toBe(0);
    expect(r).toEqual({ next: 2, allowed: false });
  });

  it("dry mode never reconciles", async () => {
    const { d, calls } = deps([true], 1, 1);
    await indexerTick(0, { ...d, dbEnabled: false });
    expect(calls.reconciled).toBe(0);
  });
});
