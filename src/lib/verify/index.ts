/**
 * Contract verification (WS-2b) — public surface. The recompile-and-diff ENGINE
 * lives in `engine.ts` (solc-js compile → immutable-mask + metadata-strip → diff)
 * and persists the verified source/ABI. This module keeps the request/result
 * types + the deterministic guid, and `submitVerification` runs the engine inline.
 *
 * Etherscan-compatible surface (EXPLORER_SPEC.md §3):
 *   POST /api/verify        → submitVerification → { guid, status, matchType }
 *   GET  /api/verify/[guid]  → the persisted record
 *   /api/v1?module=contract&action=verifysourcecode|checkverifystatus
 */
import type { Address } from "viem";
import { verifyContract } from "./engine";

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
  evmVersion?: string;
}

export interface VerificationResult {
  guid: string;
  address: string;
  status: VerificationStatus;
  matchType?: MatchType;
  contractName?: string;
  compilerVersion?: string;
  message: string;
}

/** Deterministic guid from inputs (no Date/random — stable across retries). */
export function makeGuid(req: VerificationRequest): string {
  const basis = `${req.address.toLowerCase()}:${req.compilerVersion}:${req.source.length}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) | 0;
  return `vrf_${(h >>> 0).toString(16)}${req.address.slice(2, 10)}`;
}

/** Verify a contract (runs the engine inline) and return the verdict. */
export async function submitVerification(
  req: VerificationRequest,
): Promise<VerificationResult> {
  const guid = makeGuid(req);
  const outcome = await verifyContract({
    guid,
    address: req.address,
    format: req.format,
    compilerVersion: req.compilerVersion,
    source: req.source,
    optimizationRuns: req.optimizationRuns,
    evmVersion: req.evmVersion,
  });
  return {
    guid,
    address: outcome.address,
    status: outcome.status,
    matchType:
      outcome.matchType === "full" || outcome.matchType === "partial" ? outcome.matchType : undefined,
    contractName: outcome.contractName,
    compilerVersion: outcome.compiler,
    message: outcome.message,
  };
}
