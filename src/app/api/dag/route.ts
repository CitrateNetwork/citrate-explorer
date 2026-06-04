import { dagOverview } from "@/lib/harness/ops";
import { cachedRead } from "@/lib/api/cache";

/**
 * DAG topology snapshot (tips, blue/red counts, finality params). Cached briefly
 * with stale-on-error fallback so a flapping RPC (502 blips) doesn't blank the
 * view — we serve the last-known-good snapshot, flagged `_stale`, until the node
 * recovers. The realtime delta stream is `/api/dag/stream`.
 */
export async function GET() {
  try {
    const { data, stale, ageMs } = await cachedRead("dag", 4000, () => dagOverview());
    return Response.json(stale ? { ...data, _stale: true, _ageMs: ageMs } : data);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
