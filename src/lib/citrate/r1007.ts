/**
 * r1007 read methods (planset 2026-11-03-r1007-v060, 02 §3; spec 06 §5.4 and
 * §5.5): feature detection and tolerant parsing.
 *
 * The CNV-RPC lane adds these methods to citrate-chain. Until a node serves
 * them, the explorer shows "available after the r1007 upgrade" for the figures
 * that need them and never derives a substitute (Rule 1). Detection is by
 * calling each method: JSON-RPC -32601 means absent; any other JSON-RPC error
 * means present (it rejected the probe's params); a transport failure rethrows
 * so callers do not mistake an outage for "not upgraded".
 *
 * The shapes follow the spec. `citrate_getFinalityStatus` follows the
 * implementation on r1007/s3-finality-voting (core/api/src/finality_status.rs).
 * The other parsers accept camelCase and snake_case so a field-naming choice on
 * the chain side does not blank the UI.
 *
 * Data source (Rule 7): live Citrate JSON-RPC.
 */

export const R1007_METHODS = {
  blocksAtHeight: "citrate_getBlocksAtHeight",
  ghostdagData: "citrate_getGhostdagData",
  selectedChainChanges: "citrate_getSelectedChainChanges",
  acceptingBlock: "citrate_getAcceptingBlock",
  finalityStatus: "citrate_getFinalityStatus",
} as const;

export type R1007Method = keyof typeof R1007_METHODS;
export type R1007Feature = R1007Method | "dagStatsCounts";
export type R1007Capabilities = Record<R1007Feature, boolean>;

/** Issues one JSON-RPC call. */
export type Requester = (method: string, params: unknown[]) => Promise<unknown>;

export const ZERO_HASH = "0x" + "0".repeat(64);

/** Probe params: valid shapes that need no real block. */
const PROBE_PARAMS: Record<R1007Method, unknown[]> = {
  blocksAtHeight: ["0x0"],
  ghostdagData: [ZERO_HASH],
  selectedChainChanges: [ZERO_HASH],
  acceptingBlock: [ZERO_HASH],
  finalityStatus: [],
};

export const NO_R1007: R1007Capabilities = {
  blocksAtHeight: false,
  ghostdagData: false,
  selectedChainChanges: false,
  acceptingBlock: false,
  finalityStatus: false,
  dagStatsCounts: false,
};

function causeChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 8; i++) {
    out.push(e);
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

function codeOf(e: unknown): number | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "number" ? c : undefined;
}

function textOf(e: unknown): string {
  const o = e as { message?: unknown; details?: unknown; shortMessage?: unknown } | null;
  return [o?.message, o?.details, o?.shortMessage].filter((x) => typeof x === "string").join(" ");
}

/** True when the node says the method does not exist (JSON-RPC -32601). */
export function isMethodNotFound(err: unknown): boolean {
  return causeChain(err).some(
    (e) => codeOf(e) === -32601 || /method not found|does not exist|is not available|not supported/i.test(textOf(e)),
  );
}

/** True when the failure is a JSON-RPC error reply (as opposed to a transport failure). */
export function isRpcError(err: unknown): boolean {
  return causeChain(err).some((e) => {
    const c = codeOf(e);
    return c !== undefined && c <= -32000 && c >= -32768;
  }) || isMethodNotFound(err);
}

async function probeOne(req: Requester, m: R1007Method): Promise<boolean> {
  try {
    await req(R1007_METHODS[m], PROBE_PARAMS[m]);
    return true;
  } catch (err) {
    if (isMethodNotFound(err)) return false;
    if (isRpcError(err)) return true;
    throw err;
  }
}

/** Which r1007 features this node serves. Rethrows on a transport failure. */
export async function probeR1007Capabilities(req: Requester): Promise<R1007Capabilities> {
  const methods = Object.keys(R1007_METHODS) as R1007Method[];
  const [flags, stats] = await Promise.all([
    Promise.all(methods.map((m) => probeOne(req, m))),
    req("citrate_getDagStats", []),
  ]);
  const caps = { ...NO_R1007 };
  methods.forEach((m, i) => {
    caps[m] = flags[i];
  });
  caps.dagStatsCounts = parseDagCounts(stats) !== null;
  return caps;
}

// ---------------------------------------------------------------------------
// parsing helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

/** Hex or decimal (string or number) to a JS number; null when absent or invalid. */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.length) {
    try {
      return v.startsWith("0x") ? Number(BigInt(v)) : Number.isFinite(Number(v)) ? Number(v) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Hex or decimal to a decimal string (big values stay exact). */
function toBigStr(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)).toString() : null;
  if (typeof v === "string" && v.length) {
    try {
      return BigInt(v).toString();
    } catch {
      return null;
    }
  }
  return null;
}

const hashes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : isObj(x) && typeof x.hash === "string" ? x.hash : null)).filter((x): x is string => !!x) : [];

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true;

// ---------------------------------------------------------------------------
// citrate_getGhostdagData(hash)

export interface GhostdagData {
  hash: string;
  blueScore: number;
  blueWork: string;
  selectedParent: string | null;
  mergesetBlues: string[];
  mergesetReds: string[];
  blueAnticoneSize: number | null;
}

