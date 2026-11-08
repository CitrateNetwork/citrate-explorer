/**
 * GhostDAG view model for the direction-B screens. Pure functions over records
 * the server read from the node (`/api/ledger`, `/api/blocks/[id]`), so every
 * figure is reproducible from its inputs.
 *
 * Rules that keep the figures honest:
 * - the selected chain is followed from header `selectedParentHash`, starting
 *   at the tip with the most blue work (GhostDAG's virtual selected parent);
 * - blue/red is "unknown" unless `citrate_getGhostdagData` mergesets are
 *   served; nothing is inferred from depth or position;
 * - finality is read from `citrate_getFinalityStatus` only (CV-8), never depth.
 */
import type { FinalityStatus } from "@/lib/citrate/r1007";

export interface LedgerBlock {
  hash: string;
  height: number;
  blueScore: number;
  /** Decimal string; compared as BigInt. */
  blueWork: string;
  selectedParent: string | null;
  mergeParents: string[];
  /** Unix seconds. */
  timestamp: number;
  txCount: number;
  miner: string | null;
  /** r1007 header slot; null until headers carry it. */
  slot: number | null;
}

/** Mergeset membership per chain block, from `citrate_getGhostdagData`. */
export type MergesetMap = Record<string, { mergesetBlues: string[]; mergesetReds: string[] }>;

export type BlockColor = "chain" | "blue" | "red" | "unmerged" | "unknown";

const big = (s: string) => {
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
};

function heavier(a: LedgerBlock, b: LedgerBlock): LedgerBlock {
  const wa = big(a.blueWork), wb = big(b.blueWork);
  if (wa !== wb) return wa > wb ? a : b;
  return a.hash > b.hash ? a : b;
}

/** Selected chain within the window, newest first. */
export function deriveSelectedChain(blocks: LedgerBlock[], tips: string[]): string[] {
  if (!blocks.length) return [];
  const by = new Map(blocks.map((b) => [b.hash, b]));
  let candidates = tips.map((t) => by.get(t)).filter((b): b is LedgerBlock => !!b);
  if (!candidates.length) {
    const hasChild = new Set<string>();
    for (const b of blocks) {
      if (b.selectedParent) hasChild.add(b.selectedParent);
      b.mergeParents.forEach((p) => hasChild.add(p));
    }
    candidates = blocks.filter((b) => !hasChild.has(b.hash));
    if (!candidates.length) candidates = blocks;
  }
  let cur: LedgerBlock | undefined = candidates.reduce(heavier);
  const out: string[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.hash)) {
    out.push(cur.hash);
    seen.add(cur.hash);
    cur = cur.selectedParent ? by.get(cur.selectedParent) : undefined;
  }
  return out;
}

export function colorBlocks(blocks: LedgerBlock[], chain: string[], ghostdag: MergesetMap | null): Record<string, BlockColor> {
  const onChain = new Set(chain);
  const blue = new Set<string>(), red = new Set<string>();
  if (ghostdag) {
    for (const c of chain) {
      const g = ghostdag[c];
      if (!g) continue;
      g.mergesetBlues.forEach((h) => blue.add(h));
      g.mergesetReds.forEach((h) => red.add(h));
    }
  }
  const out: Record<string, BlockColor> = {};
  for (const b of blocks) {
    out[b.hash] = onChain.has(b.hash)
      ? "chain"
      : !ghostdag
        ? "unknown"
        : red.has(b.hash)
          ? "red"
          : blue.has(b.hash)
            ? "blue"
            : "unmerged";
  }
  return out;
}

/** Side block -> the oldest chain block in the window that merges it. */
export function mergedBy(blocks: LedgerBlock[], chain: string[], ghostdag: MergesetMap | null): Record<string, string> {
  const by = new Map(blocks.map((b) => [b.hash, b]));
  const onChain = new Set(chain);
  const out: Record<string, string> = {};
  for (const c of [...chain].reverse()) {
    const members = ghostdag?.[c]
      ? [...ghostdag[c].mergesetBlues, ...ghostdag[c].mergesetReds]
      : (by.get(c)?.mergeParents ?? []);
    for (const m of members) if (!onChain.has(m) && by.has(m) && !(m in out)) out[m] = c;
  }
  return out;
}

export function mergeRate(blocks: LedgerBlock[], chain: string[]): { merging: number; total: number; rate: number } | null {
  const by = new Map(blocks.map((b) => [b.hash, b]));
  const cs = chain.map((h) => by.get(h)).filter((b): b is LedgerBlock => !!b);
  if (!cs.length) return null;
  const merging = cs.filter((b) => b.mergeParents.length > 0).length;
  return { merging, total: cs.length, rate: merging / cs.length };
}

export function redRate(chain: string[], ghostdag: MergesetMap | null): { blues: number; reds: number; rate: number } | null {
  if (!ghostdag) return null;
  let blues = 0, reds = 0;
  for (const c of chain) {
    const g = ghostdag[c];
    if (!g) continue;
    blues += g.mergesetBlues.length;
    reds += g.mergesetReds.length;
  }
  const n = blues + reds;
  return n ? { blues, reds, rate: reds / n } : { blues, reds, rate: 0 };
}

