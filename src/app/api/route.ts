/**
 * Etherscan-compatible API root: `GET|POST /api?module=…&action=…` (EXP-S2).
 *
 * `module=contract` (verifysourcecode, checkverifystatus, getabi, getsourcecode,
 * getcontractcreation, verifyproxycontract, checkproxyverification) is handled
 * here, form-encoded POST or GET, so standard tools point at
 * `https://explorer.citrate.ai/api`. Every other module is the existing
 * key-gated read API (/api/v1), served at this path as well.
 *
 * Verification submissions only enqueue; the verify worker compiles.
 * Data sources (Rule 7): see src/lib/verify/etherscan.ts.
 */
import { GET as v1Get } from "./v1/route";
import { publicMessage } from "@/lib/api/errors";
import { contractAction, notok, RATE_LIMITED, SUBMIT_ACTIONS, type EtherscanReply } from "@/lib/verify/etherscan";
import { verifyDeps } from "@/lib/verify/deps";
import { allowRead, allowSubmit, BodyTooLarge, readBody } from "@/lib/verify/http";

export const maxDuration = 30;

const reply = (r: EtherscanReply, status = 200) => Response.json(r, { status });

async function params(req: Request, method: "GET" | "POST"): Promise<URLSearchParams> {
  const p = new URLSearchParams(new URL(req.url).search);
  if (method === "GET") return p;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const text = await readBody(req);
  let body: URLSearchParams;
  if (ct.includes("application/json")) {
    const j = JSON.parse(text || "{}") as Record<string, unknown>;
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(j)) if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  } else if (ct.includes("multipart/form-data")) {
    const form = await new Response(text, { headers: { "content-type": ct } }).formData();
    body = new URLSearchParams();
    for (const [k, v] of form.entries()) if (typeof v === "string") body.set(k, v);
  } else {
    body = new URLSearchParams(text);
  }
  for (const [k, v] of body.entries()) p.set(k, v);
  return p;
}

async function handle(req: Request, method: "GET" | "POST"): Promise<Response> {
  const query = new URL(req.url).searchParams;
  if (method === "GET" && (query.get("module") ?? "").toLowerCase() !== "contract") return v1Get(req);

  let p: URLSearchParams;
  try {
    p = await params(req, method);
  } catch (e) {
    if (e instanceof BodyTooLarge) return reply(notok("request body is too large"), 413);
    return reply(notok("could not parse the request body"));
  }
  if ((p.get("module") ?? "").toLowerCase() !== "contract") return reply(notok("only module=contract accepts POST"));
  const action = (p.get("action") ?? "").toLowerCase();

  const rl = SUBMIT_ACTIONS.has(action) ? await allowSubmit(req) : await allowRead(req);
  if (!rl.ok) return reply(notok(RATE_LIMITED));

  try {
    return reply(await contractAction(action, p, method, verifyDeps()));
  } catch (err) {
    return reply(notok(publicMessage(err, "api.contract", "verification service error; please retry")));
  }
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}
