import type { Hex } from "viem";
import { getDagBlock, dagStats, isFinal } from "@/lib/citrate/rpc";

/**
 * Block detail by height (number) or 0x block hash — DAG-rich: exposes
 * blue_score, selected vs merge parents, and finality (not just the linear
 * fields), which the explorer's block page needs. (P-1)
 */
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
    const block = await getDagBlock(ref);
    if (!block) return Response.json({ error: "block not found" }, { status: 404 });

    // Only assert finality when the node actually gave a per-block blue_score.
    // FINDINGS-001: today eth_getBlockByNumber returns no blue_score, so this
    // stays false rather than fabricating "finalized" from a 0 score.
    let finalized = false;
    let depth = 0;
    if (block.blueScore > 0) {
      try {
        const stats = await dagStats();
        finalized = isFinal(block.blueScore, stats);
        depth = stats.maxBlueScore - block.blueScore;
      } catch {
        /* dag stats unavailable — report what we have */
      }
    }

    return Response.json({
      hash: block.hash,
      height: block.height,
      blueScore: block.blueScore,
      blueWork: block.blueWork,
      timestamp: block.timestamp,
      selectedParent: block.selectedParent,
      mergeParents: block.mergeParents,
      proposer: block.proposer,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeePerGas: block.baseFeePerGas,
      txCount: block.txCount,
      finalized,
      depth,
      transactions: (block.raw.transactions ?? []).map((t) => ({
        hash: t.hash,
        from: t.from,
        to: t.to ?? null,
      })),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
