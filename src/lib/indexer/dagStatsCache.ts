/**
 * TTL cache for the live GHOSTDAG snapshot used by block ingestion.
 *
 * `citrate_getDagStats` is expensive on the node (it derives the tip set from the
 * whole block store), and ingestion only needs `maxBlueScore` to label blocks
 * that are already deep enough to be final. A snapshot up to `ttlMs` old only
 * makes that label conservative (a block may be labelled final one tick later);
 * `reconcileFinality` still finalizes every block that reaches the depth.
 *
 * Concurrent callers (a parallel ingest batch) share one in-flight request; a
 * failed request is not cached.
 *
 * Data source (Rule 11): live Citrate RPC `citrate_getDagStats`, via `fetch`.
 */
import type { DagStats } from "@/lib/citrate/dag";

export function makeDagStatsCache(
  fetch: () => Promise<DagStats>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<DagStats> {
  let value: DagStats | undefined;
  let fetchedAt = 0;
  let inFlight: Promise<DagStats> | undefined;
  return () => {
    if (value !== undefined && now() - fetchedAt < ttlMs) return Promise.resolve(value);
    if (inFlight) return inFlight;
    inFlight = fetch()
      .then((s) => {
        value = s;
        fetchedAt = now();
        return s;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
