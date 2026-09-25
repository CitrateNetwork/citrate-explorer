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
 * (its Upstash path is a fixed window sized to the sustained rate), built for burst
 * control on cheap read endpoints. The relay needs a long (hourly) window with
 * a hard cap, so it gets its own sliding-window limiter here.
 *
 * Backend: in-memory Map of timestamps — per-instance and reset on cold start.
 * PBA-L3c-011: {@link checkRelayQuota} (what the route calls) ALSO enforces the
 * subject + IP caps in the shared Upstash store when it is configured, with an
 * hour-long window and fail-closed on store errors.
 *
 * Limits are env-overridable (`RELAY_MAX_PER_FROM_PER_HOUR`,
 * `RELAY_MAX_PER_IP_PER_HOUR`) with fail-closed parsing: a missing or
 * malformed value falls back to the conservative default — never to
 * "unlimited".
 */
import { checkRateLimit, isDistributed } from "@/lib/api/ratelimit";

export const RELAY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_MAX_PER_FROM_PER_HOUR = 30;
export const DEFAULT_MAX_PER_IP_PER_HOUR = 60;

export interface RelayRateResult {
  ok: boolean;
  /** Seconds until the oldest in-window hit expires (only when blocked). */
  retryAfter?: number;
  /** Which key tripped the limit (only when blocked). */
  scope?: "subject" | "from" | "ip";
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

/**
 * PBA-L3c-011: the full relay quota for an AUTHENTICATED caller.
 *
 *  1. per-subject (the verified session `sub`, verbatim — SR-0 case-sensitive),
 *     so rotating the self-chosen `request.from` no longer mints fresh budget;
 *  2. the existing per-`from` + per-IP sliding windows (per instance);
 *  3. when the shared store is configured, the same subject and IP caps
 *     enforced ACROSS instances, failing CLOSED on a store error (EX-B-008), so
 *     the effective cap is no longer `limit × instances`.
 *
 * The per-subject limit reuses the per-from budget (`RELAY_MAX_PER_FROM_PER_HOUR`).
 */
export async function checkRelayQuota(
  subject: string,
  from: string,
  ip: string,
  now: number = Date.now(),
): Promise<RelayRateResult> {
  const { fromLimit, ipLimit } = relayLimits();
  const bySubject = slidingWindowLimit(`relay:sub:${subject}`, fromLimit, now);
  if (!bySubject.ok) return { ...bySubject, scope: "subject" };
  const local = checkRelayRateLimit(from, ip, now);
  if (!local.ok) return local;

  if (isDistributed()) {
    const hour = RELAY_WINDOW_MS / 1000;
    const sharedSub = await checkRateLimit(`relay:sub:${subject}`, fromLimit / hour, fromLimit, { failClosed: true });
    if (!sharedSub.ok) return { ok: false, retryAfter: sharedSub.retryAfter ?? 60, scope: "subject" };
    const sharedIp = await checkRateLimit(`relay:ip:${ip}`, ipLimit / hour, ipLimit, { failClosed: true });
    if (!sharedIp.ok) return { ok: false, retryAfter: sharedIp.retryAfter ?? 60, scope: "ip" };
  }
  return { ok: true };
}
