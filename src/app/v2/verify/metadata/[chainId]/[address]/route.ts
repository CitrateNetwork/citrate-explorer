/**
 * Sourcify v2: `POST /v2/verify/metadata/{chainId}/{address}` with a solc
 * metadata.json and its sources (EXP-S2). Data sources: see src/lib/verify/sourcify.ts.
 */
import { sourcifySubmit } from "@/lib/verify/sourcifyRoute";

export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ chainId: string; address: string }> }) {
  const { chainId, address } = await ctx.params;
  return sourcifySubmit(req, chainId, address, "metadata");
}
