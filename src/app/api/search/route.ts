import type { Address, Hex } from "viem";
import { getAddress, getTransaction, getBlock } from "@/lib/harness/ops";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * Omni-search resolver. Classifies the query by shape and resolves it to a
 * canonical entity (address / transaction / block), or flags it as natural
 * language for the agent (DESIGN_HARNESS_AND_SETTINGS.md §A6).
 */
export async function GET(req: Request) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ error: "missing ?q" }, { status: 400 });

  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      const info = await getAddress(q as Address);
      return Response.json({
        type: info.isContract ? "contract" : "address",
        result: info,
      });
    }

    if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
      // 32-byte hash: try a transaction first, then a block by hash.
      try {
        const tx = await getTransaction(q as Hex);
        return Response.json({ type: "transaction", result: tx });
      } catch {
        const block = await getBlock(q as Hex);
        return Response.json({ type: "block", result: block });
      }
    }

    if (/^\d+$/.test(q)) {
      const block = await getBlock(Number(q));
      return Response.json({ type: "block", result: block });
    }

    // Natural language → hand off to the AI agent.
    return Response.json({
      type: "nl",
      query: q,
      suggestion: "Ask CitrateScan — POST this to /api/chat for an agent answer.",
    });
  } catch (err) {
    return Response.json(
      { type: "unknown", query: q, error: publicMessage(err, "api.search", "not found or RPC unavailable") },
      { status: 404 },
    );
  }
}
