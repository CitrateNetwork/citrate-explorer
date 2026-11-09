/**
 * Contract verification (WS-2b, EXP-S2), the JSON door used by Citrate Core:
 *   POST /api/verify        -> submitVerification: validate, enqueue, wait briefly for the worker
 *   GET  /api/verify/[guid] -> the job's status
 *
 * The Etherscan (`/api`) and Sourcify (`/v2/...`) doors enqueue into the same
 * queue (src/lib/verify/etherscan.ts, sourcify.ts). The verify worker compiles.
 *
 * Data sources (Rule 7): the verification tables (./store.ts), the Citrate RPC (./chain.ts).
 */
import type { Address } from "viem";
import { PublicError } from "@/lib/api/errors";
import { verifyDeps } from "./deps";
import { submitRequest } from "./etherscan";
import { resolveVerified } from "./read";
import { fromApiJson, RequestError } from "./request";
import { getJob } from "./store";

export type MatchType = "full" | "partial" | "similar";
export type VerificationStatus = "pending" | "pass" | "fail";

export interface VerificationRequest {
  address: Address;
  /** "solidity-standard-json-input" | "solidity-single-file" | "metadata" */
  format: string;
  compilerVersion: string;
  /** Source payload: standard-JSON string, flattened source, or JSON {metadata, sources}. */
  source: string;
  constructorArguments?: string;
  optimizationRuns?: number;
  evmVersion?: string;
  /** "path/File.sol:Name" (recommended) or "Name". */
  contractName?: string;
  /** The deployment transaction, when the indexer may not have it. */
  creationTxHash?: string;
}

export interface VerificationResult {
  guid: string | null;
  address: string;
  status: VerificationStatus;
  matchType?: MatchType;
  contractName?: string;
  compilerVersion?: string;
  message: string;
  /** The queue is full; retry later (HTTP 503). */
  busy?: boolean;
}

function syncWaitMs(): number {
  const n = Number(process.env.CITRATE_VERIFY_SYNC_WAIT_MS);
  return Number.isInteger(n) && n >= 0 ? n : 20_000;
}

/** Validate and enqueue, then wait up to CITRATE_VERIFY_SYNC_WAIT_MS for the worker's verdict. */
export async function submitVerification(req: VerificationRequest): Promise<VerificationResult> {
  const { db, chain } = verifyDeps();
  if (!db) throw new PublicError("verification is unavailable: the explorer has no database provisioned");
  const address = req.address.toLowerCase();
  let normalized;
  try {
    normalized = fromApiJson(req);
  } catch (e) {
    if (e instanceof RequestError) return { guid: null, address, status: "fail", message: e.message };
    throw e;
  }
  const r = await submitRequest({ db, chain }, normalized, "api");
  if (!("id" in r)) {
    if (r.refused === "already_verified") {
      const best = (await resolveVerified(db, chain, address))?.row;
      return {
        guid: best?.jobId ?? null,
        address,
        status: "pass",
        matchType: (best?.matchType as MatchType | undefined) ?? "full",
        contractName: best?.fullyQualifiedName ?? undefined,
        compilerVersion: best?.solcLongVersion ? `v${best.solcLongVersion}` : undefined,
        message: "Contract source code already verified",
      };
    }
    if (r.refused === "busy") return { guid: null, address, status: "pending", busy: true, message: "the verification queue is full; retry shortly" };
    return { guid: null, address, status: "fail", message: r.message };
  }

  const deadline = Date.now() + syncWaitMs();
  for (;;) {
    const job = await getJob(db, r.id);
    if (job && (job.status === "pass" || job.status === "fail")) {
      return {
        guid: job.id,
        address,
        status: job.status,
        matchType: job.status === "pass" ? ((job.matchType as MatchType | null) ?? undefined) : undefined,
        contractName: normalized.contractIdentifier ?? undefined,
        compilerVersion: normalized.compilerVersion,
        message: job.resultMessage ?? "",
      };
    }
    if (Date.now() >= deadline) {
      return { guid: r.id, address, status: "pending", message: `queued; poll GET /api/verify/${r.id}` };
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
}
