/**
 * The `indexer` component of /api/health. Head and lag (the freshness signal the indexer alert
 * reads) come from the `blocks` table and never depend on the genesis read: merging auto-deploys
 * main before `pnpm db:migrate` runs, and a database without the 0005 genesis columns must not
 * take the freshness signal down with it.
 *
 * Data sources (Rule 7): `head` = max(blocks.height); `chainHead` = RPC eth_blockNumber;
 * `rpcGenesis` = RPC eth_getBlockByNumber(0).hash; `genesis` = indexer_state.genesis_* (written
 * by the indexer's genesis guard), read by readGenesisState.
 */
import { genesisHealth } from "./genesisGuard";

export type GenesisRead =
  | { migrated: true; recorded: string | null; status: string | null; code: string | null; checkedAt: Date | null }
  /** The database predates migration 0005. */
  | { migrated: false }
  /** The genesis read failed for another reason (details in the server log). */
  | { error: true };

export function indexerHealthComponent(i: {
  head: number;
  chainHead: number | null;
  maxLag: number;
  rpcGenesis: string | null;
  genesis: GenesisRead;
}): Record<string, unknown> {
  const lag = i.chainHead !== null ? Math.max(0, i.chainHead - i.head) : null;
  const lagStatus = lag === null ? "unknown" : lag <= i.maxLag ? "ok" : "lagging";
  const base = { head: i.head, lagBlocks: lag, maxLag: i.maxLag };
  const g = i.genesis;
  if ("error" in g) return { status: lagStatus, ...base, genesis: { status: "error" } };
  if (!g.migrated) return { status: lagStatus, ...base, genesis: { status: "not_migrated" } };
  const issue = genesisHealth({ status: g.status, recorded: g.recorded, rpcGenesis: i.rpcGenesis });
  return {
    status: issue ?? lagStatus,
    ...base,
    genesis: { recorded: g.recorded, status: g.status, code: g.code, checkedAt: g.checkedAt },
  };
}
