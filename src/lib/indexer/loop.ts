/**
 * One tick of the always-on indexer loop (scripts/indexer/run.ts), with its I/O injected so the
 * wiring between the genesis gate, block ingest and finality reconciliation is unit-tested.
 *
 * A tick: ask the gate; read the head; ingest batches of up to `parallel` heights from `next`,
 * re-asking the gate before every batch; then reconcile finality.
 *
 * Data sources (Rule 7): the injected functions are the live ones in production
 * (`headHeight`/`ingestBlock`/`reconcileFinality` in ./ingest: live Citrate RPC → Postgres).
 */
import type { IngestResult } from "./ingest";

export interface TickGate {
  allow(): Promise<boolean>;
}

export interface TickDeps {
  gate: TickGate;
  headHeight(): Promise<number>;
  ingestBlock(height: number): Promise<IngestResult>;
  reconcileFinality(): Promise<number>;
  dbEnabled: boolean;
  parallel: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

export interface TickResult {
  /** The next height to ingest. */
  next: number;
  /** False when the gate blocked this tick (refusal or an unavailable check). */
  allowed: boolean;
}

export async function indexerTick(next: number, d: TickDeps): Promise<TickResult> {
  const log = d.log ?? (() => {});
  const logError = d.logError ?? (() => {});
  if (!(await d.gate.allow())) return { next, allowed: false };
  const head = await d.headHeight();
  while (next <= head) {
    // Re-check before every batch: the RPC can be cut over mid-backfill.
    if (!(await d.gate.allow())) break;
    // Up to `parallel` heights concurrently. Each ingest is idempotent at every persist site,
    // so a partial batch failure leaves a gap the next tick re-covers.
    const batchEnd = Math.min(next + d.parallel - 1, head);
    const heights: number[] = [];
    for (let h = next; h <= batchEnd; h++) heights.push(h);
    const results = await Promise.allSettled(heights.map((h) => d.ingestBlock(h)));
    for (let i = 0; i < heights.length; i++) {
      const r = results[i];
      const h = heights[i];
      if (r.status === "fulfilled") {
        const v = r.value;
        if (v.persisted || v.hash) {
          const sup = v.superseded ? ` superseded=${v.superseded}` : "";
          log(`[indexer] block ${h} hash=${v.hash} txs=${v.txCount}${sup}`);
        }
      } else {
        logError(`[indexer] block ${h} failed: ${(r.reason as Error).message}`);
      }
    }
    next = batchEnd + 1;
  }
  if (d.dbEnabled) {
    const f = await d.reconcileFinality();
    if (f) log(`[indexer] finalized ${f} block(s)`);
  }
  return { next, allowed: true };
}
