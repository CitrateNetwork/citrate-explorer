/**
 * CitrateScan verify worker (EXP-S2). `pnpm verify:worker`
 *
 * Always-on process on the indexer host (NOT a Vercel function). Claims jobs from
 * `verification_jobs`, compiles each in a separate time- and memory-capped child
 * process, matches the result against the chain, and appends verified records.
 * When the queue is idle it sweeps new contract creations for similar matches.
 *
 *   pnpm verify:worker                    run until SIGINT/SIGTERM
 *   pnpm verify:worker --once             process at most one job, then exit
 *   pnpm verify:worker --requeue-legacy   queue re-verification of pre-v2 records, then exit
 *
 * Env: DATABASE_URL (required), NEXT_PUBLIC_CITRATE_RPC_URL, CITRATE_SOLC_CACHE_DIR,
 * CITRATE_VERIFY_COMPILE_TIMEOUT_MS / _MEMORY_MB / _MAX_OUTPUT_MB,
 * CITRATE_VERIFY_SIMILAR_SCAN (creations checked per new record, default 200).
 *
 * Data sources (Rule 7): the index database, the Citrate RPC, the official solc
 * release list and binaries (keccak256-verified).
 */
import { getDb } from "@/lib/db/client";
import { liveChainReader } from "@/lib/verify/chain";
import { sandboxedCompiler, compileLimitsFromEnv } from "@/lib/verify/sandbox";
import { requeueLegacy, runOnce, runWorker } from "@/lib/verify/worker";
import { log } from "@/lib/api/log";

async function main() {
  const db = getDb();
  if (!db) {
    console.error("verify worker: DATABASE_URL is not set; there is no queue to work.");
    process.exit(2);
  }
  const scan = Number(process.env.CITRATE_VERIFY_SIMILAR_SCAN);
  const deps = {
    db,
    chain: liveChainReader(),
    compile: sandboxedCompiler(compileLimitsFromEnv()),
    similarScanLimit: Number.isInteger(scan) && scan >= 0 ? scan : 200,
  };
  const args = process.argv.slice(2);
  if (args.includes("--requeue-legacy")) {
    const n = await requeueLegacy(deps);
    log.info("verify.requeue_legacy", { queued: n });
    return;
  }
  if (args.includes("--once")) {
    const r = await runOnce(deps);
    log.info("verify.once", { result: r });
    return;
  }
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());
  log.info("verify.worker_start", { limits: JSON.stringify(compileLimitsFromEnv()) });
  await runWorker(deps, { signal: ac.signal });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
