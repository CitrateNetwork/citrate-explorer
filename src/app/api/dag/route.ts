import { dagOverview } from "@/lib/harness/ops";

/**
 * DAG topology snapshot (tips, blue/red counts, finality params). The realtime
 * websocket delta stream is layered on in S-3; this snapshot endpoint is the
 * baseline the live view bootstraps from.
 */
export async function GET() {
  try {
    return Response.json(await dagOverview());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
