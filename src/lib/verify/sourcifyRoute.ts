/**
 * Route glue for the Sourcify v2 endpoints (EXP-S2): rate limits, bounded body,
 * error envelope. The logic lives in ./sourcify.ts.
 */
import { randomUUID } from "crypto";
import { publicMessage } from "@/lib/api/errors";
import { verifyDeps } from "./deps";
import { allowRead, allowSubmit, BodyTooLarge, readBody } from "./http";
import { sourcifyContract, sourcifyJob, sourcifyVerify, type SourcifyReply } from "./sourcify";

const send = (r: SourcifyReply) => Response.json(r.body, { status: r.status });
const error = (status: number, customCode: string, message: string) =>
  Response.json({ customCode, message, errorId: randomUUID() }, { status });

async function guarded(fn: () => Promise<SourcifyReply>): Promise<Response> {
  try {
    return send(await fn());
  } catch (err) {
    return error(500, "internal_error", publicMessage(err, "api.sourcify", "verification service error; please retry"));
  }
}

export async function sourcifySubmit(req: Request, chainId: string, address: string, kind: "stdjson" | "metadata") {
  const rl = await allowSubmit(req);
  if (!rl.ok) return error(429, "too_many_requests", "rate limited; verification is expensive, retry shortly");
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || "null");
  } catch (e) {
    if (e instanceof BodyTooLarge) return error(413, "payload_too_large", "request body is too large");
    return error(400, "invalid_json", "request body is not valid JSON");
  }
  return guarded(() => sourcifyVerify(verifyDeps(), chainId, address, body, kind));
}

export async function sourcifyJobStatus(req: Request, id: string) {
  const rl = await allowRead(req);
  if (!rl.ok) return error(429, "too_many_requests", "rate limit exceeded");
  return guarded(() => sourcifyJob(verifyDeps(), id));
}

export async function sourcifyContractLookup(req: Request, chainId: string, address: string) {
  const rl = await allowRead(req);
  if (!rl.ok) return error(429, "too_many_requests", "rate limit exceeded");
  return guarded(() => sourcifyContract(verifyDeps(), chainId, address, new URL(req.url).searchParams.get("fields")));
}
