/**
 * Request helpers for the verification routes (EXP-S2): bounded body reads and
 * the per-IP budgets. Submissions share the `verify:<ip>` budget with
 * POST /api/verify; reads share the public-read budget.
 */
import { clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { PUBLIC_READ_BURST, PUBLIC_READ_PER_SEC, publicReadBucket } from "@/lib/api/publicRead";
import { maxSourceBytes } from "./request";

/**
 * The platform refuses function request bodies over 4.5 MB before our code runs, with
 * a plain-text answer Etherscan clients cannot parse. Stay below it so an oversized
 * submission gets an Etherscan-style JSON refusal.
 */
export const PLATFORM_BODY_CAP = 4_000_000;

/** Largest request body accepted: the source cap, URL-encoded, plus form overhead, under the platform cap. */
export function maxBodyBytes(): number {
  return Math.min(maxSourceBytes() * 3 + 64 * 1024, PLATFORM_BODY_CAP);
}

export class BodyTooLarge extends Error {}

/** Read the body as text, refusing past `limit` bytes without buffering the rest. */
export async function readBody(req: Request, limit = maxBodyBytes()): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function allowSubmit(req: Request): Promise<{ ok: boolean; retryAfter?: number }> {
  return checkRateLimit(`verify:${clientIp(req)}`, 0.2, 5, { failClosed: true });
}

export async function allowRead(req: Request): Promise<{ ok: boolean; retryAfter?: number }> {
  return checkRateLimit(publicReadBucket(clientIp(req)), PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST);
}
