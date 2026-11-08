import { cachedRead } from "@/lib/api/cache";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";
import { buildLedgerSnapshot } from "@/lib/citrate/ledger";
import { sharedDagStats } from "@/lib/citrate/sharedDagStats";
import { instanceChainFeed, r1007Requester, sharedR1007Capabilities } from "@/lib/citrate/r1007Server";

/**
 * Network-state snapshot for the home and DAG pages (EXP-REDESIGN): the newest
 * heights with their GhostDAG header fields, the tips, the latest transactions,
 * and the r1007 data (siblings, mergesets, finality, chain changes) when the
 * node serves it. `capabilities` says which r1007 methods were detected, so
 * the UI can say "available after the r1007 upgrade" instead of guessing.
 *
 * Cached 4 s per instance with stale-on-error, like /api/latest.
 *
 * Data source (Rule 7): live Citrate JSON-RPC; see LEDGER_SOURCES in
 * src/lib/citrate/ledger.ts for each figure.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("heights") ?? 40) || 40, 10), 60);
  try {
    const { data, stale, ageMs } = await cachedRead(`ledger:${n}`, 4000, async () =>
      buildLedgerSnapshot(
        {
          req: r1007Requester,
          dagStats: sharedDagStats,
          capabilities: await sharedR1007Capabilities(),
          chainFeed: instanceChainFeed,
        },
        { heights: n, txLimit: 12 },
      ),
    );
    return Response.json(stale ? { ...data, _stale: true, _ageMs: ageMs } : data);
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.ledger") }, { status: 502 });
  }
}
