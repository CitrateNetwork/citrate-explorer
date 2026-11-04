/**
 * One `citrate_getDagStats` snapshot per server instance (EXP-S0/S1 RPC load).
 *
 * The node derives the tip set from its block store for every call, so the call
 * is expensive. Before this, each SSE stream (up to 50 per instance) polled it
 * on its own, and so did `/api/dag`, the block and tx routes and the harness
 * tools. Now every web caller reads the same snapshot:
 *  - single-flight: concurrent callers share one in-flight request;
 *  - a snapshot is served for CITRATE_DAGSTATS_TTL_MS (default 3000 ms);
 *  - a failed request is not cached, so the next caller retries.
 * A snapshot a few seconds old only delays a "finalized" label or a tip count
 * by that much.
 *
 * Data source (Rule 7): live Citrate RPC `citrate_getDagStats` via the harness client.
 */
import type { DagStats } from "./dag";
import { getDagStats } from "./dag";
import { harnessClient } from "@/lib/harness/client";

export interface SharedDagStatsOptions {
  ttlMs: number;
  now?: () => number;
}

export function makeSharedDagStats(
  read: () => Promise<DagStats>,
  { ttlMs, now = Date.now }: SharedDagStatsOptions,
): () => Promise<DagStats> {
  let value: DagStats | undefined;
  let at = 0;
  let inFlight: Promise<DagStats> | undefined;
  return () => {
    if (value !== undefined && now() - at < ttlMs) return Promise.resolve(value);
    if (inFlight) return inFlight;
    inFlight = read()
      .then((s) => {
        value = s;
        at = now();
        return s;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

const TTL_MS = Math.max(0, Number(process.env.CITRATE_DAGSTATS_TTL_MS ?? 3_000)) || 3_000;

/** The instance-wide snapshot every route and harness op reads. */
export const sharedDagStats = makeSharedDagStats(() => getDagStats(harnessClient()), { ttlMs: TTL_MS });
