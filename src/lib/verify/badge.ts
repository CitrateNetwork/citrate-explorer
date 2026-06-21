/**
 * Verification trust-badge decision (FWA-C12-05).
 *
 * The single, central place that decides whether a verification result earns the
 * "verified" trust signal. A contract is "verified" ONLY when its recompiled
 * bytecode matches the on-chain code EXACTLY (a `full` match — metadata included).
 *
 * A `partial` match (equal only after stripping the trailing CBOR metadata) means
 * the metadata hash — which commits to the exact source, compiler settings, and
 * file layout — did NOT match. The runtime logic may be the same, but the
 * displayed source can differ from what was deployed in ways the metadata would
 * have caught. So a partial match gets its own clearly-labeled status and is
 * NEVER badged "verified".
 *
 * Fail-closed: any non-`full` match-type (partial / none / null / unknown) yields
 * `verified: false`. Legacy `pass` rows persisted before this change may carry a
 * null `matchType`; treating null as not-verified is the safe default.
 *
 * Pure + deterministic — unit-tested without RPC, DB, or solc.
 */
import type { MatchKind } from "./bytecode";

/** The public trust status rendered on the contract page. */
export type VerificationStatus = "verified" | "partial-match" | "unverified";

export interface VerificationBadge {
  /** TRUE only for a full/exact match — this is what the green shield keys on. */
  verified: boolean;
  /** Distinct machine status; "partial-match" is explicitly NOT "verified". */
  status: VerificationStatus;
  /** Human label for the badge/summary. */
  label: string;
  /** The underlying match kind, surfaced for display (null when absent). */
  matchType: MatchKind | null;
}

/**
 * Map a recompile match-type to the trust badge. Only `full` is verified.
 * Accepts the loosely-typed value read from the DB (string | null | undefined).
 */
export function verificationBadge(
  matchType: MatchKind | string | null | undefined,
): VerificationBadge {
  if (matchType === "full") {
    return { verified: true, status: "verified", label: "Verified (full match)", matchType: "full" };
  }
  if (matchType === "partial") {
    return {
      verified: false,
      status: "partial-match",
      label: "Partial match — NOT verified",
      matchType: "partial",
    };
  }
  // none / null / undefined / anything unexpected → fail closed.
  return {
    verified: false,
    status: "unverified",
    label: "Unverified",
    matchType: matchType === "none" ? "none" : null,
  };
}
