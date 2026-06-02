import { getBlock } from "@/lib/harness/ops";
import { getRecentBlocks } from "@/lib/indexer/repository";

/**
 * Recent blocks. Prefers the indexer (fast, blue_score-ordered); falls back to
 * the live head block via RPC when the index isn't provisioned (Rule 11: real
 * data either way, and it says which source it used).
 */
export async function GET() {
  const indexed = await getRecentBlocks(25);
  if (Array.isArray(indexed)) {
    return Response.json({ source: "index", blocks: indexed });
  }
  // Not provisioned → return the live head from RPC.
  try {
    const head = await getBlock("latest");
    return Response.json({ source: "rpc", note: indexed.note, blocks: [head] });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
