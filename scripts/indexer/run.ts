/**
 * CitrateScan indexer worker (S-1 WP-1.3).
 *
 * An ALWAYS-ON Node process (not a Vercel function — functions can't hold a
 * socket or run unbounded). It ingests the BlockDAG into Neon so the explorer +
 * agent can answer history/aggregate queries fast.
 *
 * Modes:
 *   pnpm indexer        — continuous: backfill the gap from the resume cursor to
 *                         the head, then tail. Reconciles finality each tick.
 *   pnpm indexer:once   — single pass (INDEXER_ONCE=1): ingest the latest block
 *                         and exit. Used as a smoke test / cron tick.
 *
 * Resume: picks up from the `indexer_state` cursor (MAX height committed), so a
 * restart produces zero gaps and zero duplicates (onConflictDoNothing).
 *
 * Without DATABASE_URL it runs dry: READS blocks (proving RPC) but persists
 * nothing — validate connectivity before provisioning Neon.
 *
 * Deploy alongside the inference box (D-Host). Run with: `pnpm indexer`.
 */
import {
  ingestBlock,
  reconcileFinality,
  resumeHeight,
  headHeight,
} from "@/lib/indexer/ingest";
import { isDbEnabled } from "@/lib/db/client";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2000);
const ONCE = process.env.INDEXER_ONCE === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once() {
  const head = await headHeight();
  const res = await ingestBlock(head);
  if (isDbEnabled()) await reconcileFinality();
  console.log(
    `[indexer] head=${head} persisted=${res.persisted} txs=${res.txCount}` +
      (res.persisted
        ? ` finalized=${res.finalized} superseded=${res.superseded}`
        : " (dry: DATABASE_URL unset)"),
  );
}

async function loop() {
  let next = await resumeHeight();
  console.log(
    `[indexer] resuming at height ${next}; db=${isDbEnabled() ? "neon" : "dry"}; poll=${POLL_MS}ms`,
  );
  for (;;) {
    try {
      const head = await headHeight();
      while (next <= head) {
        const res = await ingestBlock(next);
        if (res.persisted || res.hash) {
          const sup = res.superseded ? ` superseded=${res.superseded}` : "";
          console.log(`[indexer] block ${next} hash=${res.hash} txs=${res.txCount}${sup}`);
        }
        next += 1;
      }
      if (isDbEnabled()) {
        const f = await reconcileFinality();
        if (f) console.log(`[indexer] finalized ${f} block(s)`);
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
