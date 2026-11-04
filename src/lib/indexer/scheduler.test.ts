/**
 * explorer#40 / EXP-S1: under INDEXER_PARALLEL a failed height used to be
 * skipped forever (`next = batchEnd + 1`). The scheduler retries failed heights
 * with bounded exponential backoff, and the cursor it reports only covers
 * heights that all landed, so it never jumps over a hole and never goes back.
 */
import { describe, expect, it } from "vitest";
import { HeightScheduler } from "./scheduler";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("HeightScheduler", () => {
  it("hands out fresh heights in order, at most `parallel` at a time", () => {
    const c = clock();
    const s = new HeightScheduler({ start: 10, parallel: 3, now: c.now });
    expect(s.nextBatch(100)).toEqual([10, 11, 12]);
    for (const h of [10, 11, 12]) s.succeeded(h);
    expect(s.nextBatch(13)).toEqual([13]);
    s.succeeded(13);
    expect(s.nextBatch(13)).toEqual([]);
    expect(s.contiguousThrough()).toBe(13);
  });

  it("retries a failed height instead of skipping it", () => {
    const c = clock();
    const s = new HeightScheduler({ start: 0, parallel: 4, baseDelayMs: 1_000, now: c.now });
    expect(s.nextBatch(3)).toEqual([0, 1, 2, 3]);
    s.succeeded(0);
    s.failed(1);
    s.succeeded(2);
    s.succeeded(3);
    expect(s.contiguousThrough()).toBe(0);
    expect(s.nextBatch(3)).toEqual([]); // not due yet
    c.advance(1_000);
    expect(s.nextBatch(3)).toEqual([1]);
    s.succeeded(1);
    expect(s.contiguousThrough()).toBe(3);
    expect(s.pendingRetries()).toEqual([]);
  });

  it("backs off exponentially and caps the delay", () => {
    const c = clock();
    const s = new HeightScheduler({ start: 5, parallel: 1, baseDelayMs: 1_000, maxDelayMs: 8_000, now: c.now });
    s.nextBatch(5);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      delays.push(s.failed(5).retryInMs);
      c.advance(delays[i]);
      expect(s.nextBatch(5)).toEqual([5]);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(s.pendingRetries()).toEqual([{ height: 5, attempts: 6 }]);
  });

  it("puts due retries first and keeps going with new heights past a hole", () => {
    const c = clock();
    const s = new HeightScheduler({ start: 0, parallel: 3, baseDelayMs: 10, now: c.now });
    expect(s.nextBatch(10)).toEqual([0, 1, 2]);
    s.succeeded(0);
    s.failed(1);
    s.succeeded(2);
    c.advance(10);
    expect(s.nextBatch(10)).toEqual([1, 3, 4]);
  });

  it("the cursor is monotonic and never covers an in-flight or failed height", () => {
    const c = clock();
    const s = new HeightScheduler({ start: 0, parallel: 2, baseDelayMs: 10, now: c.now });
    s.nextBatch(5); // 0, 1 in flight
    expect(s.contiguousThrough()).toBe(-1);
    s.succeeded(1);
    expect(s.contiguousThrough()).toBe(-1); // 0 still in flight
    s.succeeded(0);
    expect(s.contiguousThrough()).toBe(1);
    s.nextBatch(5); // 2, 3
    s.failed(2);
    s.succeeded(3);
    expect(s.contiguousThrough()).toBe(1);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      c.advance(1_000);
      for (const h of s.nextBatch(5)) {
        s.succeeded(h);
      }
      seen.push(s.contiguousThrough());
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(s.contiguousThrough()).toBe(5);
  });

  it("starts below the resume cursor when resuming at 0", () => {
    const s = new HeightScheduler({ start: 0, parallel: 1, now: () => 0 });
    expect(s.contiguousThrough()).toBe(-1);
  });
});
