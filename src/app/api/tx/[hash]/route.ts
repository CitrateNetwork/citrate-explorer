import type { Hex } from "viem";
import { getTransaction } from "@/lib/harness/ops";

/** Transaction detail (tx + receipt) by hash. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hash: string }> },
) {
  const { hash } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return Response.json({ error: "invalid tx hash" }, { status: 400 });
  }
  try {
    return Response.json(await getTransaction(hash as Hex));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
