/**
 * AgentSBT reads (HUP US-7.1 AC2): one agent's identity (DID, owner, parent org,
 * mint transaction and who sent it) and the registry's agent list. Read-only by
 * construction: every call is an `eth_getCode`, `eth_call`, `eth_blockNumber`,
 * `eth_getTransactionByHash` or a bounded `eth_getLogs` on the read-only harness
 * client; there is no signer here.
 *
 * Issuance (2026-10-05 reroll): members mint their own agent from their wallet
 * (gated on the membership SBT) under the member organization, and an operator
 * mint may still exist. So nothing here assumes who minted: the holder is
 * `ownerOf`, the parent org is what `getAgent` stores, and the minter is the
 * mint transaction's sender, which for a member mint is the holder itself.
 *
 * Data source (Rule 11): the AgentSBT pinned in the canonical address book
 * (`agentSbtAddress()`), read over live RPC via {@link harnessClient}; transfer
 * history from the indexed `token_transfers` table when the indexer is
 * provisioned, else a bounded `eth_getLogs` window ending at the head.
 *
 * The reads take an explicit `{ client, address }` source so the same code runs
 * against a local anvil deploy in tests and against chain 40204 in production.
 */
import { BaseError, ContractFunctionRevertedError, TransactionNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { harnessClient } from "./client";
import { assertLogRange, MAX_LOG_BLOCK_RANGE, MAX_LOG_CHUNK } from "./logBounds";
import {
  AGENT_SBT_ABI,
  AGENT_TRANSFER_EVENT,
  ORG_SBT_ABI,
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
  agentSbtAddress,
  describeDid,
  tokenIdTopic,
  type DidView,
} from "@/lib/citrate/agentSbt";
import { tokenIdTransfers } from "@/lib/indexer/repository";

export interface AgentSbtSource {
  client: PublicClient;
  address: Address;
}

/** The production source: the book's AgentSBT on the harness client, or null when the book has none. */
export function agentSbtSource(): AgentSbtSource | null {
  const address = agentSbtAddress();
  return address ? { client: harnessClient(), address } : null;
}

/** Shown when the registry is deployed and nothing has been minted. */
export const NO_AGENTS_NOTE = "No agents registered yet.";
/** Shown when this build's address book has no AgentSBT. */
export const NO_REGISTRY_NOTE = "This explorer's address book has no AgentSBT for this chain.";
/** Shown when the book's AgentSBT address has no code on chain. */
export const NOT_DEPLOYED_NOTE = "The AgentSBT in the address book has no code on this chain.";

/** The honest one-line state of a registry with no agents to show, or null when it has agents. */
export function agentListNote(registry: AgentRegistry): string | null {
  if (!registry.deployed) return NOT_DEPLOYED_NOTE;
  return registry.total === "0" ? NO_AGENTS_NOTE : null;
}

/** Most agents one list read returns. Each costs two eth_calls. */
export const MAX_AGENT_LIST = 25;

/** Blocks the RPC fallback scans for an agent's Transfer logs, ending at the head. */
export const AGENT_LOG_WINDOW = MAX_LOG_BLOCK_RANGE;

/** Most transfers kept per agent. A soulbound token has a mint and, at most, a burn. */
const MAX_AGENT_TRANSFERS = 50;

export interface AgentRegistry {
  address: string;
  /** False when the address has no code on this chain. */
  deployed: boolean;
  /** Agents minted so far (`nextTokenId`), decimal. "0" means no agents registered yet. */
  total: string;
  /** The parent OrganizationSBT the registry checks, or null when not readable. */
  orgContract: string | null;
}

export interface AgentTransfer {
  from: string;
  to: string;
  txHash: string | null;
  blockNumber: string | null;
  logIndex: number | null;
}

export interface AgentHistory {
  /** Where the transfer list came from. */
  source: "indexer" | "rpc-window";
  /** The scanned block range (rpc-window only). */
  fromBlock: string | null;
  toBlock: string | null;
  /** True when the list covers the token's whole life (indexer, or a window that starts at block 0). */
  complete: boolean;
}

export interface AgentParentOrg {
  id: string;
  contract: string | null;
  did: string | null;
  active: boolean | null;
  signingAuthority: string | null;
}

export interface AgentDetail {
  registry: string;
  tokenId: string;
  owner: string | null;
  did: DidView;
  pubkeyFingerprint: string;
  quarantined: boolean;
  parentOrg: AgentParentOrg;
  /** The mint (Transfer from the zero address), when the history covers it. */
  mint: AgentTransfer | null;
  /**
   * Who sent the mint transaction, lowercase, or null when the mint is outside the
   * history or the node has no such transaction. Equals `owner` for a member's own mint.
   */
  mintSender: string | null;
  transfers: AgentTransfer[];
  history: AgentHistory;
}

export interface AgentSummary {
  tokenId: string;
  owner: string | null;
  parentOrgId: string;
  did: DidView;
  quarantined: boolean;
}

export interface AgentList {
  registry: AgentRegistry;
  agents: AgentSummary[];
  /** Pass as `before` to read the next (older) page; null on the last page. */
  nextBefore: string | null;
}

interface RawAgent {
  parent_org_id: bigint;
  did: Hex;
  pubkey_fingerprint: Hex;
  quarantined: boolean;
}

async function hasCode(src: AgentSbtSource): Promise<boolean> {
  const code = (await src.client.getCode({ address: src.address })) ?? "0x";
  return code !== "0x" && code.length > 2;
}

async function readNextTokenId(src: AgentSbtSource): Promise<bigint> {
  return src.client.readContract({ address: src.address, abi: AGENT_SBT_ABI, functionName: "nextTokenId" });
}

async function readRawAgent(src: AgentSbtSource, tokenId: bigint): Promise<RawAgent> {
  return (await src.client.readContract({
    address: src.address,
    abi: AGENT_SBT_ABI,
    functionName: "getAgent",
    args: [tokenId],
  })) as RawAgent;
}

/**
 * ownerOf, or null when the contract reverts (ERC721NonexistentToken: no owner).
 * Any other failure (RPC down, timeout, bad response) is rethrown, so a flaky node
 * surfaces as an error instead of an agent shown with "no current owner".
 */
export async function readOwner(src: AgentSbtSource, tokenId: bigint): Promise<string | null> {
  try {
    const owner = await src.client.readContract({
      address: src.address,
      abi: AGENT_SBT_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });
    return owner.toLowerCase();
  } catch (err) {
    if (err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError)) return null;
    throw err;
  }
}

