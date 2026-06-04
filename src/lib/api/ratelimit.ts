/**
 * Rate limiter for the public API + chat.
 *
 * Two backends behind one async entry point ({@link checkRateLimit}):
 *
 *  1. **Distributed** — Upstash Redis REST (`UPSTASH_REDIS_REST_URL` +
 *     `_TOKEN`). A 1-second fixed-window counter shared across every serverless
 *     instance/region. This is the production limit (P-8 WP-8.4).
 *  2. **In-memory token bucket** ({@link rateLimit}) — the fallback when no store
 *     is configured (local dev / unprovisioned). Per-instance + resets on cold
 *     start, so best-effort only; it still stops a single instance being trivially
 *     abused.
 *
 * If the store is configured but errors, we DO NOT fail closed — we fall back to
 * the in-memory bucket so a Redis blip can't take the API down.
 */
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateResult {
  ok: boolean;
  retryAfter?: number;
  /** Which backend decided this — useful for the health endpoint / debugging. */
  backend?: "redis" | "memory";
}

/** Default burst for a given sustained rate. */
const defaultBurst = (perSec: number) => Math.max(perSec * 2, 5);

/** In-memory token bucket. `id` buckets per key or IP. Synchronous + local. */
export function rateLimit(id: string, perSec: number, burst = defaultBurst(perSec)): RateResult {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b) {
    b = { tokens: burst, last: now };
    buckets.set(id, b);
  }
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.tokens < 1) {
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / Math.max(perSec, 0.1)), backend: "memory" };
  }
  b.tokens -= 1;
  return { ok: true, backend: "memory" };
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** True when a cross-instance store is configured. */
export function isDistributed(): boolean {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

/**
 * 1-second fixed-window counter in Redis via the Upstash REST pipeline:
 * `INCR key` + `EXPIRE key 1 NX`. `limit` is the max requests per window.
 * Throws on any transport/store error so the caller can fall back.
 */
async function redisFixedWindow(id: string, limit: number): Promise<RateResult> {
  const windowSec = 1;
  const windowStart = Math.floor(Date.now() / 1000);
  const key = `rl:${id}:${windowStart}`;
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, windowSec, "NX"],
    ]),
    // Don't let a slow store stall a request; the caller falls back on throw.
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const body = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = body?.[0]?.result;
  if (typeof count !== "number") throw new Error("upstash malformed response");
  if (count > limit) {
    return { ok: false, retryAfter: windowSec, backend: "redis" };
  }
  return { ok: true, backend: "redis" };
}

/**
 * The entry point used by routes. Prefers the distributed store; falls back to
 * the in-memory bucket when unconfigured OR when the store errors (never fails
 * closed). `perSec` is the sustained rate; `burst` is the per-window ceiling.
 */
export async function checkRateLimit(
  id: string,
  perSec: number,
  burst = defaultBurst(perSec),
): Promise<RateResult> {
  if (isDistributed()) {
    try {
      return await redisFixedWindow(id, burst);
    } catch {
      // Store unreachable — degrade to the local bucket rather than 500/lock out.
    }
  }
  return rateLimit(id, perSec, burst);
}
