/**
 * Sourcify v2: `POST /v2/verify/{chainId}/{address}` with a standard JSON input (EXP-S2).
 * (The first segment is named `id` because Next requires one slug name per level;
 * here it is the chain id.) Data sources: see src/lib/verify/sourcify.ts.
 */
import { sourcifySubmit } from "@/lib/verify/sourcifyRoute";

export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; address: string }> }) {
  const { id, address } = await ctx.params;
  return sourcifySubmit(req, id, address, "stdjson");
}