export function parseGhostdagData(raw: unknown, hash: string): GhostdagData | null {
  if (!isObj(raw)) return null;
  const blueScore = toNum(pick(raw, "blueScore", "blue_score"));
  if (blueScore === null) return null;
  return {
    hash,
    blueScore,
    blueWork: toBigStr(pick(raw, "blueWork", "blue_work")) ?? "0",
    selectedParent: str(pick(raw, "selectedParent", "selected_parent", "selectedParentHash")),
    mergesetBlues: hashes(pick(raw, "mergesetBlues", "mergeset_blues")),
    mergesetReds: hashes(pick(raw, "mergesetReds", "mergeset_reds")),
    blueAnticoneSize: toNum(pick(raw, "blueAnticoneSize", "blue_anticone_size")),
  };
}

// ---------------------------------------------------------------------------
// citrate_getFinalityStatus

export interface FinalityCheckpoint {
  height: number;
  blockHash: string;
  committeeSize: number;
  voters: number;
  /** Percent of the committee stake that has voted. */
  quorumPct: number;
  hasQuorum: boolean;
}

export interface FinalityStatus {
  published: boolean;
  voting: boolean;
  enforcement: boolean;
  mode: string | null;
  halted: boolean;
  interval: number | null;
  quorumRule: string | null;
  finalized: FinalityCheckpoint | null;
  pending: FinalityCheckpoint[];
  dataSource: string | null;
}

function parseCheckpoint(raw: unknown): FinalityCheckpoint | null {
  if (!isObj(raw)) return null;
  const height = toNum(raw.height);
  if (height === null) return null;
  return {
    height,
    blockHash: str(raw.blockHash) ?? "",
    committeeSize: toNum(raw.committeeSize) ?? 0,
    voters: toNum(raw.voters) ?? 0,
    quorumPct: toNum(raw.quorumPct) ?? 0,
    hasQuorum: bool(raw.hasQuorum),
  };
}

export function parseFinalityStatus(raw: unknown): FinalityStatus | null {
  if (!isObj(raw)) return null;
  return {
    published: bool(raw.published),
    voting: bool(raw.voting),
    enforcement: bool(raw.enforcement),
    mode: str(raw.mode),
    halted: bool(raw.halted),
    interval: toNum(raw.interval),
    quorumRule: str(raw.quorumRule),
    finalized: parseCheckpoint(raw.finalized),
    pending: Array.isArray(raw.pending) ? raw.pending.map(parseCheckpoint).filter((x): x is FinalityCheckpoint => !!x) : [],
    dataSource: str(raw.dataSource),
  };
}

// ---------------------------------------------------------------------------
// citrate_getSelectedChainChanges(fromHash)

export interface ChainChanges {
  removed: string[];
  added: string[];
}

export function parseChainChanges(raw: unknown): ChainChanges | null {
  if (!isObj(raw)) return null;
  const removed = pick(raw, "removed", "removedChainBlockHashes", "removed_chain_block_hashes");
  const added = pick(raw, "added", "addedChainBlockHashes", "added_chain_block_hashes");
  if (!Array.isArray(removed) && !Array.isArray(added)) return null;
  return { removed: hashes(removed), added: hashes(added) };
}

// ---------------------------------------------------------------------------
// citrate_getAcceptingBlock(txHash)  (spec 06 §5.4)

export type InclusionColor = "selected_parent" | "blue" | "red" | "unaccepted";
export interface Inclusion {
  blockHash: string;
  dagHeight: number | null;
  color: InclusionColor | string;
  /** "executed" | "skipped:<reason>" | "pending" */
  outcome: string;
}
export interface AcceptingBlock {
  acceptingBlockHash: string | null;
  acceptingHeight: number | null;
  inclusions: Inclusion[];
}

export function parseAcceptingBlock(raw: unknown): AcceptingBlock | null {
  if (!isObj(raw)) return null;
  const inc = pick(raw, "inclusions");
  return {
    acceptingBlockHash: str(pick(raw, "acceptingBlockHash", "accepting_block_hash")),
    acceptingHeight: toNum(pick(raw, "acceptingHeight", "accepting_height")),
    inclusions: Array.isArray(inc)
      ? inc
          .filter(isObj)
          .map((x) => ({
            blockHash: str(pick(x, "blockHash", "block_hash")) ?? "",
            dagHeight: toNum(pick(x, "dagHeight", "dag_height")),
            color: str(x.color) ?? "unaccepted",
            outcome: str(x.outcome) ?? "pending",
          }))
          .filter((x) => x.blockHash)
      : [],
  };
}

// ---------------------------------------------------------------------------
// citrate_getBlocksAtHeight(h)

/** The hashes of every DAG block at a height (list of hashes or of block objects). */
export function parseBlocksAtHeight(raw: unknown): string[] {
  if (Array.isArray(raw)) return hashes(raw);
  if (isObj(raw)) return hashes(pick(raw, "blocks", "hashes"));
  return [];
}

// ---------------------------------------------------------------------------
// citrate_getDagStats counts (chain#317: null until fixed by CV-6)

export interface DagCounts {
  total: number;
  blue: number;
  red: number;
}

export function parseDagCounts(raw: unknown): DagCounts | null {
  if (!isObj(raw)) return null;
  const total = raw.totalBlocks, blue = raw.blueBlocks, red = raw.redBlocks;
  if (typeof total !== "number" || typeof blue !== "number" || typeof red !== "number") return null;
  return { total, blue, red };
}