export function producerShare(blocks: LedgerBlock[]): Array<{ producer: string; n: number; share: number }> {
  const counts = new Map<string, number>();
  for (const b of blocks) if (b.miner) counts.set(b.miner, (counts.get(b.miner) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, n) => a + n, 0);
  return [...counts.entries()]
    .map(([producer, n]) => ({ producer, n, share: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.producer.localeCompare(b.producer));
}

export function blocksPerSlot(blocks: LedgerBlock[]): { firstSlot: number; perSlot: number[]; mean: number; emptyShare: number } | null {
  if (!blocks.length || blocks.some((b) => b.slot === null)) return null;
  const slots = blocks.map((b) => b.slot as number);
  const lo = Math.min(...slots), hi = Math.max(...slots);
  const perSlot = new Array<number>(hi - lo + 1).fill(0);
  for (const s of slots) perSlot[s - lo] += 1;
  return {
    firstSlot: lo,
    perSlot,
    mean: blocks.length / perSlot.length,
    emptyShare: perSlot.filter((n) => n === 0).length / perSlot.length,
  };
}

export interface FinalityRuler {
  lo: number;
  hi: number;
  finalized: number | null;
  pending: number | null;
  pendingPct: number | null;
  tip: number;
  /** Position of a height on the ruler, 0..100. */
  at: (h: number) => number;
}

export function finalityRuler(status: FinalityStatus | null, tipHeight: number): FinalityRuler | null {
  if (!status || !status.published) return null;
  const finalized = status.finalized?.height ?? null;
  const p = status.pending[0] ?? null;
  const marks = [finalized, p?.height ?? null, tipHeight].filter((x): x is number => x !== null);
  const span = Math.max(10, Math.max(...marks) - Math.min(...marks));
  const lo = Math.max(0, Math.min(...marks) - Math.round(span * 0.15));
  const hi = Math.max(...marks) + Math.round(span * 0.05) + 1;
  const at = (h: number) => Math.max(0, Math.min(100, (100 * (h - lo)) / (hi - lo)));
  return { lo, hi, finalized, pending: p?.height ?? null, pendingPct: p ? p.quorumPct : null, tip: tipHeight, at };
}

export type FinalityState = "finalized" | "voting" | "above" | "unknown";

export function finalityOf(height: number, status: FinalityStatus | null): FinalityState {
  if (!status || !status.published) return "unknown";
  const f = status.finalized?.height;
  if (f !== undefined && height <= f) return "finalized";
  const maxPending = status.pending.reduce((m, c) => Math.max(m, c.height), -1);
  if (maxPending >= 0 && height <= maxPending) return "voting";
  return "above";
}

export interface LayoutNode {
  hash: string;
  col: number;
  lane: number;
  block: LedgerBlock;
}
export interface LayoutEdge {
  from: string;
  to: string;
  kind: "spine" | "selected" | "merge";
}
export interface DagLayout {
  nodes: Record<string, LayoutNode>;
  order: string[];
  edges: LayoutEdge[];
  minBlueScore: number;
  maxBlueScore: number;
  minLane: number;
  maxLane: number;
}

const LANE_ORDER = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5];

/** One column per blue score, the chain on lane 0, siblings alternating around it. */
export function dagLayout(blocks: LedgerBlock[], chain: Set<string>, maxBlocks: number): DagLayout {
  const sorted = [...blocks].sort((a, b) => a.blueScore - b.blueScore || a.hash.localeCompare(b.hash)).slice(-maxBlocks);
  const inSet = new Set(sorted.map((b) => b.hash));
  const minBlueScore = sorted.length ? sorted[0].blueScore : 0;
  const maxBlueScore = sorted.length ? sorted[sorted.length - 1].blueScore : 0;
  const used = new Map<number, Set<number>>();
  const nodes: Record<string, LayoutNode> = {};
  // chain first so it claims lane 0 in its column
  const placeOrder = [...sorted].sort((a, b) => Number(chain.has(b.hash)) - Number(chain.has(a.hash)));
  for (const b of placeOrder) {
    const col = b.blueScore - minBlueScore;
    const u = used.get(col) ?? new Set<number>();
    used.set(col, u);
    const lane = chain.has(b.hash) && !u.has(0) ? 0 : (LANE_ORDER.find((l) => !u.has(l)) ?? 6);
    u.add(lane);
    nodes[b.hash] = { hash: b.hash, col, lane, block: b };
  }
  const edges: LayoutEdge[] = [];
  for (const b of sorted) {
    if (b.selectedParent && inSet.has(b.selectedParent)) {
      edges.push({ from: b.selectedParent, to: b.hash, kind: chain.has(b.hash) && chain.has(b.selectedParent) ? "spine" : "selected" });
    }
    for (const p of b.mergeParents) if (inSet.has(p)) edges.push({ from: p, to: b.hash, kind: "merge" });
  }
  const lanes = Object.values(nodes).map((n) => n.lane);
  return {
    nodes,
    order: sorted.map((b) => b.hash),
    edges,
    minBlueScore,
    maxBlueScore,
    minLane: Math.min(-1, ...lanes),
    maxLane: Math.max(1, ...lanes),
  };
}

/** Blocks in the window that are neither in the past nor the future of `hash`. */
export function anticoneInWindow(hash: string, blocks: LedgerBlock[]): string[] {
  const by = new Map(blocks.map((b) => [b.hash, b]));
  const parents = (h: string) => {
    const b = by.get(h);
    return b ? [b.selectedParent, ...b.mergeParents].filter((p): p is string => !!p && by.has(p)) : [];
  };
  const children = new Map<string, string[]>();
  for (const b of blocks) for (const p of parents(b.hash)) children.set(p, [...(children.get(p) ?? []), b.hash]);
  const walk = (start: string, next: (h: string) => string[]) => {
    const seen = new Set<string>();
    const stack = [...next(start)];
    while (stack.length) {
      const h = stack.pop() as string;
      if (seen.has(h)) continue;
      seen.add(h);
      stack.push(...next(h));
    }
    return seen;
  };
  const past = walk(hash, parents);
  const future = walk(hash, (h) => children.get(h) ?? []);
  return blocks.map((b) => b.hash).filter((h) => h !== hash && !past.has(h) && !future.has(h));
}
