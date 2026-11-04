/**
 * Bytecode matching for verification v2 (EXP-S2). Pure and deterministic.
 *
 * Runtime match: link library placeholders from the on-chain bytes at solc's
 * `linkReferences` offsets, zero a library's call-protection self address, mask
 * immutables (solc `immutableReferences`) in both, then compare:
 *   - "full"    identical, metadata (CBOR) included;
 *   - "partial" identical once the trailing CBOR metadata is stripped from both.
 *
 * Creation match: the creation transaction's input must be the compiled init code
 * (libraries linked) followed by the ABI-encoded constructor arguments. "full" is
 * an exact prefix; "partial" allows only the trailing CBOR metadata blob to differ.
 * The arguments are read off the transaction, never trusted from the submitter.
 *
 * Known limit (same as Sourcify's "partial" heuristic): only the trailing
 * metadata blob is tolerated, so a contract that embeds another contract's
 * creation code (`new X()`) with a different metadata hash matches only fully.
 */
import { keccak256, type Hex } from "viem";
import { maskImmutables, stripMetadata, type ImmutableReferences } from "./bytecode";

export type LinkReferences = Record<string, Record<string, Array<{ start: number; length: number }>>>;
export type SideMatch = "full" | "partial";

const clean = (hex: string): string => hex.replace(/^0x/, "").toLowerCase();

/** A library's runtime starts with PUSH20 <own address> ADDRESS EQ; solc emits zeros there. */
const LIBRARY_PREFIX = "73" + "0".repeat(40) + "3014";

export function isLibraryRuntime(compiledRuntime: string): boolean {
  return clean(compiledRuntime).startsWith(LIBRARY_PREFIX);
}

/** Zero the 20-byte self address a deployed library carries at byte 1. */
function maskLibrarySelf(onchain: string): string {
  if (onchain.length < LIBRARY_PREFIX.length) return onchain;
  if (!onchain.startsWith("73") || onchain.slice(42, 46) !== "3014") return onchain;
  return "73" + "0".repeat(40) + onchain.slice(42);
}

/**
 * Fill solc's link placeholders from `source` (on-chain runtime, or creation input)
 * at the offsets in `refs`, keeping any address already known in `known`.
 * Returns null when the source is too short or one library resolves to two addresses.
 */
export function linkFrom(
  compiled: string,
  refs: LinkReferences | undefined,
  source: string,
  known: Record<string, string> = {},
): { linked: string; libraries: Record<string, string> } | null {
  let c = clean(compiled);
  const s = clean(source);
  const libraries: Record<string, string> = { ...known };
  for (const [file, libs] of Object.entries(refs ?? {})) {
    for (const [name, spans] of Object.entries(libs)) {
      const key = `${file}:${name}`;
      for (const { start, length } of spans) {
        const a = start * 2;
        const b = (start + length) * 2;
        let addr: string;
        if (libraries[key]) {
          addr = clean(libraries[key]);
        } else {
          if (b > s.length) return null;
          addr = s.slice(a, b);
          libraries[key] = `0x${addr}`;
        }
        if (s.length >= b && s.slice(a, b) !== addr) return null;
        c = c.slice(0, a) + addr + c.slice(b);
      }
    }
  }
  return { linked: c, libraries };
}

/** On-chain runtime with immutables and a library's self address zeroed, for similar matches. */
export function maskRuntime(onchain: string, immutables: ImmutableReferences | undefined, isLibrary: boolean): string {
  let o = clean(onchain);
  if (isLibrary) o = maskLibrarySelf(o);
  return maskImmutables(o, immutables);
}

export function maskedRuntimeHash(onchain: string, immutables: ImmutableReferences | undefined, isLibrary: boolean): string {
  return keccak256(`0x${maskRuntime(onchain, immutables, isLibrary)}` as Hex);
}

export interface RuntimeArtifact {
  object: string;
  linkReferences?: LinkReferences;
  immutableReferences?: ImmutableReferences;
}

export interface RuntimeMatch {
  match: SideMatch | null;
  libraries: Record<string, string>;
  isLibrary: boolean;
}

export function matchRuntime(compiled: RuntimeArtifact, onchainCode: string): RuntimeMatch {
  const none: RuntimeMatch = { match: null, libraries: {}, isLibrary: false };
  if (!compiled.object || clean(compiled.object).length === 0) return none;
  const linked = linkFrom(compiled.object, compiled.linkReferences, onchainCode);
  if (!linked) return none;
  const isLibrary = isLibraryRuntime(linked.linked);
  let o = clean(onchainCode);
  if (isLibrary) o = maskLibrarySelf(o);
  const c = maskImmutables(linked.linked, compiled.immutableReferences);
  o = maskImmutables(o, compiled.immutableReferences);
  if (!c || !o) return none;
  if (c === o) return { match: "full", libraries: linked.libraries, isLibrary };
  const cs = stripMetadata(c);
  const os = stripMetadata(o);
  if (cs.length > 0 && cs !== c && cs === os) return { match: "partial", libraries: linked.libraries, isLibrary };
  return { ...none, isLibrary };
}

/** Bytes of a trailing CBOR metadata blob (including its 2-byte length), or 0. */
function trailingCborBytes(hex: string): number {
  if (hex.length < 4) return 0;
  const n = parseInt(hex.slice(-4), 16);
  if (!Number.isFinite(n) || n === 0) return 0;
  const total = n + 2;
  if (total * 2 >= hex.length) return 0;
  return isCbor(hex.slice(hex.length - total * 2)) ? total : 0;
}

/** A solc metadata blob: a CBOR map (major type 5) ending in its own 2-byte length. */
function isCbor(blob: string): boolean {
  if (blob.length < 6 || blob.length % 2 !== 0) return false;
  const first = parseInt(blob.slice(0, 2), 16);
  if (first < 0xa1 || first > 0xbf) return false;
  return parseInt(blob.slice(-4), 16) === blob.length / 2 - 2;
}

export interface CreationArtifact {
  object: string;
  linkReferences?: LinkReferences;
}

export interface CreationMatch {
  match: SideMatch | null;
  /** Hex without 0x, read from the transaction input; null when no match. */
  constructorArgs: string | null;
  /** True when the submitter's arguments differ from the transaction's. */
  suppliedArgsDiffer: boolean;
}

export function matchCreation(
  compiled: CreationArtifact,
  creationInput: string,
  libraries: Record<string, string>,
  suppliedArgs: string | null,
): CreationMatch {
  const none: CreationMatch = { match: null, constructorArgs: null, suppliedArgsDiffer: false };
  const input = clean(creationInput);
  if (!compiled.object || !input) return none;
  const linked = linkFrom(compiled.object, compiled.linkReferences, input, libraries);
  if (!linked) return none;
  const c = linked.linked;
  const supplied = suppliedArgs === null ? null : clean(suppliedArgs);
  const result = (match: SideMatch, args: string): CreationMatch => ({
    match,
    constructorArgs: args,
    suppliedArgsDiffer: supplied !== null && supplied !== args,
  });

  if (input.startsWith(c)) return result("full", input.slice(c.length));

  const meta = trailingCborBytes(c);
  if (meta === 0) return none;
  const head = c.slice(0, c.length - meta * 2);
  if (!input.startsWith(head)) return none;
  const rest = input.slice(head.length);
  if (supplied !== null && supplied.length > 0 && rest.endsWith(supplied)) {
    const mid = rest.slice(0, rest.length - supplied.length);
    if (isCbor(mid)) return result("partial", supplied);
  }
  const mid = rest.slice(0, meta * 2);
  if (isCbor(mid)) return result("partial", rest.slice(meta * 2));
  return none;
}
