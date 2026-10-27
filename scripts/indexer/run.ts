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
 * nothing — validate connectivity before provisioning the database.
 *
 * Genesis guard (r1006 cutover): r1005 and r1006 share chain id 40204. Before the
 * first batch and then before every batch (at most every INDEXER_GENESIS_CHECK_MS,
 * default 0 = every batch), the RPC's block 0 is compared with the genesis recorded
 * in `indexer_state` and with the build's network (NEXT_PUBLIC_CITRATE_NETWORK).
 * A mismatch stops all writes until restart (logged, and stored for /api/health);
 * `pnpm indexer:once` exits 3. See docs/R1006_CUTOVER.md.
 *
 * Deploy alongside the inference box (D-Host). Run with: `pnpm indexer`.
 */
import {
  ingestBlock,
  reconcileFinality,
  resumeHeight,
  headHeight,
} from "@/lib/indexer/ingest";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { GenesisGate, type GenesisDeps } from "@/lib/indexer/genesisGuard";
import { dbGenesisStore, rpcGenesisSource } from "@/lib/indexer/genesisStore";
import { NETWORK } from "@/lib/citrate/network";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2000);
const ONCE = process.env.INDEXER_ONCE === "1";
/**
 * How many heights to ingest concurrently while catching up. Default 1
 * preserves the previous strictly-sequential behaviour. Set higher when
 * the indexer is far behind head — each `ingestBlock` is idempotent
 * (`onConflictDoNothing` on `blocks` / `receipts` / `logs` / `dag_edges`,
 * `onConflictDoUpdate(id=1)` on `indexer_state`), so the only effect of a
 * cursor race is a brief regression that gets retried-and-deduped on the
 * next loop iteration. With `INDEXER_PARALLEL=8` and ~1s per block, the
 * sustained ingest rate goes from ~1 block/s to ~8 blocks/s, which is
 * what closes a 10k+ block gap in minutes instead of hours.
 *
 * Capped at 32 to keep the Neon connection pool happy on the free tier.
 */
const PARALLEL = Math.max(
  1,
  Math.min(32, Number(process.env.INDEXER_PARALLEL ?? 1)),
);

const GENESIS_CHECK_MS = Math.max(0, Number(process.env.INDEXER_GENESIS_CHECK_MS ?? 0));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function genesisGate(): GenesisGate {
  const db = getDb();
  const deps: GenesisDeps = {
    rpc: rpcGenesisSource(),
    store: db ? dbGenesisStore(db) : null,
    expected: NETWORK.constants.genesisHash,
  };
  return new GenesisGate(deps, {
    intervalMs: GENESIS_CHECK_MS,
    log: (m) => (m.includes("REFUSED") ? console.error(m) : console.log(m)),
  });
}

async function once() {
  const gate = genesisGate();
  if (!(await gate.allow())) {
    console.error("[indexer] not indexing: genesis check did not pass (see above)");
    process.exit(3);
  }
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
  const gate = genesisGate();
  let next = await resumeHeight();
  console.log(
    `[indexer] resuming at height ${next}; network=${NETWORK.id} genesis=${NETWORK.constants.genesisHash}; ` +
      `db=${isDbEnabled() ? "postgres" : "dry"}; poll=${POLL_MS}ms parallel=${PARALLEL} genesisCheck=${GENESIS_CHECK_MS}ms`,
  );
  let refusalLoggedAt = 0;
  for (;;) {
    try {
      if (!(await gate.allow())) {
        // Fail closed: no writes. A latched refusal is re-logged once a minute so it stays visible.
        if (gate.refusal && Date.now() - refusalLoggedAt >= 60_000) {
          refusalLoggedAt = Date.now();
          console.error(`[indexer] still refusing (${gate.refusal.code}): ${gate.refusal.detail}`);
        }
        await sleep(POLL_MS);
        continue;
      }
      const head = await headHeight();
      while (next <= head) {
        // Re-check before every batch: the RPC can be cut over mid-backfill.
        if (!(await gate.allow())) break;
        // Process up to PARALLEL heights concurrently. Each call is
        // idempotent at every persist site, so a partial batch failure
        // just leaves a gap that the next loop iteration re-covers via
        // the same `next <= head` check.
        const batchEnd = Math.min(next + PARALLEL - 1, head);
        const heights: number[] = [];
        for (let h = next; h <= batchEnd; h++) heights.push(h);
        const results = await Promise.allSettled(
          heights.map((h) => ingestBlock(h)),
        );
        for (let i = 0; i < heights.length; i++) {
          const r = results[i];
          const h = heights[i];
          if (r.status === "fulfilled") {
            const v = r.value;
            if (v.persisted || v.hash) {
              const sup = v.superseded ? ` superseded=${v.superseded}` : "";
              console.log(`[indexer] block ${h} hash=${v.hash} txs=${v.txCount}${sup}`);
            }
          } else {
            console.error(`[indexer] block ${h} failed: ${(r.reason as Error).message}`);
          }
        }
        next = batchEnd + 1;
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
