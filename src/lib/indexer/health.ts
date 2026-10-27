// RED-COMMIT PLACEHOLDER: the pre-fix /api/health composition (a failed genesis read turns the
// whole indexer component into an error). Replaced in the next commit.
import { genesisHealth } from "./genesisGuard";

export type GenesisRead =
  | { migrated: true; recorded: string | null; status: string | null; code: string | null; checkedAt: Date | null }
  | { migrated: false }
  | { error: true };

export function indexerHealthComponent(i: {
  head: number;
  chainHead: number | null;
  maxLag: number;
  rpcGenesis: string | null;
  genesis: GenesisRead;
}): Record<string, unknown> {
  if (!("migrated" in i.genesis) || !i.genesis.migrated) return { status: "error", error: "indexer query failed" };
  const g = i.genesis;
  const lag = i.chainHead !== null ? Math.max(0, i.chainHead - i.head) : null;
  const issue = genesisHealth({ status: g.status, recorded: g.recorded, rpcGenesis: i.rpcGenesis });
  return {
    status: issue ?? (lag === null ? "unknown" : lag <= i.maxLag ? "ok" : "lagging"),
    head: i.head,
    lagBlocks: lag,
    maxLag: i.maxLag,
    genesis: { recorded: g.recorded, status: g.status, code: g.code, checkedAt: g.checkedAt },
  };
}
