/**
 * API-key validation for the public dev API (/api/v1) and MCP (/api/mcp).
 * Keys are stored only as a salted hash (P-6); we hash the presented key and look
 * it up. Anonymous access is allowed at a lower rate (no key) so the API is
 * browsable; a valid key raises the limit.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { API_KEY_RE, hashApiKey } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/api/ratelimit";

/**
 * PBA-L3c-013: how many non-revoked keys one subject may hold. Every key used to
 * get its own rate-limit bucket, so minting keys multiplied the caller's budget;
 * the limiter is now keyed per OWNER (below) and the key count is capped too.
 */
export const MAX_ACTIVE_KEYS_PER_SUBJECT = 5;

/** key_scheme written and accepted by this release (see migration 0004). */
export const API_KEY_SCHEME_CURRENT = "scrypt-v1";

/**
 * Per-IP budget for presented keys that pass the format check, charged BEFORE the key is hashed
 * (the KDF is deliberately expensive) and failing closed when the shared store errors. It sits
 * above the default keyed rate (5/s, burst 10) so legitimate keyed traffic is not squeezed by it.
 */
export const KEY_CHECK_PER_SEC = 10;
export const KEY_CHECK_BURST = 20;

/** Message for a key that is not valid under the current release. */
export const INVALID_KEY_MESSAGE =
  "Invalid API Key. Keys issued before the 2026-09 key-storage upgrade were retired: mint a new one in Settings -> API keys.";

/** Count a subject's usable keys (non-revoked, current scheme). */
export async function countActiveKeys(subject: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(
      and(eq(apiKeys.subject, subject), eq(apiKeys.revoked, false), eq(apiKeys.keyScheme, API_KEY_SCHEME_CURRENT)),
    );
  return Number(row?.n ?? 0);
}

export interface KeyCheck {
  valid: boolean;
  anonymous: boolean;
  /** Rate-limit identity (key id or "anon:<ip>"). */
  id: string;
  perSec: number;
  keyId?: number;
  /** PBA-L3c-034: the owning OIDC subject (audit attribution), verbatim. */
  subject?: string;
  /** PBA-L3c-013: the key is real but its `quotaPerDay` is spent for today. */
  quotaExceeded?: boolean;
  /** The caller's per-IP key-check budget is spent; the key was not hashed. */
  throttled?: boolean;
  retryAfter?: number;
}

export async function validateApiKey(rawKey: string | null, ip: string): Promise<KeyCheck> {
  if (!rawKey) return { valid: false, anonymous: true, id: `anon:${ip}`, perSec: 2 };

  const db = getDb();
  if (!db) {
    // Can't validate without the store; treat as anonymous (don't fail closed on
    // a missing DB so the public read API still works in dev).
    return { valid: false, anonymous: true, id: `anon:${ip}`, perSec: 2 };
  }

  // Cheap checks first; the KDF runs only on a well-formed key within the IP's budget.
  if (!API_KEY_RE.test(rawKey)) return { valid: false, anonymous: false, id: `bad:${ip}`, perSec: 0 };
  const budget = await checkRateLimit(`keycheck:${ip}`, KEY_CHECK_PER_SEC, KEY_CHECK_BURST, { failClosed: true });
  if (!budget.ok) {
    return { valid: false, anonymous: false, id: `throttle:${ip}`, perSec: 0, throttled: true, retryAfter: budget.retryAfter ?? 1 };
  }

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, await hashApiKey(rawKey)),
        eq(apiKeys.revoked, false),
        eq(apiKeys.keyScheme, API_KEY_SCHEME_CURRENT),
      ),
    )
    .limit(1);

  if (!row) return { valid: false, anonymous: false, id: `bad:${ip}`, perSec: 0 };

  // PBA-L3c-013: enforce the stored daily quota (a counter with a one-day
  // window: `quota` per 86,400 s), shared across instances when Upstash is set.
  // Fail-open on a store blip (degrades to a per-instance counter) so a Redis
  // outage does not switch every keyed caller off.
  const quota = row.quotaPerDay ?? 100_000;
  const daily = await checkRateLimit(`quota:key:${row.id}`, quota / 86_400, quota);
  if (!daily.ok) {
    return { valid: false, anonymous: false, id: `quota:${row.id}`, perSec: 0, keyId: row.id, quotaExceeded: true };
  }

  // Best-effort last-used stamp.
  void db.update(apiKeys).set({ lastUsed: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => {});
  return {
    valid: true,
    anonymous: false,
    // PBA-L3c-013: one rate-limit bucket per OWNER, however many keys they mint.
    id: `owner:${row.subject ?? row.userAddress}`,
    perSec: row.rateLimitPerSec ?? 5,
    keyId: row.id,
    subject: row.subject ?? row.userAddress,
  };
}