async function readOrgContract(src: AgentSbtSource): Promise<string | null> {
  try {
    const org = await src.client.readContract({ address: src.address, abi: AGENT_SBT_ABI, functionName: "orgContract" });
    return org.toLowerCase();
  } catch {
    return null;
  }
}

/** The registry's status: deployed, how many agents, which org contract. */
export async function readAgentRegistry(src: AgentSbtSource): Promise<AgentRegistry> {
  const address = src.address.toLowerCase();
  if (!(await hasCode(src))) return { address, deployed: false, total: "0", orgContract: null };
  const [total, orgContract] = await Promise.all([readNextTokenId(src), readOrgContract(src)]);
  return { address, deployed: true, total: total.toString(), orgContract };
}

async function readParentOrg(src: AgentSbtSource, orgContract: string | null, orgId: bigint): Promise<AgentParentOrg> {
  const base: AgentParentOrg = { id: orgId.toString(), contract: orgContract, did: null, active: null, signingAuthority: null };
  if (!orgContract) return base;
  try {
    const org = (await src.client.readContract({
      address: orgContract as Address,
      abi: ORG_SBT_ABI,
      functionName: "getOrg",
      args: [orgId],
    })) as { did: Hex; signing_authority: Address; active: boolean };
    return {
      ...base,
      did: org.did.toLowerCase(),
      active: org.active,
      signingAuthority: org.signing_authority.toLowerCase(),
    };
  } catch {
    return base;
  }
}

/**
 * Transfer logs for one token id over a bounded window ending at the head. Each
 * eth_getLogs call names the contract, the Transfer topic and the token id, and
 * spans at most MAX_LOG_CHUNK blocks (PBA-L3c-039 bounds).
 */
