/**
 * Genesis guard (EXP-S0). Chain id 40204 survives a reroll, so nothing keyed on
 * the chain id can tell two chains apart. Block 0's hash can. The index records
 * it in `indexer_state.genesis_hash`, and the indexer refuses to write when the
 * RPC's block 0 differs, instead of silently mixing two chains in one index.
 *
 * Data sources (Rule 7): the RPC's `eth_getBlockByNumber(0)` / `eth_getBlockByHash`
 * (live Citrate RPC via the harness client) and the `indexer_state` / `blocks`
 * tables in the index database.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { PublicClient } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { citrateRequest } from "@/lib/citrate/rpc";
import { blocks, indexerState } from "@/lib/db/schema";
import type { ChainDb } from "./types";

/** Process exit code when the guard refuses. systemd: `RestartPreventExitStatus=3`. */
export const GENESIS_REFUSED_EXIT = 3;

/** The two reads the guard needs from the RPC. */
export interface GenesisRpc {
  /** Hash of the block the RPC serves at `height`, or null if it has none. */
  blockHashAt(height: number): Promise<string | null>;
  /** Whether the RPC knows a block with this hash. */
  hasBlock(hash: string): Promise<boolean>;
}

/** The live RPC (the indexer's configured `NEXT_PUBLIC_CITRATE_RPC_URL`). */
export function liveGenesisRpc(client: PublicClient = harnessClient()): GenesisRpc {
  return {
    async blockHashAt(height) {
      const b = await citrateRequest<{ hash?: string } | null>(client, "eth_getBlockByNumber", [
        `0x${height.toString(16)}`,
        false,
      ]);
      return b?.hash ?? null;
    },
    async hasBlock(hash) {
      const b = await citrateRequest<{ hash?: string } | null>(client, "eth_getBlockByHash", [hash, false]);
      return !!b?.hash && b.hash.toLowerCase() === hash.toLowerCase();
    },
  };
}

export type GenesisRefusalReason =
  /** The index recorded a genesis and the RPC serves a different block 0. */
  | "genesis_mismatch"
  /** A pre-guard index (no recorded genesis) holds rows the RPC's chain does not have. */
  | "index_not_this_chain";

export type GenesisVerdict =
  | { ok: true; genesis: string; action: "matched" | "recorded" | "adopted" }
  | {
      ok: false;
      reason: GenesisRefusalReason;
      recordedGenesis: string | null;
      rpcGenesis: string;
      detail: string;
    };

const norm = (h: string) => h.toLowerCase();

/**
 * Records `genesis` in `indexer_state` if none is recorded yet (write-once), and
 * returns the genesis that is recorded afterwards. Keeps the cursor columns.
 */
export async function recordGenesis(db: ChainDb, genesis: string): Promise<string> {
  const g = norm(genesis);
  await db
    .insert(indexerState)
    .values({ id: 1, genesisHash: g })
    .onConflictDoUpdate({
      target: indexerState.id,
      set: { genesisHash: g, updatedAt: new Date() },
      setWhere: sql`${indexerState.genesisHash} is null`,
    });
  const [row] = await db
    .select({ g: indexerState.genesisHash })
    .from(indexerState)
    .where(eq(indexerState.id, 1));
  if (!row?.g) throw new Error("indexer_state.genesis_hash is still null after recording");
  return row.g;
}

/**
 * Compares the RPC's block 0 with the index. Throws (retryable) when the RPC
 * cannot serve block 0; returns a refusal when the index belongs to another chain.
 */
export async function checkGenesis(db: ChainDb, rpc: GenesisRpc): Promise<GenesisVerdict> {
  const rpcRaw = await rpc.blockHashAt(0);
  if (!rpcRaw) throw new Error("RPC returned no block 0; cannot check the genesis");
  const rpcGenesis = norm(rpcRaw);

  const [state] = await db
    .select({ g: indexerState.genesisHash })
    .from(indexerState)
    .where(eq(indexerState.id, 1));
  const recordedGenesis = state?.g ? norm(state.g) : null;

  if (recordedGenesis) {
    if (recordedGenesis === rpcGenesis) return { ok: true, genesis: rpcGenesis, action: "matched" };
    return {
      ok: false,
      reason: "genesis_mismatch",
      recordedGenesis,
      rpcGenesis,
      detail: "the index was built from a different chain than the RPC now serves",
    };
  }

  // No recorded genesis: either a fresh index, or one built before the guard.
  const [lowest] = await db
    .select({ hash: blocks.hash, height: blocks.height })
    .from(blocks)
    .where(eq(blocks.superseded, false))
    .orderBy(asc(blocks.height))
    .limit(1);

  if (!lowest) {
    const g = await recordGenesis(db, rpcGenesis);
    if (g !== rpcGenesis) {
      return { ok: false, reason: "genesis_mismatch", recordedGenesis: g, rpcGenesis, detail: "another writer recorded a different genesis" };
    }
    return { ok: true, genesis: g, action: "recorded" };
  }

  const sameChain =
    lowest.height === 0 ? norm(lowest.hash) === rpcGenesis : await rpc.hasBlock(lowest.hash);
  if (!sameChain) {
    return {
      ok: false,
      reason: "index_not_this_chain",
      recordedGenesis: null,
      rpcGenesis,
      detail: `the index's lowest live block (height ${lowest.height}, ${lowest.hash}) is not on the RPC's chain`,
    };
  }
  const g = await recordGenesis(db, rpcGenesis);
  if (g !== rpcGenesis) {
    return { ok: false, reason: "genesis_mismatch", recordedGenesis: g, rpcGenesis, detail: "another writer recorded a different genesis" };
  }
  return { ok: true, genesis: g, action: "adopted" };
}

/** One clear log line for a refusal: what differs and how to recover. */
export function genesisRefusalMessage(v: Extract<GenesisVerdict, { ok: false }>): string {
  return (
    `GENESIS REFUSED (${v.reason}): RPC block 0 is ${v.rpcGenesis}, ` +
    `index genesis is ${v.recordedGenesis ?? "unrecorded"}` +
    (v.detail ? ` (${v.detail})` : "") +
    `. The indexer will not write. If the chain was rerolled on purpose, stop the indexer and run ` +
    `\`pnpm indexer:reset --genesis ${v.rpcGenesis} --confirm\` (DEPLOY.md, "Genesis guard and reset"); ` +
    `otherwise point NEXT_PUBLIC_CITRATE_RPC_URL back at the indexed chain.`
  );
}
