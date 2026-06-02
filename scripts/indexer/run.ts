/**
 * CitrateScan indexer worker (S-1).
 *
 * An ALWAYS-ON Node process (not a Vercel function — functions can't hold a
 * socket or run unbounded). It ingests the BlockDAG into Neon so the explorer +
 * agent can answer history/aggregate queries fast.
 *
 * Modes:
 *   pnpm indexer        — continuous: tail the head, backfill the gap.
 *   pnpm indexer:once   — single pass (INDEXER_ONCE=1): ingest the latest block
 *                         and exit. Used as a smoke test / cron tick.
 *
 * Without DATABASE_URL it runs in dry mode: it READS blocks (proving RPC works)
 * but persists nothing — useful to validate connectivity before provisioning.
 *
 * Run with: `pnpm indexer` (tsx). Deploy alongside the inference box.
 */
import { ingestBlock, headHeight } from "@/lib/indexer/ingest";
import { isDbEnabled } from "@/lib/db/client";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2000);
const START = Number(process.env.INDEXER_START_BLOCK ?? 0);
const ONCE = process.env.INDEXER_ONCE === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once() {
  const head = await headHeight();
  const res = await ingestBlock(head);
  console.log(
    `[indexer] head=${head} persisted=${res.persisted} txs=${res.txCount}` +
      (res.persisted ? ` finalized=${res.finalized}` : " (dry: DATABASE_URL unset)"),
  );
}

async function loop() {
  let next = START > 0 ? START : await headHeight();
  console.log(
    `[indexer] starting at height ${next}; db=${isDbEnabled() ? "neon" : "dry"}; poll=${POLL_MS}ms`,
  );
  for (;;) {
    try {
      const head = await headHeight();
      while (next <= head) {
        const res = await ingestBlock(next);
        if (res.persisted || res.hash) {
          console.log(`[indexer] block ${next} hash=${res.hash} txs=${res.txCount}`);
        }
        next += 1;
      }
    } catch (err) {
      console.error("[indexer] tick error:", (err as Error).message);
    }
    await sleep(POLL_MS);
  }
}

(ONCE ? once() : loop()).catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
