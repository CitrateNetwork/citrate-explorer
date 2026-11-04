/** Sourcify v2: `GET /v2/verify/{verificationId}` (EXP-S2). Data sources: see src/lib/verify/sourcify.ts. */
import { sourcifyJobStatus } from "@/lib/verify/sourcifyRoute";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return sourcifyJobStatus(req, id);
}
