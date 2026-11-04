/**
 * Which heights the indexer ingests next (explorer#40, EXP-S1).
 *
 * - Fresh heights are handed out in order, at most `parallel` per batch.
 * - A failed height is retried after a bounded exponential backoff
 *   (`baseDelayMs`, doubling, capped at `maxDelayMs`). It is never skipped;
 *   new heights keep flowing past it meanwhile.
 * - `contiguousThrough()` is the highest height H such that every height in
 *   [start, H] has landed. It is the only value the loop persists as the resume
 *   cursor, so a restart re-covers any hole, and it never decreases.
 *
 * Pure state: no I/O. Data source for heights: the caller (the RPC head).
 */
export interface SchedulerOptions {
  /** First height to ingest (the resume cursor + 1). */
  start: number;
  parallel: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
}

interface Retry {
  attempts: number;
  dueAt: number;
}

export class HeightScheduler {
  private next: number;
  private readonly parallel: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  /** Heights handed out and not yet reported. */
  private readonly inFlight = new Set<number>();
  /** Heights that failed and wait for a retry. */
  private readonly retries = new Map<number, Retry>();
  /** Heights >= `floor` that landed while a lower height was still open. */
  private readonly doneAbove = new Set<number>();
  /** Every height below `floor` has landed. */
  private floor: number;

  constructor(o: SchedulerOptions) {
    this.next = o.start;
    this.floor = o.start;
    this.parallel = Math.max(1, Math.floor(o.parallel));
    this.baseDelayMs = o.baseDelayMs ?? 1_000;
    this.maxDelayMs = Math.max(this.baseDelayMs, o.maxDelayMs ?? 60_000);
    this.now = o.now ?? Date.now;
  }

  /** Due retries first (lowest height first), then fresh heights up to `head`. */
  nextBatch(head: number): number[] {
    const t = this.now();
    const out: number[] = [];
    const due = [...this.retries.entries()]
      .filter(([, r]) => r.dueAt <= t)
      .map(([h]) => h)
      .sort((a, b) => a - b);
    for (const h of due) {
      if (out.length >= this.parallel) break;
      out.push(h);
      this.inFlight.add(h);
    }
    while (out.length < this.parallel && this.next <= head) {
      out.push(this.next);
      this.inFlight.add(this.next);
      this.next++;
    }
    return out;
  }

  succeeded(h: number): void {
    this.inFlight.delete(h);
    this.retries.delete(h);
    if (h >= this.floor) this.doneAbove.add(h);
    while (this.doneAbove.has(this.floor)) {
      this.doneAbove.delete(this.floor);
      this.floor++;
    }
  }

  /** Records a failure; returns the attempt count and when it will be retried. */
  failed(h: number): { attempts: number; retryInMs: number } {
    this.inFlight.delete(h);
    const attempts = (this.retries.get(h)?.attempts ?? 0) + 1;
    const retryInMs = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempts - 1));
    this.retries.set(h, { attempts, dueAt: this.now() + retryInMs });
    return { attempts, retryInMs };
  }

  /** Highest height such that it and every height below it (from `start`) landed. */
  contiguousThrough(): number {
    return this.floor - 1;
  }

  /** Heights waiting for a retry, lowest first. */
  pendingRetries(): { height: number; attempts: number }[] {
    return [...this.retries.entries()]
      .sort(([a], [b]) => a - b)
      .map(([height, r]) => ({ height, attempts: r.attempts }));
  }
}
