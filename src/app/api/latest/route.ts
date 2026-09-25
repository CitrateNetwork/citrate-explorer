import { harnessClient } from "@/lib/harness/client";
import { getDagBlock } from "@/lib/citrate/rpc";
import { cachedRead } from "@/lib/api/cache";
import { formatEther } from "viem";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * Recent activity for the home screen: the last N blocks (newest first) and the
 * most recent transactions flattened from them. Works on live RPC today (walks
 * back from the head) so the home is real even before the indexer is provisioned;
 * once the index exists it can serve this faster. (P-1)
 *
 * Data source (Rule 11): live `eth_getBlockByNumber` (with transactions).
 */
export async function GET(req: Request) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("n") ?? 8), 1), 20);
  try {
    // Cache briefly with stale-on-error so a flapping RPC doesn't blank the home.
    const { data, stale, ageMs } = await cachedRead(`latest:${n}`, 3000, () => build(n));
    return Response.json(stale ? { ...data, _stale: true, _ageMs: ageMs } : data);
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.latest") }, { status: 502 });
  }
}

async function build(n: number) {
  {
    const head = Number(await harnessClient().getBlockNumber());
    const heights: number[] = [];
    for (let i = 0; i < n && head - i >= 0; i++) heights.push(head - i);

    const dagBlocks = (await Promise.all(heights.map((h) => getDagBlock(h)))).filter(
      (b): b is NonNullable<typeof b> => Boolean(b),
    );

    const blocks = dagBlocks.map((b) => ({
      hash: b.hash,
      height: b.height,
      blueScore: b.blueScore,
      timestamp: b.timestamp,
      txCount: b.txCount,
      gasUsed: b.gasUsed,
      proposer: b.proposer,
      selectedParent: b.selectedParent,
      mergeParents: b.mergeParents,
    }));

    const transactions: Array<{
      hash: string;
      from: string;
      to: string | null;
      valueWei: string;
      valueSalt: string;
      blockHeight: number;
      timestamp: number;
      isCreate: boolean;
    }> = [];
    for (const b of dagBlocks) {
      for (const t of b.raw.transactions ?? []) {
        const wei = t.value ? BigInt(t.value) : 0n;
        transactions.push({
          hash: t.hash,
          from: t.from,
          to: t.to ?? null,
          valueWei: wei.toString(),
          valueSalt: formatEther(wei),
          blockHeight: b.height,
          timestamp: b.timestamp,
          isCreate: !t.to,
        });
        if (transactions.length >= n) break;
      }
      if (transactions.length >= n) break;
    }

    return { head, blocks, transactions };
  }
}
