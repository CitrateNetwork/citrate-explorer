import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";
import { verifyDeps } from "@/lib/verify/deps";
import { verifiedResponse } from "@/lib/verify/read";

/**
 * GET /api/contract/[addr]/verified: the verification v2 record for the code at this
 * address now (EXP-S3 / explorer#52), as VerifiedContractResponseV2
 * (src/lib/contract/v2Types.ts). The contract page reads it through createApiSourceV2,
 * so every source file, the deployed source map, the settings and the creation match
 * reach the Code tab. Records copied forward from the v1 store (migration 0006) come back
 * as legacy records (one file, no genesis or code hash).
 *
 * Data sources (Rule 7): the verified_contracts / contract_proxies tables, keyed by the
 * chain's genesis hash and the live runtime code hash read from the Citrate RPC
 * (src/lib/verify/read.ts resolveVerified).
 */
export async function GET(req: Request, ctx: { params: Promise<{ addr: string }> }) {
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  const { db, chain } = verifyDeps();
  try {
    return Response.json(await verifiedResponse(db, chain, addr.toLowerCase()));
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.contract.verified") }, { status: 502 });
  }
}
