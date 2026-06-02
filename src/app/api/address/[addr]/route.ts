import type { Address } from "viem";
import { getAddress } from "@/lib/harness/ops";
import { addressActivity, searchTransactions } from "@/lib/indexer/repository";

/** Address page: live balance/nonce/code (RPC) + indexed activity & recent txs. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ addr: string }> },
) {
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  try {
    const [info, activity, txs] = await Promise.all([
      getAddress(addr as Address),
      addressActivity(addr as Address),
      searchTransactions(addr as Address, 25),
    ]);
    return Response.json({ ...info, activity, recentTransactions: txs });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
