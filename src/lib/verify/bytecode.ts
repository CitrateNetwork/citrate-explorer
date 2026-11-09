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

/**
 * Parse a solc metadata blob: a CBOR map whose keys are text strings and whose values are
 * byte strings, text strings, unsigned integers or booleans, followed by the map's own
 * 2-byte length. Parsed exactly: the map must end where the length says. Returns the
 * map's keys, or null when the blob is not such a map.
 */
export function cborMapKeys(blob: string): string[] | null {
  if (blob.length < 6 || blob.length % 2 !== 0) return null;
  const bytes = blob.slice(0, -4);
  if (parseInt(blob.slice(-4), 16) !== bytes.length / 2) return null;
  let i = 0;
  const byte = (): number => {
    if (i + 2 > bytes.length) return -1;
    const b = parseInt(bytes.slice(i, i + 2), 16);
    i += 2;
    return b;
  };
  /** The argument of an initial byte (lengths up to 2 bytes), or -1. */
  const arg = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return byte();
    if (info === 25) {
      const hi = byte();
      const lo = byte();
      return hi < 0 || lo < 0 ? -1 : hi * 256 + lo;
    }
    return -1;
  };
  /** Consume n bytes; their hex, or null past the end. */
  const take = (n: number): string | null => {
    if (n < 0 || i + n * 2 > bytes.length) return null;
    const out = bytes.slice(i, i + n * 2);
    i += n * 2;
    return out;
  };
  const head = byte();
  if (head < 0xa1 || head > 0xb7) return null; // map of 1..23 pairs
  const keys: string[] = [];
  for (let pairs = head - 0xa0; pairs > 0; pairs--) {
    const k = byte();
    if (k < 0 || k >> 5 !== 3) return null; // text-string key
    const keyHex = take(arg(k & 0x1f));
    if (keyHex === null) return null;
    keys.push(Buffer.from(keyHex, "hex").toString("latin1"));
    const v = byte();
    if (v < 0) return null;
    const major = v >> 5;
    if (major === 2 || major === 3) {
      if (take(arg(v & 0x1f)) === null) return null;
    } else if (major === 0) {
      if (arg(v & 0x1f) < 0) return null;
    } else if (v !== 0xf4 && v !== 0xf5) {
      return null;
    }
  }
  return i === bytes.length ? keys : null;
}

/** Whether `blob` is a solc metadata CBOR map (see cborMapKeys). */
export function isCbor(blob: string): boolean {
  return cborMapKeys(blob) !== null;
}

/** Bytes of a trailing CBOR metadata blob (including its 2-byte length), or 0 when there is none. */
export function trailingCborBytes(hex: string): number {
  const h = clean(hex);
  if (h.length < 4) return 0;
  const n = parseInt(h.slice(-4), 16);
  if (!Number.isFinite(n) || n === 0) return 0;
  const total = n + 2;
  if (total * 2 >= h.length) return 0;
  return isCbor(h.slice(h.length - total * 2)) ? total : 0;
}

/** The metadata keys that carry a hash of the metadata JSON. */
const HASH_KEYS = new Set(["ipfs", "bzzr0", "bzzr1"]);

/**
 * Whether the code ends in solc metadata whose CBOR map has a hash key (ipfs, bzzr0, bzzr1);
 * that hash commits to every source file and setting. Without one (`bytecodeHash: "none"`,
 * or `appendCBOR: false`) identical bytecode does not pin the source.
 */
export function hasMetadataHash(hex: string): boolean {
  const h = clean(hex);
  const n = trailingCborBytes(h);
  if (!n) return false;
  const keys = cborMapKeys(h.slice(h.length - n * 2)) ?? [];
  return keys.some((k) => HASH_KEYS.has(k));
}

/**
 * Strip the trailing CBOR metadata (… + 2-byte length) from runtime bytecode. Only a
 * well-formed trailing CBOR map is stripped; anything else is returned unchanged.
 */
export function stripMetadata(hex: string): string {
  const h = clean(hex);
  const n = trailingCborBytes(h);
  return n ? h.slice(0, h.length - n * 2) : h;
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
  if (c === o) return hasMetadataHash(c) ? "full" : "partial";
  const cs = stripMetadata(c);
  const os = stripMetadata(o);
  if (cs.length > 0 && cs !== c && os !== o && cs === os) return "partial";
  return "none";
}
