import { getRecentBlocks } from "@/lib/indexer/repository";
import { harnessClient } from "@/lib/harness/client";
import { getDagBlock } from "@/lib/citrate/rpc";
import { cachedRead } from "@/lib/api/cache";
import { publicMessage } from "@/lib/api/errors";

/**
 * Recent blocks. Prefers the indexer (fast, blue_score-ordered) — but ONLY when
 * it's fresh. If the index is unprovisioned OR lagging behind the chain head
 * (e.g. the worker stopped), we fall back to live RPC so the list never freezes
 * on stale data. Rule 11: real data either way, and it says which source + lag.
 */
const STALE_AFTER = Number(process.env.CITRATE_INDEXER_MAX_LAG ?? 50);
const N = 25;

async function liveRecent() {
  const head = Number(await harnessClient().getBlockNumber());
  const heights: number[] = [];
  for (let i = 0; i < N && head - i >= 0; i++) heights.push(head - i);
  const blocks = (await Promise.all(heights.map((h) => getDagBlock(h))))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((b) => ({
      hash: b.hash,
      height: b.height,
      blueScore: b.blueScore,
      timestamp: b.timestamp,
      txCount: b.txCount,
      proposer: b.proposer,
      selectedParent: b.selectedParent,
      mergeParents: b.mergeParents,
    }));
  return { head, blocks };
}

export async function GET() {
  const indexed = await getRecentBlocks(N);

  if (Array.isArray(indexed) && indexed.length) {
    // Have an index — is it fresh enough to trust?
    try {
      const head = Number(await harnessClient().getBlockNumber());
      const top = Number(indexed[0]?.height ?? 0);
      const lag = head - top;
      if (lag <= STALE_AFTER) {
        return Response.json({ source: "index", lag, blocks: indexed });
      }
      // Stale (worker stopped/behind) → serve live (cached, stale-on-error) so the
      // list stays current.
      const live = (await cachedRead("blocks:live", 3000, liveRecent)).data;
      return Response.json({
        source: "rpc",
        note: `index stale (${lag} blocks behind) — serving live`,
        blocks: live.blocks,
      });
    } catch {
      // Can't reach the head to judge freshness — serve what the index has.
      return Response.json({ source: "index", blocks: indexed });
    }
  }

  // No index (unprovisioned/empty) → live recent blocks (cached, stale-on-error).
  try {
    const live = (await cachedRead("blocks:live", 3000, liveRecent)).data;
    const note = Array.isArray(indexed) ? "index empty — serving live" : indexed.note;
    return Response.json({ source: "rpc", note, blocks: live.blocks });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.blocks") }, { status: 502 });
  }
}
