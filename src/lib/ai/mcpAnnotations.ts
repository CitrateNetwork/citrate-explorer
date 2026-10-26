/**
 * MCP tool annotations, decided per tool.
 *
 * Spec-following MCP hosts (citrate-agent-runtime's agent-mcp-host) offer a tool to
 * an agent without a member decision only when the tool says `readOnlyHint: true`.
 * That is a claim this server makes on the member's behalf, so it is made per tool,
 * for tools someone has reviewed, and never as a blanket default.
 *
 * READ_ONLY_TOOLS lists every tool reviewed as read-only. A tool added to the
 * shared registry (`citrateTools()`) without being added here is annotated as a
 * write (not read-only, destructive, open-world), so a host asks the member before
 * using it. A test pins this list to the registry's tool names, so adding a tool
 * fails CI until someone decides which side it belongs on.
 */

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/**
 * Tools reviewed as read-only. Each one reads the explorer's index or the chain
 * (eth_call, eth_getLogs, block and receipt reads, verified source) and changes
 * nothing. The explorer's world is its own index plus the chain, so
 * openWorldHint is false.
 */
export const READ_ONLY_TOOLS: readonly string[] = Object.freeze([
  "getChainStatus",
  "getBlock",
  "getTransaction",
  "explainTransaction",
  "getAddress",
  "getBalance",
  "isContract",
  "getLogs",
  "exploreDag",
  "searchTransactions",
  "addressActivity",
  "recentActivity",
  "topHolders",
  "getContractCode",
  "getVerifiedSource",
  "getToken",
  "callView",
  "describeContract",
  "citrateContracts",
  "getGasOracle",
  "findTransfers",
  "saltDistribution",
  "ledger",
  "getAgent",
]);

/**
 * Private lookup built once from the frozen list. It is not exported, so no
 * caller can add a name to it and widen a later answer.
 */
const READ_ONLY_SET: ReadonlySet<string> = new Set(READ_ONLY_TOOLS);

const READ_ONLY: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** The conservative answer for any tool nobody has reviewed as read-only. */
const UNREVIEWED: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
});

/** Annotations for one tool, matched by exact name. */
export function annotationsFor(name: string): ToolAnnotations {
  return READ_ONLY_SET.has(name) ? READ_ONLY : UNREVIEWED;
}

/** True only when every named tool is in the reviewed read-only set. */
export function allReadOnly(names: Iterable<string>): boolean {
  for (const n of names) if (!READ_ONLY_SET.has(n)) return false;
  return true;
}
