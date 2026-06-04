/**
 * Tiny in-memory read cache with **stale-on-error** fallback.
 *
 * The Citrate RPC flaps (Caddy returns 502 when its backend node is busy /
 * restarting, then recovers). Without this, every read route 502s during a blip
 * and the explorer looks "down". With it: serve fresh data when the RPC is up,
 * and serve the last-known-good value (flagged `stale`) when a read fails — so
 * brief node blips are invisible to the user instead of breaking the page.
 *
 * Per serverless instance (Vercel Fluid reuses instances), best-effort. Not a
 * substitute for the indexer; just a resilience shim over live RPC reads.
 */
interface Entry {
  ts: number;
  value: unknown;
}

const store = new Map<string, Entry>();

export interface CachedResult<T> {
  data: T;
  /** True when we served a prior value because the live read just failed. */
  stale: boolean;
  /** Age of the served value in ms (0 for a fresh read). */
  ageMs: number;
}

/**
 * Return `fn()`'s result, cached for `ttlMs`. Within the TTL, the cached value is
 * returned without calling `fn`. After it, `fn` runs; on success the cache
 * refreshes; on failure the last-known-good value is returned as `stale` (or the
 * error rethrows if nothing was ever cached).
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<CachedResult<T>> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.ts < ttlMs) {
    return { data: hit.value as T, stale: false, ageMs: now - hit.ts };
  }
  try {
    const value = await fn();
    store.set(key, { ts: now, value });
    return { data: value, stale: false, ageMs: 0 };
  } catch (err) {
    if (hit) {
      return { data: hit.value as T, stale: true, ageMs: now - hit.ts };
    }
    throw err;
  }
}
