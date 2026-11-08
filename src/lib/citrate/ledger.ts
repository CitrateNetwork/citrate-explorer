/**
 * The `/api/ledger` snapshot behind the direction-B home and DAG pages.
 *
 * Today's node: a header walk over the newest heights (`eth_getBlockByNumber`,
 * with transactions), the current tips by hash (`citrate_getDagStats` tips,
 * then `eth_getBlockByHash`). A height walk misses siblings because the node's
 * height index keeps one block per height (planset 02 §2.2), so the snapshot
 * says so and the UI labels the table.
 *
 * An r1007 node additionally serves, each used only when detected:
 * - `citrate_getBlocksAtHeight`: sibling-complete heights;
 * - `citrate_getGhostdagData`: real mergeset blues and reds per block;
 * - `citrate_getFinalityStatus`: the checkpoint (CV-8), never depth;
 * - `citrate_getSelectedChainChanges`: chain changes between two observed tips;
 * - `citrate_getDagStats` with real counts (CV-6, chain#317).
 *
 * Data source (Rule 7): live Citrate JSON-RPC; see LEDGER_SOURCES.
 */
import { formatEther } from "viem";
import { deriveSelectedChain, type LedgerBlock } from "@/explorer/model";
import {
  R1007_METHODS,
  parseBlocksAtHeight,
  parseChainChanges,
  parseDagCounts,
  parseFinalityStatus,
  parseGhostdagData,
  toNum,
  type DagCounts,
  type FinalityStatus,
  type GhostdagData,
  type R1007Capabilities,
  type Requester,
} from "./r1007";

export type BlockSource = "height" | "tip" | "sibling";
export type SnapshotBlock = LedgerBlock & { source: BlockSource };

export interface LedgerTx {
  hash: string;
  from: string;
  to: string | null;
  valueSalt: string;
  blockHash: string;
  blockHeight: number;
  timestamp: number;
  isCreate: boolean;
  methodId: string | null;
}

export interface ChainChangeEvent {
  /** Epoch ms when this server observed it. */
  at: number;
  removed: string[];
  added: string[];
}

export interface LedgerSnapshot {
  generatedAt: number;
  capabilities: R1007Capabilities;
  head: number;
  window: { fromHeight: number; toHeight: number };
  dag: {
    tipsCount: number | null;
    tips: string[];
    maxBlueScore: number | null;
    k: number | null;
    counts: DagCounts | null;
  } | null;
  blocks: SnapshotBlock[];
  ghostdag: Record<string, GhostdagData> | null;
  finality: FinalityStatus | null;
  chainChanges: { since: number; events: ChainChangeEvent[] } | null;
  transactions: LedgerTx[];
}

/** What each figure is read from (shown under the figure in the UI). */
export const LEDGER_SOURCES = {
  blocks: "eth_getBlockByNumber over the newest heights",
  siblings: "citrate_getBlocksAtHeight",
  tips: "citrate_getDagStats currentTips, then eth_getBlockByHash",
  mergeRate: "header mergeParentHashes of selected-chain blocks",
  producers: "header miner of each block in the window",
  transactions: "transactions of the walked blocks",
  colors: "citrate_getGhostdagData mergeset blues and reds",
  redRate: "citrate_getGhostdagData mergeset reds, or citrate_getDagStats counts",
  finality: "citrate_getFinalityStatus (checkpoint votes)",
  chainChanges: "citrate_getSelectedChainChanges between observed tips",
  blocksPerSlot: "header slot (r1007 time slots)",
  selectedChain: "header selectedParentHash from the tip with the most blue work",
} as const;

const MAX_TIPS = 16;
const MAX_BLOCKS = 160;
const hex = (n: number) => `0x${n.toString(16)}`;

type RawHeader = Record<string, unknown> & { hash?: string; transactions?: unknown[] };

export function toLedgerBlock(raw: RawHeader, source: BlockSource): SnapshotBlock | null {
  if (!raw || typeof raw.hash !== "string") return null;
  const selectedParent = (raw.selectedParentHash as string | undefined) ?? (raw.parentHash as string | undefined) ?? null;
  const merges = Array.isArray(raw.mergeParentHashes) ? (raw.mergeParentHashes as string[]) : [];
  let blueWork = "0";
  try {
    blueWork = raw.blueWork ? BigInt(raw.blueWork as string).toString() : "0";
  } catch {
    blueWork = "0";
  }
  return {
    hash: raw.hash,
    height: toNum(raw.number) ?? 0,
    blueScore: toNum(raw.blueScore) ?? 0,
    blueWork,
    selectedParent,
    mergeParents: merges.filter((p) => p && p !== selectedParent),
    timestamp: toNum(raw.timestamp) ?? 0,
    txCount: Array.isArray(raw.transactions) ? raw.transactions.length : 0,
    miner: typeof raw.miner === "string" ? raw.miner : null,
    slot: toNum(raw.slot),
    source,
  };
}

