/**
 * `pnpm indexer:reset --genesis <hash> --confirm` (EXP-S0). After a deliberate
 * chain reroll, empties the chain-index tables in one transaction and re-seeds
 * `indexer_state` with the new genesis, so the genesis guard accepts the new
 * chain and the indexer backfills it from height 0.
 *
 * Safety:
 *  - Without `--confirm` it is a dry run: it prints row counts and deletes nothing.
 *  - It checks that the RPC's block 0 is `--genesis` (skip only with
 *    `--skip-rpc-check`, for a reset made before the RPC flips).
 *  - It refuses while an indexer holds the indexer lock (see ./lock.ts).
 *  - User tables (settings, api keys, watchlist, threads, verifications, ...) are
 *    never touched.
 *
 * Data sources (Rule 7): the index database tables below; the live RPC's block 0.
 */
import { count, sql } from "drizzle-orm";
import {
  accounts,
  blocks,
  contracts,
  dagEdges,
  indexerState,
  logs,
  receipts,
  tokens,
  tokenTransfers,
  transactions,
} from "@/lib/db/schema";
import type { GenesisRpc } from "./genesis";
import { INDEXER_LOCK_KEY } from "./lock";
import type { ChainDb } from "./types";

/** Every table the indexer derives from the chain. All are emptied by a reset. */
const CHAIN_TABLES = {
  blocks,
  dag_edges: dagEdges,
  transactions,
  receipts,
  logs,
  token_transfers: tokenTransfers,
  tokens,
  accounts,
  contracts,
  indexer_state: indexerState,
} as const;

export type ChainTableName = keyof typeof CHAIN_TABLES;
export const CHAIN_TABLE_NAMES = Object.keys(CHAIN_TABLES) as ChainTableName[];

export interface ResetArgs {
  genesis: string;
  confirm: boolean;
  skipRpcCheck: boolean;
}

const HASH_RE = /^0x[0-9a-f]{64}$/;
export const RESET_USAGE = "usage: pnpm indexer:reset --genesis <0x…32-byte block 0 hash> [--confirm] [--skip-rpc-check]";

/** Parses CLI flags. Throws with a usage message on anything unexpected. */
export function parseResetArgs(argv: string[]): ResetArgs {
  let genesis: string | undefined;
  let confirm = false;
  let skipRpcCheck = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirm") confirm = true;
    else if (a === "--skip-rpc-check") skipRpcCheck = true;
    else if (a === "--genesis") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new Error(`--genesis needs a value. ${RESET_USAGE}`);
      genesis = v;
      i++;
    } else if (a.startsWith("--genesis=")) genesis = a.slice("--genesis=".length);
    else throw new Error(`unknown argument ${a}. ${RESET_USAGE}`);
  }
  if (!genesis) throw new Error(`--genesis is required. ${RESET_USAGE}`);
  const g = genesis.toLowerCase();
  if (!HASH_RE.test(g)) throw new Error(`--genesis must be a 32-byte hex hash (0x + 64 hex), got ${genesis}`);
  return { genesis: g, confirm, skipRpcCheck };
}

/** Row count of every chain table. */
export async function chainIndexCounts(db: ChainDb): Promise<Record<ChainTableName, number>> {
  const out = {} as Record<ChainTableName, number>;
  for (const name of CHAIN_TABLE_NAMES) {
    const [row] = await db.select({ n: count() }).from(CHAIN_TABLES[name]);
    out[name] = Number(row?.n ?? 0);
  }
  return out;
}

/** Thrown when an indexer holds the lock, so a reset would race its writes. */
export class IndexerRunningError extends Error {
  constructor() {
    super("an indexer holds the indexer lock; stop citratescan-indexer.service first");
  }
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows;
  return rows?.[0] as Record<string, unknown> | undefined;
}

/**
 * Empties every chain table and seeds `indexer_state` (cursor 0, `genesis`), in
 * one transaction: either all of it happens or none of it.
 */
export async function resetChainIndex(db: ChainDb, genesis: string): Promise<void> {
  const g = genesis.toLowerCase();
  if (!HASH_RE.test(g)) throw new Error(`not a 32-byte hash: ${genesis}`);
  await db.transaction(async (tx) => {
    const lock = firstRow(await tx.execute(sql`select pg_try_advisory_xact_lock(${INDEXER_LOCK_KEY}) as ok`));
    if (lock?.ok !== true) throw new IndexerRunningError();
    const names = CHAIN_TABLE_NAMES.map((n) => `"${n}"`).join(", ");
    await tx.execute(sql.raw(`truncate table ${names} restart identity`));
    await tx.insert(indexerState).values({ id: 1, lastHeight: 0, lastBlueScore: 0, genesisHash: g });
  });
}

export interface RunResetOptions {
  argv: string[];
  db: ChainDb;
  rpc: GenesisRpc;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The CLI body. Returns the exit code: 0 done or dry run, 2 bad args, 4 refused. */
export async function runReset({ argv, db, rpc, log, error }: RunResetOptions): Promise<number> {
  let args: ResetArgs;
  try {
    args = parseResetArgs(argv);
  } catch (e) {
    error(`[indexer:reset] ${(e as Error).message}`);
    return 2;
  }

  if (!args.skipRpcCheck) {
    let rpcGenesis: string | null;
    try {
      rpcGenesis = await rpc.blockHashAt(0);
    } catch (e) {
      error(
        `[indexer:reset] REFUSED: could not read block 0 from the RPC (${(e as Error).message}). ` +
          "Fix the RPC, or pass --skip-rpc-check if you are resetting before the RPC flips.",
      );
      return 4;
    }
    if (!rpcGenesis || rpcGenesis.toLowerCase() !== args.genesis) {
      error(
        `[indexer:reset] REFUSED: the RPC's block 0 is ${rpcGenesis ?? "missing"}, not ${args.genesis}. ` +
          "Check the hash, or pass --skip-rpc-check if you are resetting before the RPC flips.",
      );
      return 4;
    }
  }

  const counts = await chainIndexCounts(db);
  const summary = CHAIN_TABLE_NAMES.map((n) => `${n}=${counts[n]}`).join(" ");
  if (!args.confirm) {
    log(`[indexer:reset] DRY RUN, nothing deleted. Would empty: ${summary}`);
    log(`[indexer:reset] and record genesis ${args.genesis}. Re-run with --confirm to do it.`);
    return 0;
  }

  try {
    await resetChainIndex(db, args.genesis);
  } catch (e) {
    if (e instanceof IndexerRunningError) {
      error(`[indexer:reset] REFUSED: ${e.message}. Nothing was deleted.`);
      return 4;
    }
    throw e;
  }
  log(`[indexer:reset] emptied ${summary}`);
  log(`[indexer:reset] recorded genesis ${args.genesis}; the indexer will backfill from height 0.`);
  return 0;
}
