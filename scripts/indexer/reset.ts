/**
 * `pnpm indexer:reset --genesis <hash> [--confirm] [--skip-rpc-check]`
 *
 * After a deliberate chain reroll: empties the chain-index tables in one
 * transaction and records the new genesis, so the indexer backfills the new
 * chain from height 0. Without --confirm it is a dry run that deletes nothing.
 * Stop the indexer first; the command refuses while it holds the indexer lock.
 * See DEPLOY.md, "Genesis guard and reset", and src/lib/indexer/reset.ts.
 *
 * Data sources: the index database at DATABASE_URL; block 0 from
 * NEXT_PUBLIC_CITRATE_RPC_URL.
 */
import { getDb } from "@/lib/db/client";
import { liveGenesisRpc } from "@/lib/indexer/genesis";
import { runReset } from "@/lib/indexer/reset";

async function main(): Promise<number> {
  const db = getDb();
  if (!db) {
    console.error("[indexer:reset] DATABASE_URL is not set; nothing to reset");
    return 2;
  }
  return runReset({
    argv: process.argv.slice(2),
    db,
    rpc: liveGenesisRpc(),
    log: (l) => console.log(l),
    error: (l) => console.error(l),
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[indexer:reset] failed; the transaction rolled back, nothing was deleted:", err);
    process.exit(1);
  });
