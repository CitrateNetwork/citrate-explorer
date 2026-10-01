import { getVerifiedSource } from "@/lib/verify/verifiedSource";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * GET /api/contract/[addr]/source — the read-only verified-source lookup
 * (HUP-S4.3 / federation F-6). Returns the verified source, ABI, and compiler
 * metadata recorded by the recompile-and-diff engine, or an honest status:
 * "unverified" (no passing record) or "unavailable" (store not provisioned).
 *
 * Lean by design: no RPC and no bytecode, so agents (citrate-core's
 * get_verified_source tool) can call it cheaply. Data source: Neon
 * `contract_verifications` (see src/lib/verify/verifiedSource.ts).
 *
 * Optional `?maxSourceChars=N` bounds the returned source (default 60000).
 */
export async function GET(req: Request, ctx: { params: Promise<{ addr: string }> }) {
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  const raw = new URL(req.url).searchParams.get("maxSourceChars");
  const maxSourceChars = raw !== null && /^\d{1,7}$/.test(raw) ? Number(raw) : undefined;
  const result = await getVerifiedSource(addr, { maxSourceChars });
  return Response.json(result);
}
