import type { Hex } from "viem";
import { getBlock } from "@/lib/harness/ops";

/** Block detail by height (number) or 0x block hash. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const ref = id.startsWith("0x") ? (id as Hex) : Number(id);
    if (typeof ref === "number" && Number.isNaN(ref)) {
      return Response.json({ error: "invalid block id" }, { status: 400 });
    }
    return Response.json(await getBlock(ref));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
