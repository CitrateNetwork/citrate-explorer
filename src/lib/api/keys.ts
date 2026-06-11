/**
 * API-key validation for the public dev API (/api/v1) and MCP (/api/mcp).
 * Keys are stored only as a salted hash (P-6); we hash the presented key and look
 * it up. Anonymous access is allowed at a lower rate (no key) so the API is
 * browsable; a valid key raises the limit.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { hashApiKey } from "@/lib/crypto";

export interface KeyCheck {
  valid: boolean;
  anonymous: boolean;
  /** Rate-limit identity (key id or "anon:<ip>"). */
  id: string;
  perSec: number;
  keyId?: number;
}

export async function validateApiKey(rawKey: string | null, ip: string): Promise<KeyCheck> {
  if (!rawKey) return { valid: false, anonymous: true, id: `anon:${ip}`, perSec: 2 };

  const db = getDb();
  if (!db) {
    // Can't validate without the store; treat as anonymous (don't fail closed on
    // a missing DB so the public read API still works in dev).
    return { valid: false, anonymous: true, id: `anon:${ip}`, perSec: 2 };
  }

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashApiKey(rawKey)), eq(apiKeys.revoked, false)))
    .limit(1);

  if (!row) return { valid: false, anonymous: false, id: `bad:${ip}`, perSec: 0 };

  // Best-effort last-used stamp.
  void db.update(apiKeys).set({ lastUsed: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => {});
  return {
    valid: true,
    anonymous: false,
    id: `key:${row.id}`,
    perSec: row.rateLimitPerSec ?? 5,
    keyId: row.id,
  };
}

/** Extract the apikey from query (?apikey=) or Bearer header. */
export function extractApiKey(req: Request): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("apikey");
  if (q) return q;
  const auth = req.headers.get("authorization");
  if (auth) return auth.replace(/^Bearer\s+/i, "");
  return null;
}

/**
 * Trusted client IP for rate-limit bucketing (FUA-EXPLORER-02).
 *
 * The previous implementation took the LEFT-most `X-Forwarded-For` value, which
 * the client fully controls — an attacker rotates it to get a fresh limiter
 * bucket every request, defeating per-IP limits. On Vercel the trusted value is
 * the platform-set `x-real-ip` (the real client IP, not forgeable); equivalently
 * the RIGHT-most `X-Forwarded-For` hop that Vercel appends. We never trust the
 * left-most hop. (Self-hosted deploys behind their own proxy should rate-limit at
 * that proxy / set `x-real-ip` there.)
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "0.0.0.0";
}