/**
 * Extract the apikey from query (?apikey=) or Bearer header.
 *
 * PBA-L3c-034: a key in a URL lands in access logs, proxies and Referer headers.
 * `?apikey=` is kept only where Etherscan-compatible tooling needs it (/api/v1);
 * other surfaces pass `{ allowQuery: false }` and take the header only.
 */
export function extractApiKey(req: Request, opts: { allowQuery?: boolean } = {}): string | null {
  if (opts.allowQuery !== false) {
    const q = new URL(req.url).searchParams.get("apikey");
    if (q) return q;
  }
  const auth = req.headers.get("authorization");
  if (auth) return auth.replace(/^Bearer\s+/i, "");
  return null;
}

/**
 * Trusted client IP for rate-limit bucketing (FUA-EXPLORER-02 / FWA-C12-04).
 *
 * Client-supplied headers (`x-real-ip`, the LEFT side of `x-forwarded-for`) are
 * forgeable: an attacker who sets a fresh value per request mints a fresh limiter
 * bucket every time, defeating per-IP limits. We therefore derive the identity
 * ONLY from a hop a *trusted* proxy is known to append, never from a raw client
 * header.
 *
 * Trust model (per-deployment, env-configured):
 *  - `CITRATE_TRUSTED_PROXY_HOPS` (default 1): how many trusted reverse proxies
 *    sit in front of the app. Each appends exactly ONE hop to the RIGHT of
 *    `x-forwarded-for`; the real client IP is therefore the Nth-from-the-right
 *    hop. A client can prepend arbitrary LEFT hops but cannot forge the ones the
 *    trusted proxies appended, so it cannot move this index.
 *  - `CITRATE_TRUST_X_REAL_IP=1`: opt-in for deploys where the platform is known
 *    to SET/overwrite `x-real-ip` itself (so it is not client-forgeable). OFF by
 *    default — on a directly-reachable function `x-real-ip` is fully spoofable.
 *
 * If neither a trusted XFF hop nor a trusted x-real-ip is available, we fall back
 * to a single shared sentinel rather than to a client-controlled value: a
 * misconfigured/headerless deploy then rate-limits everyone together (fail
 * closed for the limiter) instead of handing each request its own bucket.
 */
/** Trusted-proxy count, re-read per call so tests/ops can override via env. */
function trustedProxyHops(): number {
  const n = Number(process.env.CITRATE_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function clientIp(req: Request): string {
  // Re-read the opt-in per call so tests/ops can toggle it via env.
  if (process.env.CITRATE_TRUST_X_REAL_IP === "1") {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  // The trusted client IP is the hop the OUTERMOST trusted proxy saw: count
  // trustedProxyHops() in from the right. With one trusted proxy that is the
  // right-most hop; everything to its left is client-supplied and untrusted.
  const idx = hops.length - trustedProxyHops();
  if (idx >= 0 && hops[idx]) return hops[idx];
  // No trustworthy hop present → a single shared sentinel (never a raw client
  // header), so forged values cannot rotate the limiter bucket.
  return "0.0.0.0";
}
