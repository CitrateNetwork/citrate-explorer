/**
 * Rate limits for the agent's write path (EXP-AGENT). Shared by the
 * `prepare_write` tool (chat + MCP) and POST /api/agent/prepare, so one identity
 * has one budget however it asks. Backed by the existing limiter
 * (src/lib/api/ratelimit.ts: in-process, or Upstash when configured).
 */
import { checkRateLimit } from "@/lib/api/ratelimit";
import { clientIp, extractApiKey, validateApiKey } from "@/lib/api/keys";

/** Preparations (each one simulates on live RPC): 1 per 2 s sustained, burst 10. */
export const PREPARE_PER_SEC = 0.5;
export const PREPARE_BURST = 10;

export async function allowPrepare(key: string): Promise<{ ok: boolean; retryAfter?: number }> {
  const r = await checkRateLimit(`agent-prepare:${key}`, PREPARE_PER_SEC, PREPARE_BURST);
  return { ok: r.ok, retryAfter: r.retryAfter };
}

/** Write-event logging: 2/s, burst 20, per owner. */
export async function allowWriteEvent(owner: string): Promise<boolean> {
  return (await checkRateLimit(`agent-write-event:${owner}`, 2, 20)).ok;
}

export type RequestIdentity =
  | { ok: true; key: string; subject: string | null }
  | { ok: false; status: number; error: string; retryAfter?: number };

/**
 * The rate-limit identity of an HTTP caller, by the same rules as /api/mcp: a
 * valid API key (header only) → its owner; a session subject; else the IP.
 */
export async function requestIdentity(req: Request, subject: string | null): Promise<RequestIdentity> {
  const ip = clientIp(req);
  const raw = extractApiKey(req, { allowQuery: false });
  if (raw) {
    const k = await validateApiKey(raw, ip);
    if (k.unavailable) return { ok: false, status: 503, error: "API key service unavailable", retryAfter: 60 };
    if (k.throttled) return { ok: false, status: 429, error: "rate limit exceeded", retryAfter: k.retryAfter ?? 1 };
    if (k.quotaExceeded) return { ok: false, status: 429, error: "daily API key quota exceeded", retryAfter: 3600 };
    if (k.valid) return { ok: true, key: `key:${k.id}`, subject: k.subject ?? subject };
  }
  if (subject) return { ok: true, key: `sub:${subject}`, subject };
  return { ok: true, key: `ip:${ip}`, subject: null };
}
