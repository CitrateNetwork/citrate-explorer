/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * View models for the AgentSBT screens (HUP US-7.1 AC2). Pure maps from the
 * `/api/agents` and `/api/agents/[tokenId]` responses to what the screens
 * render, kept apart from React so they are unit-testable.
 *
 * Data source (Rule 11): the `/api/agents*` routes (AgentSBT over live RPC).
 */
import { ZERO_ADDRESS } from "@/lib/citrate/agentSbt";

/** The empty-state line for a deployed registry with no agents. */
export const EMPTY_AGENTS_LINE = "No agents registered yet.";

export interface AgentRowView {
  tokenId: string;
  owner: string | null;
  parentOrgId: string;
  /** The DID string when it matched the owner, else the stored hash. */
  didLabel: string;
  didNamed: boolean;
  quarantined: boolean;
}

export interface AgentsPageView {
  registry: string | null;
  deployed: boolean;
  total: number;
  rows: AgentRowView[];
  nextBefore: string | null;
  /** The honest one-liner when there is nothing to list, else null. */
  emptyLine: string | null;
}

function didLabel(did: { hash?: string; did?: string | null; empty?: boolean } | null | undefined) {
  if (!did) return { didLabel: "—", didNamed: false };
  if (did.did) return { didLabel: did.did, didNamed: true };
  if (did.empty) return { didLabel: "(none recorded)", didNamed: false };
  return { didLabel: did.hash ?? "—", didNamed: false };
}

/** Map the list response. Null when absent or errored. */
export function deriveAgentsView(data: any): AgentsPageView | null {
  if (!data || data.error) return null;
  const reg = data.registry ?? null;
  const rows: AgentRowView[] = (data.agents ?? []).map((a: any) => ({
    tokenId: String(a.tokenId),
    owner: a.owner ?? null,
    parentOrgId: String(a.parentOrgId ?? "—"),
    ...didLabel(a.did),
    quarantined: Boolean(a.quarantined),
  }));
  const total = reg ? Number(reg.total ?? 0) : 0;
  const emptyLine = rows.length ? null : data.note || EMPTY_AGENTS_LINE;
  return {
    registry: reg ? reg.address : null,
    deployed: reg ? Boolean(reg.deployed) : false,
    total,
    rows,
    nextBefore: data.nextBefore ?? null,
    emptyLine,
  };
}

export interface AgentDetailView {
  registry: string;
  tokenId: string;
  owner: string | null;
  didLabel: string;
  didNamed: boolean;
  didHash: string;
  fingerprint: string;
  quarantined: boolean;
  parentOrg: { id: string; contract: string | null; active: boolean | null; signingAuthority: string | null; did: string | null };
  mintTx: string | null;
  mintBlock: string | null;
  transfers: Array<{ kind: "mint" | "burn" | "transfer"; from: string; to: string; txHash: string | null; blockNumber: string | null }>;
  /** Plain sentence on where the history came from and whether it is complete. */
  historyNote: string;
  summary: string;
}

/** Map the single-agent response. Null when absent or errored. */
export function deriveAgentView(data: any): AgentDetailView | null {
  if (!data || data.error || data.tokenId === undefined) return null;
  const d = didLabel(data.did);
  const transfers = (data.transfers ?? []).map((t: any) => ({
    kind: t.from === ZERO_ADDRESS ? ("mint" as const) : t.to === ZERO_ADDRESS ? ("burn" as const) : ("transfer" as const),
    from: t.from,
    to: t.to,
    txHash: t.txHash ?? null,
    blockNumber: t.blockNumber ?? null,
  }));
  const h = data.history ?? {};
  const historyNote =
    h.source === "indexer"
      ? "History from the explorer's index."
      : h.complete
        ? `History from Transfer logs, blocks ${h.fromBlock} to ${h.toBlock}.`
        : `History from Transfer logs in the last blocks ${h.fromBlock} to ${h.toBlock}. ` +
          (data.mint ? "" : "The mint is older than this window and appears here once the indexer covers it.");
  const org = data.parentOrg ?? {};
  const orgState = org.active === true ? "an active" : org.active === false ? "an inactive" : "a";
  const summary =
    `Agent #${data.tokenId} is a soulbound AgentSBT held by ${data.owner ?? "no current owner"}, ` +
    `under ${orgState} parent organization #${org.id ?? "?"}.` +
    (data.quarantined ? " It is quarantined." : "") +
    (d.didNamed ? ` Its DID is ${d.didLabel}.` : "");
  return {
    registry: data.registry,
    tokenId: String(data.tokenId),
    owner: data.owner ?? null,
    didLabel: d.didLabel,
    didNamed: d.didNamed,
    didHash: data.did?.hash ?? "—",
    fingerprint: data.pubkeyFingerprint ?? "—",
    quarantined: Boolean(data.quarantined),
    parentOrg: {
      id: String(org.id ?? "—"),
      contract: org.contract ?? null,
      active: org.active ?? null,
      signingAuthority: org.signingAuthority ?? null,
      did: org.did ?? null,
    },
    mintTx: data.mint?.txHash ?? null,
    mintBlock: data.mint?.blockNumber ?? null,
    transfers,
    historyNote: historyNote.trim(),
    summary,
  };
}

/**
 * AgentSBT token ids an address received, from its indexed token transfers
 * (`/api/address/[addr]` tokenTransfers). Used to link an address page to its
 * agent pages. Empty when the index is not provisioned.
 */
export function agentIdsHeldBy(addr: string, tokenTransfers: any, sbt: string | null): string[] {
  if (!sbt || !tokenTransfers || !tokenTransfers.provisioned) return [];
  const a = addr.toLowerCase();
  const s = sbt.toLowerCase();
  const ids = new Set<string>();
  // Oldest first, so a later transfer out removes an id an earlier mint added.
  const rows = [...(tokenTransfers.results ?? [])].sort((x: any, y: any) => Number(x.blockHeight ?? 0) - Number(y.blockHeight ?? 0));
  for (const t of rows) {
    if ((t.token ?? "").toLowerCase() !== s || t.tokenId == null) continue;
    if ((t.to ?? "").toLowerCase() === a) ids.add(String(t.tokenId));
    if ((t.from ?? "").toLowerCase() === a) ids.delete(String(t.tokenId));
  }
  return [...ids].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
}
