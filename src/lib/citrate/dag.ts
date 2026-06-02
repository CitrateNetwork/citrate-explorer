import type { PublicClient } from "viem";

/**
 * GHOSTDAG topology types + the `citrate_getDagStats` reader.
 *
 * Citrate is a BlockDAG, not a linear chain. The explorer must treat these as
 * first-class (see EXPLORER_SPEC.md "DAG-native deltas"):
 *  - there are multiple **tips** at once — no single "latest block";
 *  - **blue_score ≠ height** — blue_score is the consensus order;
 *  - **finality is by depth**: a block is final once
 *    `maxBlueScore − block.blue_score ≥ finalityDepth` (network default 100).
 */

export interface GhostdagParams {
  k: number;
  maxParents: number;
  maxBlueScoreDiff: number;
  pruningWindow: number;
  finalityDepth: number;
}

export interface DagStats {
  totalBlocks: number;
  blueBlocks: number;
  redBlocks: number;
  tipsCount: number;
  maxBlueScore: number;
  /** Hashes of the current DAG tips (blocks with no known children). */
  currentTips: string[];
  height: number;
  ghostdagParams: GhostdagParams;
}

/** A DAG edge: a child block to one of its parents (selected or merge). */
export interface DagEdge {
  child: string;
  parent: string;
  /** True for the single selected parent (the chain link); false for merge parents. */
  selected: boolean;
}

/**
 * Calls the non-standard `citrate_getDagStats` RPC method. `viem`'s `request`
 * doesn't know Citrate's custom methods, so we widen the client to issue a raw
 * request. Returns the parsed snapshot (tips, blue/red counts, finality params).
 */
export async function getDagStats(client: PublicClient): Promise<DagStats> {
  const raw = (await (
    client as unknown as {
      request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
    }
  ).request({ method: "citrate_getDagStats", params: [] })) as DagStats;
  return raw;
}

/** Default finality depth, used until `citrate_getDagStats` is reachable. */
export const DEFAULT_FINALITY_DEPTH = 100;

/** Whether a block at `blueScore` is finalized given the current `maxBlueScore`. */
export function isFinalized(
  blueScore: number,
  maxBlueScore: number,
  finalityDepth: number = DEFAULT_FINALITY_DEPTH,
): boolean {
  return maxBlueScore - blueScore >= finalityDepth;
}
