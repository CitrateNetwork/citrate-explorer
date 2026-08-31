import type { Address } from "viem";
import { getAddress } from "@/lib/harness/ops";
import {
  addressActivity,
  searchTransactions,
  addressTokenTransfers,
} from "@/lib/indexer/repository";

/** Address page: live balance/nonce/code (RPC) + indexed activity, recent txs, and token transfers.
 *  Token transfers are included so a relayer-funded, nonce-0 recipient (an SBT mint / grant transfer,
 *  never a tx sender) still resolves with real on-chain history instead of an empty page. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ addr: string }> },
) {
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  try {
    const [info, activity, txs, tokenTransfers] = await Promise.all([
      getAddress(addr as Address),
      addressActivity(addr as Address),
      searchTransactions(addr as Address, 25),
      addressTokenTransfers(addr as Address, 25),
    ]);
    return Response.json({
      ...info,
      activity,
      recentTransactions: txs,
      tokenTransfers,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
