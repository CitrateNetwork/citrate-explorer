/** Sourcify v2: `GET /v2/contract/{chainId}/{address}?fields=…` (EXP-S2). Data sources: see src/lib/verify/sourcify.ts. */
import { sourcifyContractLookup } from "@/lib/verify/sourcifyRoute";

export async function GET(req: Request, ctx: { params: Promise<{ chainId: string; address: string }> }) {
  const { chainId, address } = await ctx.params;
  return sourcifyContractLookup(req, chainId, address);
}
