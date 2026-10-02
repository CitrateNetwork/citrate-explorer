/**
 * Verified-source lookup (HUP-S4.3 / federation F-6). READ-ONLY.
 *
 * One shape for "what source, ABI, and compiler produced the code at this address",
 * served three ways from this module:
 *   - the `getVerifiedSource` agent/MCP tool (src/lib/ai/tools.ts → /api/mcp),
 *   - GET /api/contract/[addr]/source (the lean REST lookup citrate-core calls),
 *   - (the contract page keeps its own richer route, /api/contract/[addr]).
 *
 * Data source (Rule 11): the `contract_verifications` table in Neon, written only by
 * the recompile-and-diff engine (engine.ts). Nothing here compiles, fetches RPC, or
 * guesses source for an unverified contract.
 *
 * Honest statuses (the trust decision is `verificationBadge`, FWA-C12-05):
 *   - "verified"       a full match (metadata included). The only status with verified=true.
 *   - "partial-match"  equal only after stripping metadata. Source shown, NOT verified.
 *   - "unverified"     no passing record for this address.
 *   - "unavailable"    the verification store is not provisioned or could not be read.
 *                      Never reported as "unverified": we do not know.
 */
import { verificationBadge } from "./badge";

export type VerifiedSourceStatus = "verified" | "partial-match" | "unverified" | "unavailable";

/** The persisted columns this lookup reads (a subset of a contract_verifications row). */
export interface VerifiedRow {
  matchType: string | null;
  contractName: string | null;
  compilerVersion: string | null;
  sourceHash: string | null;
  source: string | null;
  abi: string | null;
  verifiedAt: Date | string | null;
}

export interface VerifiedSource {
  /** Lowercased 0x address. */
  address: string;
  status: VerifiedSourceStatus;
  /** True only for a full match. */
  verified: boolean;
  matchType: "full" | "partial" | null;
  contractName: string | null;
  /** The solc version the match was made with (e.g. v0.8.26+commit.8a97fa7a). */
  compilerVersion: string | null;
  sourceHash: string | null;
  /** The (possibly truncated) verified source; null when there is none. */
  source: string | null;
  /** Length of the full stored source, before truncation. */
  sourceChars: number;
  sourceTruncated: boolean;
  /** The parsed ABI, or null (none stored, or not valid JSON). */
  abi: unknown[] | null;
  verifiedAt: string | null;
  /** One plain sentence on what this result means. */
  note: string;
}

/** Default and hard cap for how much source one lookup returns. */
export const DEFAULT_MAX_SOURCE_CHARS = 60_000;
export const MAX_SOURCE_CHARS_LIMIT = 400_000;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function clampChars(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_MAX_SOURCE_CHARS;
  return Math.min(MAX_SOURCE_CHARS_LIMIT, Math.max(1, Math.floor(n)));
}

function parseAbi(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function iso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function empty(address: string, status: "unverified" | "unavailable", note: string): VerifiedSource {
  return {
    address,
    status,
    verified: false,
    matchType: null,
    contractName: null,
    compilerVersion: null,
    sourceHash: null,
    source: null,
    sourceChars: 0,
    sourceTruncated: false,
    abi: null,
    verifiedAt: null,
    note,
  };
}

/** Pure: shape a persisted row (or its absence) into the public answer. */
export function shapeVerifiedSource(
  address: string,
  row: VerifiedRow | null,
  storeAvailable: boolean,
  maxSourceChars?: number,
): VerifiedSource {
  const addr = address.toLowerCase();
  if (!storeAvailable) {
    return empty(
      addr,
      "unavailable",
      "The verification store is unavailable right now, so it is unknown whether this contract is verified.",
    );
  }
  if (!row) {
    return empty(
      addr,
      "unverified",
      "Not verified: no source has been verified for this address on CitrateScan. Do not assume what its code does.",
    );
  }
  const badge = verificationBadge(row.matchType);
  const status: VerifiedSourceStatus =
    badge.status === "verified" ? "verified" : badge.status === "partial-match" ? "partial-match" : "unverified";
  const full = row.source ?? "";
  const cap = clampChars(maxSourceChars);
  const truncated = full.length > cap;
  const note =
    status === "verified"
      ? "Verified: the recompiled bytecode matches the deployed code exactly, metadata included."
      : status === "partial-match"
        ? "Partial match: the code matches only after stripping metadata, so the shown source may differ from what was deployed. This is not a verified match."
        : "Not verified: the recorded match is not a full match.";
  return {
    address: addr,
    status,
    verified: badge.verified,
    matchType: row.matchType === "full" || row.matchType === "partial" ? row.matchType : null,
    contractName: row.contractName,
    compilerVersion: row.compilerVersion,
    sourceHash: row.sourceHash,
    source: row.source === null ? null : truncated ? full.slice(0, cap) : full,
    sourceChars: full.length,
    sourceTruncated: truncated,
    abi: parseAbi(row.abi),
    verifiedAt: iso(row.verifiedAt),
    note: truncated ? `${note} Source truncated to ${cap} of ${full.length} characters.` : note,
  };
}

export interface VerifiedSourceDeps {
  /** Whether the verification store is provisioned. */
  storeAvailable: () => boolean;
  /** The latest passing record for a lowercased address, or null. */
  lookup: (address: string) => Promise<VerifiedRow | null>;
}

async function defaultDeps(): Promise<VerifiedSourceDeps> {
  const [{ isDbEnabled }, { getVerifiedContract }] = await Promise.all([
    import("@/lib/db/client"),
    import("./engine"),
  ]);
  return { storeAvailable: isDbEnabled, lookup: (a) => getVerifiedContract(a) };
}

/** Look up the verified source for an address. Throws only on a malformed address. */
export async function getVerifiedSource(
  address: string,
  opts: { maxSourceChars?: number; deps?: VerifiedSourceDeps } = {},
): Promise<VerifiedSource> {
  if (!ADDRESS_RE.test(address)) throw new Error("expected a 0x-prefixed 20-byte address");
  const addr = address.toLowerCase();
  const deps = opts.deps ?? (await defaultDeps());
  if (!deps.storeAvailable()) return shapeVerifiedSource(addr, null, false, opts.maxSourceChars);
  let row: VerifiedRow | null;
  try {
    row = await deps.lookup(addr);
  } catch {
    // The store failed; do not leak its error text and do not claim "unverified".
    return shapeVerifiedSource(addr, null, false, opts.maxSourceChars);
  }
  return shapeVerifiedSource(addr, row, true, opts.maxSourceChars);
}
