import { readAgent, agentSbtSource } from "@/lib/harness/agentSbt";
import { parseAgentTokenId } from "@/lib/citrate/agentSbt";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * GET /api/agents/[tokenId] : one agent's DID, owner, parent org, mint tx and mint sender (HUP US-7.1 AC2).
 * Data source (Rule 11): AgentSBT (canonical address book) getAgent/ownerOf, the parent
 * OrganizationSBT getOrg, Transfer logs (indexed token_transfers, else a bounded eth_getLogs window)
 * and the mint transaction (eth_getTransactionByHash) for its sender.
 */
export async function GET(req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const { tokenId: raw } = await ctx.params;
  const tokenId = parseAgentTokenId(raw);
  if (tokenId === null) return Response.json({ error: "invalid token id (a decimal integer)" }, { status: 400 });
  const src = agentSbtSource();
  if (!src) return Response.json({ error: "no AgentSBT in this explorer's address book" }, { status: 404 });
  try {
    const agent = await readAgent(src, tokenId);
    if (!agent) return Response.json({ error: `agent #${tokenId} is not registered` }, { status: 404 });
    return Response.json(agent);
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.agents.one") }, { status: 502 });
  }
}
