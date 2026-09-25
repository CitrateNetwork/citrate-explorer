/**
 * PBA-L3c-019: one per-IP budget shared by the public read routes (address,
 * contract, tx, blocks, search, latest, dag, health, verify status). Each of
 * them fans out to live RPC or the indexer; before this they had no limit at
 * all. The budget is sized for the explorer UI (a page load issues a handful of
 * these) and shared across instances when Upstash is configured.
 */
import { clientIp } from "./keys";
import { checkRateLimit } from "./ratelimit";

export const PUBLIC_READ_PER_SEC = 10;
export const PUBLIC_READ_BURST = 30;

/** The limiter id for an IP's public-read budget. */
export const publicReadBucket = (ip: string) => `read:${ip}`;

/** A 429 Response when the caller's IP has spent its read budget, else null. */
export async function limitPublicRead(req: Request): Promise<Response | null> {
  const rl = await checkRateLimit(publicReadBucket(clientIp(req)), PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST);
  if (rl.ok) return null;
  return Response.json(
    { error: "rate limit exceeded" },
    { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 1) } },
  );
}
