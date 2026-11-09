/**
 * The agent's slot in the direction-B shell. The shell computes the page the
 * reader is on and hands it to the agent panel as `AgentContext`. The agent's
 * tools and approval flow belong to the EXP-AGENT lane; this file only defines
 * the value it receives. The panel sends it with each `/api/chat` request as
 * `pageContext`.
 */
import { shortHash } from "./format";

export const CITRATE_NETWORK = { chainId: 40204, name: "Citrate testnet" } as const;

export type AgentContextKind =
  | "network"
  | "dag"
  | "block"
  | "tx"
  | "address"
  | "contract"
  | "token"
  | "verify"
  | "agents"
  | "agent"
  | "developer"
  | "settings";

/**
 * The page the reader is on. One definition for the shell, the agent panel and
 * the chat route (which re-validates it: it is untrusted client input).
 */
export interface AgentContext {
  kind: AgentContextKind;
  /** The entity on screen: block height or hash, tx hash, address, agent id. */
  id: string | null;
  network: { chainId: number; name?: string };
}

/** All kinds, for the server's validation of a client-sent context. */
export const AGENT_CONTEXT_KINDS: readonly AgentContextKind[] = [
  "network", "dag", "block", "tx", "address", "contract", "token", "verify", "agents", "agent", "developer", "settings",
];

/** Ids a route may carry into the context: heights, hashes, addresses, token/agent ids. Anything else is dropped. */
export const AGENT_CONTEXT_ID_RE = /^[0-9A-Za-z:_-]{1,80}$/;

const ROUTE_KIND: Record<string, AgentContextKind> = {
  home: "network",
  dag: "dag",
  block: "block",
  tx: "tx",
  address: "address",
  contract: "contract",
  token: "token",
  verify: "verify",
  agents: "agents",
  agent: "agent",
  dev: "developer",
  settings: "settings",
};

/** From the hash router's `{ name, id }`. */
export function agentContextFromRoute(route: { name: string; id?: string | null }): AgentContext {
  const kind = ROUTE_KIND[route.name] ?? "network";
  const keepsId = kind !== "network" && kind !== "developer" && kind !== "settings";
  const id = keepsId && route.id && AGENT_CONTEXT_ID_RE.test(route.id) ? route.id : null;
  return { kind, id, network: CITRATE_NETWORK };
}

const NOUN: Record<AgentContextKind, string> = {
  network: "Network state",
  dag: "DAG ledger",
  block: "Block",
  tx: "Transaction",
  address: "Address",
  contract: "Contract",
  token: "Token",
  verify: "Verify source",
  agents: "Registered agents",
  agent: "Agent",
  developer: "Developer API",
  settings: "Settings",
};

/** Plain words for the panel's context strip. */
export function agentContextLabel(ctx: AgentContext): string {
  if (!ctx.id) return ctx.kind === "network" ? `Network state, chain ${ctx.network.chainId}` : NOUN[ctx.kind];
  const id = ctx.id.startsWith("0x") ? (ctx.id.length > 42 ? shortHash(ctx.id, 8, 4) : shortHash(ctx.id, 6, 4)) : ctx.id;
  return `${NOUN[ctx.kind]} ${id}`;
}
