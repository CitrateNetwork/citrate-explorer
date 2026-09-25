import type { Hex } from "viem";
import { getTransaction } from "@/lib/harness/ops";
import { getDagBlock, dagStats, isFinal } from "@/lib/citrate/rpc";
import { publicMessage } from "@/lib/api/errors";

/**
 * Transaction detail (tx + receipt) by hash, enriched with its block's timestamp
 * and blue_score + finality so the explorer's tx page renders consensus context
 * in one fetch. Decoded events / internal txns / state diff are layered on by the
 * indexer + the AI agent's explainTransaction (P-2); this returns the core facts. (P-1)
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hash: string }> },
) {
  const { hash } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return Response.json({ error: "invalid tx hash" }, { status: 400 });
  }
  try {
    const tx = await getTransaction(hash as Hex);

    let timestamp: number | null = null;
    let blueScore: number | null = null;
    let finalized = false;
    if (tx.blockNumber) {
      try {
        const block = await getDagBlock(Number(tx.blockNumber));
        if (block) {
          timestamp = block.timestamp;
          blueScore = block.blueScore;
          const stats = await dagStats();
          finalized = isFinal(block.blueScore, stats);
        }
      } catch {
        /* block lookup failed — return tx core without consensus context */
      }
    }

    const methodId = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null;
    return Response.json({
      ...tx,
      methodId,
      timestamp,
      blueScore,
      finalized,
      isCreate: !tx.to,
    });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.tx", "transaction not found or RPC unavailable") }, { status: 404 });
  }
}
