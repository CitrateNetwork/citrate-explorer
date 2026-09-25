import { dagOverview } from "@/lib/harness/ops";
import { cachedRead } from "@/lib/api/cache";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * DAG topology snapshot (tips, blue/red counts, finality params). Cached briefly
 * with stale-on-error fallback so a flapping RPC (502 blips) doesn't blank the
 * view — we serve the last-known-good snapshot, flagged `_stale`, until the node
 * recovers. The realtime delta stream is `/api/dag/stream`.
 */
export async function GET(req: Request) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  try {
    const { data, stale, ageMs } = await cachedRead("dag", 4000, () => dagOverview());
    return Response.json(stale ? { ...data, _stale: true, _ageMs: ageMs } : data);
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.dag") }, { status: 502 });
  }
}
