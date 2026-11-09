/**
 * The verify worker loop (EXP-S2): claim a job, process it, record the result;
 * when the queue is idle, sweep newly indexed contract creations for similar
 * matches. Entry point: `pnpm verify:worker` (scripts/verify/worker.ts), run on
 * the indexer host next to the indexer, never in a web function.
 *
 * Data sources (Rule 7): the verification and indexer tables (./store.ts), the
 * Citrate RPC and the sandboxed compiler (via JobDeps).
 */
import { hostname } from "os";
import { log } from "@/lib/api/log";
import { applySimilar, processJob, type JobDeps } from "./job";
import { claimNextJob, enqueueJob, finishJob, getState, legacyRecords, listCreations, releaseJob, setState } from "./store";
import { RequestError, fromApiJson } from "./request";

export interface WorkerOptions {
  workerId?: string;
  /** A running job whose lease is older than this is reclaimed (its worker died). */
  leaseMs?: number;
  /** Attempts before a job that keeps failing transiently is failed for good. */
  maxAttempts?: number;
  /** Creations per idle-time similar-match sweep. */
  sweepBatch?: number;
}

const defaults = (o: WorkerOptions) => ({
  workerId: o.workerId ?? `${hostname()}:${process.pid}`,
  leaseMs: o.leaseMs ?? 10 * 60_000,
  maxAttempts: o.maxAttempts ?? 3,
  sweepBatch: o.sweepBatch ?? 200,
});

/** Process at most one job. */
export async function runOnce(deps: JobDeps, opts: WorkerOptions = {}): Promise<"processed" | "idle"> {
  const o = defaults(opts);
  const job = await claimNextJob(deps.db, o.workerId, o.leaseMs);
  if (!job) return "idle";
  if (job.attempts > o.maxAttempts) {
    await finishJob(deps.db, job.id, o.workerId, {
      status: "fail",
      code: "gave_up",
      message: "verification could not complete after several attempts; resubmit",
    });
    return "processed";
  }
  try {
    const r = await processJob(job, deps);
    await finishJob(deps.db, job.id, o.workerId, r);
    log.info("verify.job", { id: job.id, kind: job.kind, status: r.status, code: r.code });
  } catch (e) {
    // Transient (RPC, DB, compiler download): hand it back unless out of attempts.
    log.warn("verify.job_error", { id: job.id, attempt: job.attempts, error: (e as Error).message });
    if (job.attempts >= o.maxAttempts) {
      await finishJob(deps.db, job.id, o.workerId, {
        status: "fail",
        code: "gave_up",
        message: "verification could not complete after several attempts; resubmit",
      });
    } else {
      await releaseJob(deps.db, job.id, o.workerId);
    }
  }
  return "processed";
}

/** Check indexed creations past the sweep cursor against verified originals. */
export async function sweepNewCreations(deps: JobDeps, batch = 200): Promise<number> {
  const genesis = await deps.chain.genesisHash();
  const key = `similar_sweep_height:${genesis}`;
  const cursor = Number((await getState(deps.db, key)) ?? -1);
  const rows = await listCreations(deps.db, { afterHeight: cursor, limit: batch });
  if (!rows.length) return 0;
  const applied = await applySimilar(deps, genesis, [...new Set(rows.map((r) => r.address))]);
  const top = rows[rows.length - 1].blockHeight;
  // A full batch may have cut a height in two; leave that height for the next sweep.
  const next = rows.length < batch ? top : Math.max(cursor, top - 1);
  await setState(deps.db, key, String(next));
  return applied;
}

/** Queue re-verification of legacy records (pre-v2 store) against the current chain. */
export async function requeueLegacy(deps: JobDeps, limit = 500): Promise<number> {
  const genesis = await deps.chain.genesisHash();
  let queued = 0;
  for (const row of await legacyRecords(deps.db, limit)) {
    const key = `legacy_requeued:${row.legacyGuid}`;
    if (await getState(deps.db, key)) continue;
    let request;
    try {
      request = fromApiJson({
        address: row.address,
        format: "solidity-standard-json-input",
        compilerVersion: row.compilerVersion,
        source: row.legacySource,
        contractName: row.fullyQualifiedName,
      });
    } catch (e) {
      if (!(e instanceof RequestError)) throw e;
      await setState(deps.db, key, "not-standard-json");
      continue;
    }
    await enqueueJob(deps.db, { kind: "verify", origin: "legacy", chainId: deps.chain.chainId, genesisHash: genesis, address: row.address, request });
    await setState(deps.db, key, "queued");
    queued++;
  }
  return queued;
}

/** Run until `signal` aborts. */
export async function runWorker(deps: JobDeps, opts: WorkerOptions & { idleMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const o = defaults(opts);
  const idleMs = opts.idleMs ?? 2000;
  while (!opts.signal?.aborted) {
    let state: "processed" | "idle";
    try {
      state = await runOnce(deps, o);
      if (state === "idle") await sweepNewCreations(deps, o.sweepBatch);
    } catch (e) {
      log.warn("verify.loop_error", { error: (e as Error).message });
      state = "idle";
    }
    if (state === "idle") await new Promise((r) => setTimeout(r, idleMs));
  }
}