function txsOf(raw: RawHeader, b: SnapshotBlock): LedgerTx[] {
  const out: LedgerTx[] = [];
  for (const t of raw.transactions ?? []) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.hash !== "string") continue;
    let wei = BigInt(0);
    try {
      wei = o.value ? BigInt(o.value as string) : BigInt(0);
    } catch {
      wei = BigInt(0);
    }
    const input = typeof o.input === "string" ? o.input : "";
    const to = typeof o.to === "string" ? o.to : null;
    out.push({
      hash: o.hash,
      from: String(o.from ?? ""),
      to,
      valueSalt: formatEther(wei),
      blockHash: b.hash,
      blockHeight: b.height,
      timestamp: b.timestamp,
      isCreate: !to,
      methodId: input.length >= 10 ? input.slice(0, 10) : null,
    });
  }
  return out;
}

/** Per-instance chain-change observer. Instance-local by design; the persisted feed is the indexer's (EXP-S1). */
export function makeChainFeed(now: () => number = Date.now, keep = 50) {
  const since = now();
  let last: string | null = null;
  const events: ChainChangeEvent[] = [];
  return {
    async observe(req: Requester, tip: string | null) {
      if (!tip) return;
      if (last && last !== tip) {
        try {
          const c = parseChainChanges(await req(R1007_METHODS.selectedChainChanges, [last]));
          if (c && c.removed.length) events.unshift({ at: now(), removed: c.removed, added: c.added });
          events.splice(keep);
        } catch {
          /* a failed read records nothing; the next observation retries from the same tip */
          return;
        }
      }
      last = tip;
    },
    snapshot() {
      return { since, events: [...events] };
    },
  };
}
export type ChainFeed = ReturnType<typeof makeChainFeed>;

export interface LedgerDeps {
  req: Requester;
  dagStats: () => Promise<unknown>;
  capabilities: R1007Capabilities;
  chainFeed?: ChainFeed;
}

export async function buildLedgerSnapshot(
  deps: LedgerDeps,
  opts: { heights: number; txLimit: number },
): Promise<LedgerSnapshot> {
  const { req, capabilities: caps } = deps;
  const head = toNum(await req("eth_blockNumber", [])) ?? 0;
  const fromHeight = Math.max(0, head - opts.heights + 1);
  const heights: number[] = [];
  for (let h = head; h >= fromHeight; h--) heights.push(h);

  const [raws, statsRaw] = await Promise.all([
    Promise.all(heights.map((h) => req("eth_getBlockByNumber", [hex(h), true]) as Promise<RawHeader | null>)),
    deps.dagStats().catch(() => null),
  ]);

  const blocks = new Map<string, SnapshotBlock>();
  const transactions: LedgerTx[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    const b = toLedgerBlock(raw, "height");
    if (!b) continue;
    blocks.set(b.hash, b);
    if (transactions.length < opts.txLimit) transactions.push(...txsOf(raw, b).slice(0, opts.txLimit - transactions.length));
  }

  const add = async (hashes: string[], source: BlockSource) => {
    const missing = hashes.filter((h) => !blocks.has(h)).slice(0, Math.max(0, MAX_BLOCKS - blocks.size));
    const got = await Promise.all(missing.map((h) => (req("eth_getBlockByHash", [h, false]) as Promise<RawHeader | null>).catch(() => null)));
    for (const raw of got) {
      const b = raw ? toLedgerBlock(raw, source) : null;
      if (b && b.height >= fromHeight) blocks.set(b.hash, b);
    }
  };

  const stats = (statsRaw ?? null) as Record<string, unknown> | null;
  const tips = Array.isArray(stats?.currentTips) ? (stats!.currentTips as string[]) : [];
  await add(tips.slice(0, MAX_TIPS), "tip");

  if (caps.blocksAtHeight) {
    const at = await Promise.all(heights.map((h) => req(R1007_METHODS.blocksAtHeight, [hex(h)]).then(parseBlocksAtHeight).catch(() => [] as string[])));
    await add(at.flat(), "sibling");
  }

  let ghostdag: Record<string, GhostdagData> | null = null;
  if (caps.ghostdagData) {
    ghostdag = {};
    const list = [...blocks.keys()];
    const got = await Promise.all(list.map((h) => req(R1007_METHODS.ghostdagData, [h]).then((r) => parseGhostdagData(r, h)).catch(() => null)));
    got.forEach((g) => {
      if (g) ghostdag![g.hash] = g;
    });
  }

  const finality = caps.finalityStatus ? await req(R1007_METHODS.finalityStatus, []).then(parseFinalityStatus).catch(() => null) : null;

  const blockList = [...blocks.values()].sort((a, b) => b.height - a.height || b.blueScore - a.blueScore);
  let chainChanges: LedgerSnapshot["chainChanges"] = null;
  if (caps.selectedChainChanges && deps.chainFeed) {
    const chain = deriveSelectedChain(blockList, tips);
    await deps.chainFeed.observe(req, chain[0] ?? null);
    chainChanges = deps.chainFeed.snapshot();
  }

  const gp = (stats?.ghostdagParams ?? null) as Record<string, unknown> | null;
  return {
    generatedAt: Date.now(),
    capabilities: caps,
    head,
    window: { fromHeight, toHeight: head },
    dag: stats
      ? {
          tipsCount: toNum(stats.tipsCount),
          tips,
          maxBlueScore: toNum(stats.maxBlueScore),
          k: gp ? toNum(gp.k) : null,
          counts: parseDagCounts(stats),
        }
      : null,
    blocks: blockList,
    ghostdag,
    finality,
    chainChanges,
    transactions,
  };
}