export async function agentTransferLogs(
  src: AgentSbtSource,
  tokenId: bigint,
  window: bigint = AGENT_LOG_WINDOW,
): Promise<{ transfers: AgentTransfer[]; history: AgentHistory }> {
  const head = await src.client.getBlockNumber();
  const fromBlock = head >= window ? head - window + 1n : 0n;
  assertLogRange(fromBlock, head, MAX_LOG_BLOCK_RANGE);
  const transfers: AgentTransfer[] = [];
  let chunkFrom = fromBlock;
  while (chunkFrom <= head && transfers.length < MAX_AGENT_TRANSFERS) {
    const chunkEnd = chunkFrom + MAX_LOG_CHUNK - 1n;
    const chunkTo = chunkEnd < head ? chunkEnd : head;
    const logs = await src.client.getLogs({
      address: src.address,
      event: AGENT_TRANSFER_EVENT,
      args: { tokenId },
      fromBlock: chunkFrom,
      toBlock: chunkTo,
    });
    for (const l of logs) {
      if (transfers.length >= MAX_AGENT_TRANSFERS) break;
      // The topic filter already pins the token id; check it anyway so a node that
      // ignores topics cannot attribute another token's transfer to this agent.
      if ((l.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC || (l.topics[3] ?? "").toLowerCase() !== tokenIdTopic(tokenId)) continue;
      transfers.push({
        from: (l.args.from ?? ZERO_ADDRESS).toLowerCase(),
        to: (l.args.to ?? ZERO_ADDRESS).toLowerCase(),
        txHash: l.transactionHash,
        blockNumber: l.blockNumber?.toString() ?? null,
        logIndex: l.logIndex,
      });
    }
    chunkFrom = chunkTo + 1n;
  }
  return {
    transfers,
    history: { source: "rpc-window", fromBlock: fromBlock.toString(), toBlock: head.toString(), complete: fromBlock === 0n },
  };
}

/**
 * The sender of a mint transaction, or null when the node does not have it. Any
 * other failure is rethrown, like {@link readOwner}, so a flaky node is an error.
 */
export async function readTxSender(src: AgentSbtSource, txHash: string | null): Promise<string | null> {
  if (!txHash) return null;
  try {
    const tx = await src.client.getTransaction({ hash: txHash as Hex });
    return tx.from.toLowerCase();
  } catch (err) {
    if (err instanceof BaseError && err.walk((e) => e instanceof TransactionNotFoundError)) return null;
    throw err;
  }
}

/** Transfer history: the index when provisioned, else the bounded RPC window. */
async function agentHistory(src: AgentSbtSource, tokenId: bigint): Promise<{ transfers: AgentTransfer[]; history: AgentHistory }> {
  const indexed = await tokenIdTransfers(src.address, tokenId, MAX_AGENT_TRANSFERS);
  if (indexed.provisioned && indexed.results.length > 0) {
    return {
      transfers: indexed.results.map((r) => ({
        from: r.from.toLowerCase(),
        to: r.to.toLowerCase(),
        txHash: r.txHash,
        blockNumber: r.blockHeight === null ? null : String(r.blockHeight),
        logIndex: r.logIndex,
      })),
      history: { source: "indexer", fromBlock: null, toBlock: null, complete: true },
    };
  }
  return agentTransferLogs(src, tokenId);
}

/**
 * One agent: getAgent(tokenId), its owner, its parent org and its Transfer
 * history. Returns null when the token id has not been minted (>= nextTokenId)
 * or the registry has no code.
 */
export async function readAgent(src: AgentSbtSource, tokenId: bigint): Promise<AgentDetail | null> {
  const registry = await readAgentRegistry(src);
  if (!registry.deployed || tokenId >= BigInt(registry.total)) return null;
  const [raw, owner, hist] = await Promise.all([readRawAgent(src, tokenId), readOwner(src, tokenId), agentHistory(src, tokenId)]);
  const mint = hist.transfers.find((t) => t.from === ZERO_ADDRESS) ?? null;
  const [parentOrg, mintSender] = await Promise.all([
    readParentOrg(src, registry.orgContract, raw.parent_org_id),
    readTxSender(src, mint?.txHash ?? null),
  ]);
  return {
    registry: registry.address,
    tokenId: tokenId.toString(),
    owner,
    did: describeDid(raw.did, owner),
    pubkeyFingerprint: raw.pubkey_fingerprint.toLowerCase(),
    quarantined: raw.quarantined,
    parentOrg,
    mint,
    mintSender,
    transfers: hist.transfers,
    history: hist.history,
  };
}

/**
 * The newest agents, newest first. `before` (exclusive) pages backwards; the
 * first page starts at the newest token. An empty registry returns no agents.
 */
export async function listAgents(
  src: AgentSbtSource,
  opts: { before?: bigint; limit?: number } = {},
): Promise<AgentList> {
  const registry = await readAgentRegistry(src);
  const total = BigInt(registry.total);
  const limit = BigInt(Math.max(1, Math.min(MAX_AGENT_LIST, Math.floor(opts.limit ?? MAX_AGENT_LIST))));
  const start = opts.before !== undefined && opts.before < total ? opts.before : total;
  const ids: bigint[] = [];
  for (let id = start - 1n; id >= 0n && BigInt(ids.length) < limit; id--) ids.push(id);
  const agents = await Promise.all(
    ids.map(async (id) => {
      const [raw, owner] = await Promise.all([readRawAgent(src, id), readOwner(src, id)]);
      return {
        tokenId: id.toString(),
        owner,
        parentOrgId: raw.parent_org_id.toString(),
        did: describeDid(raw.did, owner),
        quarantined: raw.quarantined,
      };
    }),
  );
  const last = ids.length ? ids[ids.length - 1] : 0n;
  return { registry, agents, nextBefore: ids.length && last > 0n ? last.toString() : null };
}

export type AgentLookup =
  | { found: true; agent: AgentDetail }
  | { found: false; registry: AgentRegistry | null; note: string };

/**
 * The agent tool's answer for one token id (MCP + in-app chat): the agent when it
 * exists, else an honest note saying why not (no registry in the book, no code,
 * no agents registered yet, or this id not minted).
 */
export async function lookupAgent(src: AgentSbtSource | null, tokenId: bigint): Promise<AgentLookup> {
  if (!src) return { found: false, registry: null, note: NO_REGISTRY_NOTE };
  const agent = await readAgent(src, tokenId);
  if (agent) return { found: true, agent };
  const registry = await readAgentRegistry(src);
  const note = agentListNote(registry) ?? `Agent #${tokenId} is not registered (${registry.total} agents so far).`;
  return { found: false, registry, note };
}
