/**
 * Bytecode matching for contract verification (WS-2b). Compares recompiled
 * deployed bytecode against the on-chain `eth_getCode`, handling the two things
 * that make naive comparison fail:
 *
 *  - **CBOR metadata** — solc appends a CBOR blob + a 2-byte length to the end of
 *    runtime bytecode (the IPFS/bzzr hash of the metadata). A "full" match means
 *    even this is identical (same compiler + settings + source layout); a
 *    "partial" match means everything BUT the metadata matches (functionally the
 *    same code, different metadata hash).
 *  - **Immutables** — values written once in the constructor are baked into the
 *    deployed code at fixed offsets, so the compiled output has zero-placeholders
 *    where the chain has real values. We mask those ranges (from the compiler's
 *    `immutableReferences`) in BOTH before comparing.
 *
 * Pure + deterministic — unit-tested without RPC or solc.
 */

export type MatchKind = "full" | "partial" | "none";

/** Immutable offsets as solc emits them: astId → [{ start, length }] in BYTES. */
export type ImmutableReferences = Record<string, Array<{ start: number; length: number }>>;

const clean = (hex: string): string => hex.replace(/^0x/, "").toLowerCase();

/** Strip the trailing CBOR metadata (… + 2-byte length) from runtime bytecode. */
export function stripMetadata(hex: string): string {
  const h = clean(hex);
  if (h.length < 4) return h;
  const metaLenBytes = parseInt(h.slice(-4), 16); // last 2 bytes = metadata length
  if (Number.isNaN(metaLenBytes)) return h;
  const stripHexChars = (metaLenBytes + 2) * 2;
  if (stripHexChars >= h.length) return h; // implausible → leave as-is
  return h.slice(0, h.length - stripHexChars);
}

/** Zero out immutable byte ranges so placeholder-vs-baked-value doesn't mismatch. */
export function maskImmutables(hex: string, refs?: ImmutableReferences): string {
  const h = clean(hex);
  if (!refs) return h;
  const arr = h.split("");
  for (const spans of Object.values(refs)) {
    for (const { start, length } of spans) {
      const a = start * 2;
      const b = (start + length) * 2;
      for (let i = a; i < b && i < arr.length; i++) arr[i] = "0";
    }
  }
  return arr.join("");
}

/**
 * Compare recompiled deployed bytecode to on-chain code. Masks immutables in both
 * (same offsets), then: exact (incl. metadata) → "full"; equal after stripping
 * metadata → "partial"; otherwise "none".
 */
export function matchBytecode(
  compiledDeployed: string,
  onChain: string,
  immutableRefs?: ImmutableReferences,
): MatchKind {
  const c = maskImmutables(compiledDeployed, immutableRefs);
  const o = maskImmutables(onChain, immutableRefs);
  if (!c || !o || c === "0x") return "none";
  if (c === o) return "full";
  const cs = stripMetadata(c);
  const os = stripMetadata(o);
  if (cs.length > 0 && cs === os) return "partial";
  return "none";
}
