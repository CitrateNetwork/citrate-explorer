/**
 * AgentContext from the current hash route (EXP-AGENT default).
 *
 * EXP-REDESIGN's persistent "Ask" slot owns the page context and passes an
 * `AgentContext { kind, id, network }`; until it lands the drawer derives the
 * same shape from the route so the agent (and the write gate) know what page
 * the user is on. Pure.
 */
import { CITRATE_WRITE_CHAIN_ID, type AgentContext, type AgentContextKind } from "@/lib/contracts/types";

const KIND: Record<string, AgentContextKind> = {
  home: "home",
  block: "block",
  tx: "tx",
  address: "address",
  contract: "contract",
  token: "token",
  agent: "agent",
  dag: "dag",
  verify: "verify",
};

export function agentContextFromRoute(route: { name?: string; id?: string } | null | undefined): AgentContext {
  const kind = (route?.name && KIND[route.name]) || "other";
  const id = route?.id && /^[0-9A-Za-z:_-]{1,80}$/.test(route.id) ? route.id : undefined;
  return { kind, ...(id ? { id } : {}), network: { chainId: CITRATE_WRITE_CHAIN_ID, name: "citrate" } };
}
