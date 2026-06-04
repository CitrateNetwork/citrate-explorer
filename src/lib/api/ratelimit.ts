/**
 * In-memory token-bucket rate limiter for the public API.
 *
 * NOTE: this is PER SERVERLESS INSTANCE and resets on cold start — it is a
 * best-effort guard, not a global limit. Production-grade, cross-instance rate
 * limiting needs a shared edge store (Vercel KV / Upstash Redis) — tracked in
 * P-8 (firewall / WAF). This keeps a single instance from being trivially abused.
 */
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateResult {
  ok: boolean;
  retryAfter?: number;
}

/** Allow `perSec` requests/s with a small burst. `id` buckets per key or IP. */
export function rateLimit(id: string, perSec: number, burst = Math.max(perSec * 2, 5)): RateResult {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b) {
    b = { tokens: burst, last: now };
    buckets.set(id, b);
  }
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.tokens < 1) {
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / Math.max(perSec, 0.1)) };
  }
  b.tokens -= 1;
  return { ok: true };
}
