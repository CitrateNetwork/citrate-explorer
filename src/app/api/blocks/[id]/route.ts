import type { Hex } from "viem";
import { getDagBlock, isFinal } from "@/lib/citrate/rpc";
import { sharedDagStats } from "@/lib/citrate/sharedDagStats";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";
import { formatEther } from "viem";
import { blockR1007 } from "@/lib/citrate/r1007Reads";
import { NO_R1007 } from "@/lib/citrate/r1007";
import { r1007Requester, sharedR1007Capabilities } from "@/lib/citrate/r1007Server";

/**
 * Block detail by height (number) or 0x block hash — DAG-rich: exposes
 * blue_score, selected vs merge parents, and finality (not just the linear
 * fields), which the explorer's block page needs. (P-1)
 *
 * EXP-REDESIGN: also returns `miner` and, under `r1007`, the GhostDAG data,
 * same-height siblings and checkpoint finality when the node serves those
 * methods (`capabilities` says which). Existing fields are unchanged.
 * Data source (Rule 7): live RPC eth_getBlockBy*, citrate_getDagStats, and the
 * r1007 methods in src/lib/citrate/r1007.ts.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
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
        const stats = await sharedDagStats();
        finalized = isFinal(block.blueScore, stats);
        depth = stats.maxBlueScore - block.blueScore;
      } catch {
        /* dag stats unavailable — report what we have */
      }
    }

    const caps = await sharedR1007Capabilities().catch(() => NO_R1007);
    const r1007 = await blockR1007(r1007Requester, caps, block.hash, block.height);

    return Response.json({
      hash: block.hash,
      height: block.height,
      blueScore: block.blueScore,
      blueWork: block.blueWork,
      timestamp: block.timestamp,
      selectedParent: block.selectedParent,
      mergeParents: block.mergeParents,
      proposer: block.proposer,
      miner: block.miner,
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
        valueSalt: formatEther(t.value ? BigInt(t.value) : BigInt(0)),
        methodId: t.input && t.input.length >= 10 ? t.input.slice(0, 10) : null,
      })),
      r1007,
    });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.block") }, { status: 502 });
  }
}
