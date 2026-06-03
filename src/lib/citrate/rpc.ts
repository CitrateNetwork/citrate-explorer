/**
 * DAG-aware RPC layer (S-1 WP-1.2). Typed wrappers over the Citrate JSON-RPC for
 * the DAG-native fields that viem's standard block type drops — `selected_parent_hash`,
 * `merge_parent_hashes[]`, `blue_score`, `blue_work` — plus the `citrate_*` methods
 * and the finality rule. This is the single place that parses a raw Citrate block,
 * shared by the indexer (src/lib/indexer) and the harness `exploreDag`.
 *
 * Data source (Rule 11): live Citrate RPC (`eth_getBlockByNumber/Hash`,
 * `citrate_getDagStats`) via the read-only client.
 */
import { createPublicClient, webSocket, http, type PublicClient } from "viem";
import { citrate } from "./chain";
import { harnessClient } from "@/lib/harness/client";
import { getDagStats, isFinalized, type DagStats } from "./dag";

export type { DagStats, GhostdagParams } from "./dag";

/** Issues a raw JSON-RPC request for Citrate's non-standard methods/fields. */
export async function citrateRequest<T>(
  client: PublicClient,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  return (await (
    client as unknown as {
      request: (a: { method: string; params: unknown[] }) => Promise<unknown>;
    }
  ).request({ method, params })) as T;
}

/** Raw Citrate block as returned over JSON-RPC (hex-encoded numerics). */
export interface RawCitrateBlock {
  hash: string;
  number: string;
  timestamp: string;
  parentHash: string;
  miner?: string;
  proposer?: string;
  gasUsed?: string;
  gasLimit?: string;
  baseFeePerGas?: string;
  stateRoot?: string;
  transactionsRoot?: string;
  receiptsRoot?: string;
  blueScore?: string;
  blueWork?: string;
  selectedParentHash?: string;
  mergeParentHashes?: string[];
  transactions?: RawCitrateTx[];
}

export interface RawCitrateTx {
  hash: string;
  from: string;
  to?: string | null;
  value: string;
  nonce: string;
  gas?: string;
  gasPrice?: string;
  input?: string;
  transactionIndex?: string;
  type?: string;
}

/** Parsed DAG block — DAG fields are first-class. Numerics are JS numbers/strings. */
export interface DagBlock {
  hash: string;
  height: number;
  blueScore: number;
  blueWork: string;
  /** The single selected parent (chain link). Falls back to parentHash. */
  selectedParent: string;
  /** Additional DAG parents (0–10), never the selected parent. */
  mergeParents: string[];
  timestamp: number;
  baseFeePerGas: string | null;
  gasUsed: number;
  gasLimit: number;
  proposer: string | null;
  txCount: number;
  raw: RawCitrateBlock;
}

const hexToNum = (h?: string): number => (h ? Number(BigInt(h)) : 0);
const hexToBig = (h?: string): string => (h ? BigInt(h).toString() : "0");
const toHex = (n: number | bigint): `0x${string}` => `0x${BigInt(n).toString(16)}`;

/** Parses a raw Citrate block into a {@link DagBlock}. */
export function parseDagBlock(raw: RawCitrateBlock): DagBlock {
  const selectedParent = raw.selectedParentHash ?? raw.parentHash;
  const mergeParents = (raw.mergeParentHashes ?? []).filter(
    (p) => p && p !== selectedParent,
  );
  return {
    hash: raw.hash,
    height: hexToNum(raw.number),
    blueScore: hexToNum(raw.blueScore),
    blueWork: hexToBig(raw.blueWork),
    selectedParent,
    mergeParents,
    timestamp: hexToNum(raw.timestamp),
    baseFeePerGas: raw.baseFeePerGas ? hexToBig(raw.baseFeePerGas) : null,
    gasUsed: hexToNum(raw.gasUsed),
    gasLimit: hexToNum(raw.gasLimit),
    proposer: raw.proposer ?? raw.miner ?? null,
    txCount: raw.transactions?.length ?? 0,
    raw,
  };
}

/** Fetches + parses a block by height, 0x hash, or "latest", exposing DAG fields. */
export async function getDagBlock(
  ref: "latest" | number | string,
  client: PublicClient = harnessClient(),
  includeTx = true,
): Promise<DagBlock | null> {
  const isHash = typeof ref === "string" && ref.startsWith("0x");
  const method = isHash ? "eth_getBlockByHash" : "eth_getBlockByNumber";
  const tag =
    ref === "latest" ? "latest" : isHash ? (ref as string) : toHex(ref as number);
  const raw = await citrateRequest<RawCitrateBlock | null>(client, method, [
    tag,
    includeTx,
  ]);
  return raw ? parseDagBlock(raw) : null;
}

/** Re-export: live GHOSTDAG snapshot (tips, blue/red, finality params). */
export async function dagStats(
  client: PublicClient = harnessClient(),
): Promise<DagStats> {
  return getDagStats(client);
}

/** A block is final iff `maxBlueScore − blueScore ≥ finalityDepth` (network 100). */
export function isFinal(blueScore: number, stats: DagStats): boolean {
  return isFinalized(blueScore, stats.maxBlueScore, stats.ghostdagParams.finalityDepth);
}

const WS_URL = process.env.NEXT_PUBLIC_CITRATE_WS_URL ?? "wss://rpc.citrate.ai";

/**
 * WebSocket public client for `eth_subscribe("newHeads")` (used by the indexer
 * worker). SERVER-ONLY. Falls back to HTTP polling is the caller's responsibility.
 */
export function wsClient(): PublicClient {
  return createPublicClient({ chain: citrate, transport: webSocket(WS_URL) });
}

/** HTTP public client (no fallback) — for the worker's backfill reads. */
export function httpClient(): PublicClient {
  const url = process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
  return createPublicClient({ chain: citrate, transport: http(url) });
}
