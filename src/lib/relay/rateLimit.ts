/**
 * SECREM-01 WEB-2 (pre-audit 2026-06-09) — hourly rate limiter for the gasless
 * relay (`/api/relay`).
 *
 * The relay's on-chain `verify` blocks cross-user forgery, but any valid
 * account holder could spam self-signed requests and drain the Foundation
 * relayer's gas. This module caps requests per hour keyed on BOTH the declared
 * `request.from` address AND the client IP.
 *
 * Why not `src/lib/api/ratelimit.ts`? That helper is a per-second token bucket
 * (and its Upstash path is a hardcoded 1-second fixed window), built for burst
 * control on cheap read endpoints. The relay needs a long (hourly) window with
 * a hard cap, so it gets its own sliding-window limiter here.
 *
 * Backend: in-memory Map of timestamps — per-instance and reset on cold start.
 * Acceptable for the MVP single-instance deploy; on a multi-instance/serverless
 * deploy each instance enforces the cap independently, so the effective global
 * cap is `limit × instances`. Move to a shared store (Upstash, with an
 * hour-long window) before scaling out.
 *
 * Limits are env-overridable (`RELAY_MAX_PER_FROM_PER_HOUR`,
 * `RELAY_MAX_PER_IP_PER_HOUR`) with fail-closed parsing: a missing or
 * malformed value falls back to the conservative default — never to
 * "unlimited".
 */

export const RELAY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_MAX_PER_FROM_PER_HOUR = 30;
export const DEFAULT_MAX_PER_IP_PER_HOUR = 60;

export interface RelayRateResult {
  ok: boolean;
  /** Seconds until the oldest in-window hit expires (only when blocked). */
  retryAfter?: number;
  /** Which key tripped the limit (only when blocked). */
  scope?: "from" | "ip";
}

/** Per-key request timestamps within the current window. */
const hits = new Map<string, number[]>();

/**
 * Fail-closed env parsing: only a positive integer overrides the default.
 * Anything unset/empty/malformed/non-positive → the conservative default.
 */
export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/** Effective limits, re-read per call so tests/ops can override via env. */
export function relayLimits(): { fromLimit: number; ipLimit: number } {
  return {
    fromLimit: parseLimit(process.env.RELAY_MAX_PER_FROM_PER_HOUR, DEFAULT_MAX_PER_FROM_PER_HOUR),
    ipLimit: parseLimit(process.env.RELAY_MAX_PER_IP_PER_HOUR, DEFAULT_MAX_PER_IP_PER_HOUR),
  };
}

/**
 * Sliding-window counter: allow if fewer than `limit` hits in the trailing
 * `windowMs`; record the hit on allow. `now` is injectable for tests.
 */
export function slidingWindowLimit(
  id: string,
  limit: number,
  now: number = Date.now(),
  windowMs: number = RELAY_WINDOW_MS,
): RelayRateResult {
  const cutoff = now - windowMs;
  const inWindow = (hits.get(id) ?? []).filter((t) => t > cutoff);
  if (inWindow.length >= limit) {
    hits.set(id, inWindow); // keep pruned — bounds memory under sustained spam
    const retryAfter = Math.max(1, Math.ceil((inWindow[0] + windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }
  inWindow.push(now);
  hits.set(id, inWindow);
  return { ok: true };
}

/**
 * The relay gate: per-`from` cap first (tighter), then per-IP. A hit is only
 * recorded against keys that allowed it, except that a from-pass + ip-block
 * still counts against `from` — conservative by design.
 */
export function checkRelayRateLimit(
  from: string,
  ip: string,
  now: number = Date.now(),
): RelayRateResult {
  const { fromLimit, ipLimit } = relayLimits();
  const byFrom = slidingWindowLimit(`relay:from:${from.toLowerCase()}`, fromLimit, now);
  if (!byFrom.ok) return { ...byFrom, scope: "from" };
  const byIp = slidingWindowLimit(`relay:ip:${ip}`, ipLimit, now);
  if (!byIp.ok) return { ...byIp, scope: "ip" };
  return { ok: true };
}
