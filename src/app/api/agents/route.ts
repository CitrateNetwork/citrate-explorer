import { listAgents, agentSbtSource, agentListNote, MAX_AGENT_LIST, NO_REGISTRY_NOTE } from "@/lib/harness/agentSbt";
import { parseAgentTokenId } from "@/lib/citrate/agentSbt";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * GET /api/agents?before=&limit= : the newest AgentSBT agents, newest first (HUP US-7.1 AC2).
 * Data source (Rule 11): AgentSBT (canonical address book) nextTokenId/getAgent/ownerOf over live RPC.
 */
export async function GET(req: Request) {
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const url = new URL(req.url);
  const beforeRaw = url.searchParams.get("before");
  const limitRaw = url.searchParams.get("limit");
  const before = beforeRaw === null ? undefined : parseAgentTokenId(beforeRaw);
  if (before === null) return Response.json({ error: "invalid before (a decimal token id)" }, { status: 400 });
  const limit = limitRaw === null ? MAX_AGENT_LIST : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AGENT_LIST) {
    return Response.json({ error: `invalid limit (1 to ${MAX_AGENT_LIST})` }, { status: 400 });
  }
  const src = agentSbtSource();
  if (!src) return Response.json({ registry: null, agents: [], nextBefore: null, note: NO_REGISTRY_NOTE });
  try {
    const list = await listAgents(src, { before, limit });
    return Response.json({ ...list, note: agentListNote(list.registry) });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.agents") }, { status: 502 });
  }
}
