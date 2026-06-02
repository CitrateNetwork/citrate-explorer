/**
 * Contract verification (S-4). This module defines the request/result contract
 * and the intake; the recompile-and-diff ENGINE (multi-version solc in a Vercel
 * Sandbox, constructor-arg / CBOR-auxdata / immutable / library handling, proxy
 * detection) lands in S-4. Until then, intake records a pending request and the
 * engine call fails loudly rather than returning a fake verdict (Rule 11).
 *
 * Etherscan-compatible surface (see EXPLORER_SPEC.md §3):
 *   POST /api/verify                  → submitVerification → { guid }
 *   GET  /api/verify/[guid]           → checkVerification  → { status }
 *   /api/v1?module=contract&action=verifysourcecode|checkverifystatus
 */
import type { Address } from "viem";

export type MatchType = "full" | "partial";
export type VerificationStatus = "pending" | "pass" | "fail";

export interface VerificationRequest {
  address: Address;
  /** "solidity-standard-json-input" | "solidity-single-file" | "metadata" */
  format: string;
  compilerVersion: string;
  /** Source payload — standard-JSON string, flattened source, or metadata+sources. */
  source: string;
  constructorArguments?: string;
  optimizationRuns?: number;
}

export interface VerificationResult {
  guid: string;
  address: string;
  status: VerificationStatus;
  matchType?: MatchType;
  message: string;
}

/** Deterministic-ish guid from inputs (no Date/random in shared libs). */
function makeGuid(req: VerificationRequest): string {
  const basis = `${req.address}:${req.compilerVersion}:${req.source.length}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) | 0;
  return `vrf_${(h >>> 0).toString(16)}${req.address.slice(2, 10)}`;
}

/**
 * Accepts a verification request. In S-0..S-3 this records the request as
 * `pending` and returns its guid; the engine runs in S-4. The caller (API route)
 * persists the pending row and enqueues the job.
 */
export async function submitVerification(
  req: VerificationRequest,
): Promise<VerificationResult> {
  const guid = makeGuid(req);
  return {
    guid,
    address: req.address,
    status: "pending",
    message:
      "Verification accepted and queued. The recompile-and-diff engine ships in " +
      "S-4 (multi-version solc in a sandbox); poll GET /api/verify/{guid} for status.",
  };
}

/** Runs the recompile-and-diff. Not implemented until S-4. */
export async function runVerificationEngine(): Promise<never> {
  throw new Error(
    "Verification engine not implemented yet (lands in S-4). " +
      "See .agentile/planset/2026-06-02-citrate-explorer-v1/sprints/S-4-contract-verification.md",
  );
}
