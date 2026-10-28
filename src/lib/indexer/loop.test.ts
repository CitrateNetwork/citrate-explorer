// Loop wiring: once the genesis gate refuses, the tick writes nothing more. In particular
// reconcileFinality (an UPDATE on blocks, with a cutoff from the refused RPC's DAG stats) must
// not run after a refusal mid-backfill.
import { describe, it, expect } from "vitest";
import { indexerOnce, indexerTick, skipIndexedThrough, type OnceDeps, type TickDeps } from "./loop";
import type { IngestOptions, IngestResult } from "./ingest";

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

// Smoke pass and resume recovery. A smoke pass (`pnpm indexer:once`) ingests only the head; if it
// advanced the resume cursor, the continuous worker would start at head+1 and never index genesis
// or anything below the head, while health reported zero lag.
describe("indexerOnce (smoke pass)", () => {
  function onceDeps(allow: boolean) {
    const calls = { ingested: [] as { h: number; opts: IngestOptions }[], reconciled: 0 };
    const d: OnceDeps = {
      gate: { allow: async () => allow },
      headHeight: async () => 42,
      async ingestBlock(h, opts) {
        calls.ingested.push({ h, opts });
        return { persisted: true, height: h, hash: "0x42", txCount: 0 };
      },
      async reconcileFinality() {
        calls.reconciled++;
        return 0;
      },
      dbEnabled: true,
    };
    return { d, calls };
  }

  it("ingests the head without advancing the resume cursor", async () => {
    const { d, calls } = onceDeps(true);
    const r = await indexerOnce(d);
    expect(r).toMatchObject({ allowed: true, head: 42 });
    expect(calls.ingested).toEqual([{ h: 42, opts: { advanceCursor: false } }]);
  });

  it("writes nothing when the gate refuses", async () => {
    const { d, calls } = onceDeps(false);
    expect(await indexerOnce(d)).toEqual({ allowed: false });
    expect(calls.ingested).toEqual([]);
    expect(calls.reconciled).toBe(0);
  });
});

describe("skipIndexedThrough (resume recovery)", () => {
  it("skips heights already indexed up to recoverThrough, ingests gaps and everything above", async () => {
    const present = new Set([3, 5]);
    const ingested: number[] = [];
    const f = skipIndexedThrough(
      5,
      async (h) => present.has(h),
      async (h) => {
        ingested.push(h);
        return { persisted: true, height: h, hash: `0x${h}`, txCount: 0 };
      },
    );
    const results = [];
    for (let h = 0; h <= 7; h++) results.push(await f(h));
    expect(ingested).toEqual([0, 1, 2, 4, 6, 7]);
    expect(results[3]).toEqual({ persisted: false, height: 3, txCount: 0 });
  });

  it("recoverThrough -1 ingests every height without asking the index", async () => {
    let asked = 0;
    const ingested: number[] = [];
    const f = skipIndexedThrough(
      -1,
      async () => {
        asked++;
        return true;
      },
      async (h) => {
        ingested.push(h);
        return { persisted: true, height: h, txCount: 0 };
      },
    );
    for (let h = 0; h <= 2; h++) await f(h);
    expect(ingested).toEqual([0, 1, 2]);
    expect(asked).toBe(0);
  });
});
