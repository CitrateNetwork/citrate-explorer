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
 * Resume: picks up from the `indexer_state` cursor + 1. The cursor is the
 * highest height such that every height at or below it landed (the scheduler's
 * contiguous watermark), and it only moves forward, so a restart re-covers any
 * hole. Each block is written in one transaction and re-ingest never duplicates.
 *
 * Retries (explorer#40): a height whose ingest fails (RPC error, missing receipt,
 * DB conflict) is retried with exponential backoff from INDEXER_RETRY_BASE_MS
 * (default 1 s) up to INDEXER_RETRY_MAX_MS (default 60 s). It is never skipped;
 * newer heights keep flowing meanwhile, and the cursor waits below it.
 *
 * Genesis guard (EXP-S0): before writing, and every INDEXER_GENESIS_CHECK_MS
 * (default 60 s) while running, the RPC's block 0 hash is compared with
 * `indexer_state.genesis_hash`. On a mismatch the indexer logs why and exits 3
 * without writing (`RestartPreventExitStatus=3` keeps systemd from looping).
 * Recovery after a deliberate reroll: `pnpm indexer:reset --genesis <hash> --confirm`.
 * The indexer also holds a Postgres advisory lock (src/lib/indexer/lock.ts), so a
 * second indexer, or a reset, cannot run against the same index at the same time.
 *
 * Without DATABASE_URL it runs dry: READS blocks (proving RPC) but persists
 * nothing — validate connectivity before provisioning Neon.
 *
 * Deploy alongside the inference box (D-Host). Run with: `pnpm indexer`.
 */
import {
  advanceCursor,
  ingestBlock,
  reconcileFinality,
  resumeHeight,
  headHeight,
} from "@/lib/indexer/ingest";
import { HeightScheduler } from "@/lib/indexer/scheduler";
import { getDb, isDbEnabled } from "@/lib/db/client";
import {
  checkGenesis,
  genesisRefusalMessage,
  liveGenesisRpc,
  GENESIS_REFUSED_EXIT,
} from "@/lib/indexer/genesis";
import { acquireIndexerLock } from "@/lib/indexer/lock";

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2000);
const ONCE = process.env.INDEXER_ONCE === "1";
/**
 * How many heights to ingest concurrently while catching up. Default 1
 * preserves the previous strictly-sequential behaviour. Set higher when
 * the indexer is far behind head. Each `ingestBlock` is one transaction and
 * idempotent, a failed height is retried (never skipped), and the cursor is
 * the contiguous watermark, so parallel ingest cannot lose a height. With
 * `INDEXER_PARALLEL=8` and ~1s per block, the sustained ingest rate goes
 * from ~1 block/s to ~8 blocks/s.
 *
 * Capped at 32 to keep the Neon connection pool happy on the free tier.
 */
const PARALLEL = Math.max(
  1,
  Math.min(32, Number(process.env.INDEXER_PARALLEL ?? 1)),
);

const RETRY_BASE_MS = Math.max(100, Number(process.env.INDEXER_RETRY_BASE_MS ?? 1_000));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, Number(process.env.INDEXER_RETRY_MAX_MS ?? 60_000));

const GENESIS_CHECK_MS = Math.max(5_000, Number(process.env.INDEXER_GENESIS_CHECK_MS ?? 60_000));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exits the process (code 3) if the RPC serves another chain than the index.
 * Throws on RPC/DB errors, which the caller treats as retryable.
 */
async function guardGenesis(): Promise<void> {
  const rpc = liveGenesisRpc();
  const db = getDb();
  if (!db) {
    console.log(`[indexer] RPC genesis ${await rpc.blockHashAt(0)} (dry: not recorded)`);
    return;
  }
  const v = await checkGenesis(db, rpc);
  if (!v.ok) {
    console.error(`[indexer] ${genesisRefusalMessage(v)}`);
    process.exit(GENESIS_REFUSED_EXIT);
  }
  if (v.action !== "matched") console.log(`[indexer] genesis ${v.genesis} ${v.action} in indexer_state`);
}

/** The startup guard: retry RPC/DB errors with bounded backoff; never write before it passes. */
async function guardGenesisAtStart(): Promise<void> {
  for (let delay = 1_000; ; delay = Math.min(delay * 2, 30_000)) {
    try {
      return await guardGenesis();
    } catch (err) {
      console.error(`[indexer] genesis check failed (retrying in ${delay} ms): ${(err as Error).message}`);
      if (ONCE) throw err;
      await sleep(delay);
    }
  }
}

/** Takes the indexer lock or exits: never two writers on one index. */
async function lockOrExit(): Promise<void> {
  if (!isDbEnabled()) return;
  const lock = await acquireIndexerLock();
  if (!lock) {
    console.error("[indexer] another indexer (or an indexer:reset) holds the indexer lock; exiting");
    process.exit(1);
  }
}

async function once() {
  await lockOrExit();
  await guardGenesisAtStart();
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
  await lockOrExit();
  await guardGenesisAtStart();
  let lastGenesisCheck = Date.now();
  const start = await resumeHeight();
  const sched = new HeightScheduler({
    start,
    parallel: PARALLEL,
    baseDelayMs: RETRY_BASE_MS,
    maxDelayMs: RETRY_MAX_MS,
  });
  const db = getDb();
  let cursor = sched.contiguousThrough();
  console.log(
    `[indexer] resuming at height ${start}; db=${db ? "postgres" : "dry"}; poll=${POLL_MS}ms parallel=${PARALLEL} retry=${RETRY_BASE_MS}..${RETRY_MAX_MS}ms`,
  );
  for (;;) {
    try {
      if (Date.now() - lastGenesisCheck >= GENESIS_CHECK_MS) {
        await guardGenesis();
        lastGenesisCheck = Date.now();
      }
      const head = await headHeight();
      // Due retries first, then fresh heights, up to PARALLEL at a time.
      for (let batch = sched.nextBatch(head); batch.length; batch = sched.nextBatch(head)) {
        const results = await Promise.allSettled(batch.map((h) => ingestBlock(h)));
        for (let i = 0; i < batch.length; i++) {
          const r = results[i];
          const h = batch[i];
          if (r.status === "fulfilled") {
            sched.succeeded(h);
            const v = r.value;
            const sup = v.superseded ? ` superseded=${v.superseded}` : "";
            console.log(`[indexer] block ${h} hash=${v.hash} txs=${v.txCount}${sup}`);
          } else {
            const { attempts, retryInMs } = sched.failed(h);
            console.error(
              `[indexer] block ${h} failed (attempt ${attempts}, retry in ${retryInMs} ms): ${(r.reason as Error).message}`,
            );
          }
        }
        const through = sched.contiguousThrough();
        if (db && through > cursor) {
          await advanceCursor(db, through);
          cursor = through;
        }
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
