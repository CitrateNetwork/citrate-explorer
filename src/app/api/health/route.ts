import { getChainStatus } from "@/lib/harness/ops";
import { indexerHead } from "@/lib/indexer/repository";
import { isDbEnabled } from "@/lib/db/client";
import { isDistributed } from "@/lib/api/ratelimit";
import { log } from "@/lib/api/log";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * Health + readiness probe (P-8 WP-8.3) for uptime monitors and the indexer
 * freshness alert. Honest, component-level status — never a fake green:
 *
 * - `chain`   — live RPC reachable + chain id is 40204.
 * - `indexer` — DB head height vs chain head → lag in blocks (or not_provisioned).
 * - `limiter` — which rate-limit backend is active (redis vs in-memory).
 * - `inference` — configured mode (not called; just reported).
 *
 * HTTP 200 when the chain is reachable (the explorer can serve), 503 when it
 * isn't. A lagging/absent indexer is `degraded`, not down — live RPC still serves.
 */
export const dynamic = "force-dynamic";

const CHAIN_ID = 40204;
const MAX_LAG = Number(process.env.CITRATE_INDEXER_MAX_LAG ?? 50);

export async function GET(req: Request) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const startedAt = Date.now();

  // --- chain (required) ---
  let chain: Record<string, unknown>;
  let chainHead: number | null = null;
  try {
    const s = await getChainStatus();
    chainHead = Number(s.blockNumber);
    chain = {
      status: s.chainId === CHAIN_ID ? "ok" : "wrong_chain",
      chainId: s.chainId,
      blockNumber: s.blockNumber,
    };
  } catch (err) {
    // PBA-L3c-016: the detail (it names the RPC node) stays in the server log.
    log.error("health.chain_unreachable", { error: (err as Error).message });
    chain = { status: "down", error: "chain RPC unreachable" };
  }

  // --- indexer (optional) ---
  let indexer: Record<string, unknown>;
  try {
    const head = await indexerHead();
    if (!isDbEnabled()) {
      // No DATABASE_URL — the index isn't provisioned at all.
      indexer = { status: "not_provisioned" };
    } else if (head === null) {
      // DB is connected but empty — the worker hasn't ingested a block yet.
      indexer = { status: "empty", note: "DB connected; start the indexer worker to backfill" };
    } else {
      const lag = chainHead !== null ? Math.max(0, chainHead - head) : null;
      indexer = {
        status: lag === null ? "unknown" : lag <= MAX_LAG ? "ok" : "lagging",
        head,
        lagBlocks: lag,
        maxLag: MAX_LAG,
      };
    }
  } catch (err) {
    log.error("health.indexer_error", { error: (err as Error).message });
    indexer = { status: "error", error: "indexer query failed" };
  }

  const limiter = { backend: isDistributed() ? "redis" : "memory" };
  const inference = { mode: process.env.CITRATE_INFERENCE_MODE ?? "gateway" };

  const chainOk = chain.status === "ok";
  const indexerDegraded = indexer.status === "lagging" || indexer.status === "error";
  const overall = !chainOk ? "down" : indexerDegraded ? "degraded" : "ok";

  return Response.json(
    {
      status: overall,
      uptimeCheckMs: Date.now() - startedAt,
      components: { chain, indexer, limiter, inference },
    },
    { status: chainOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
