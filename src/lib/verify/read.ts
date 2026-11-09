/**
 * Verified-record read path (EXP-S2), shared by the Etherscan and Sourcify APIs,
 * the contract page and the getVerifiedSource agent tool. Best match first, for
 * the code that is on chain right now: the record must be for this chain's
 * genesis and this address's current runtime code hash.
 *
 * Data sources (Rule 7): the verified_contracts / contract_proxies tables and the
 * Citrate RPC (genesis hash, eth_getCode).
 */
import { keccak256, type Hex } from "viem";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import { bestMatch, getVerified, isLegacyRecord, latestProxy, type ProxyRow, type VerifiedRow } from "./store";

export interface Resolved {
  genesis: string;
  code: string;
  codeHash: string;
  row: VerifiedRow | null;
  /** For a similar match: the record it was copied from. */
  original: VerifiedRow | null;
  proxy: ProxyRow | null;
}

/** Null when the address has no code. */
export async function resolveVerified(db: ChainDb, chain: ChainReader, address: string): Promise<Resolved | null> {
  const a = address.toLowerCase();
  const [genesis, code] = await Promise.all([chain.genesisHash(), chain.getCode(a)]);
  if (!code || code === "0x") return null;
  const codeHash = keccak256(code as Hex).toLowerCase();
  const [row, proxy] = await Promise.all([
    bestMatch(db, { genesisHash: genesis, address: a, runtimeCodeHash: codeHash }),
    latestProxy(db, genesis, a),
  ]);
  const original = row?.similarTo ? await getVerified(db, row.similarTo) : null;
  return { genesis, code, codeHash, row, original, proxy };
}

/**
 * As resolveVerified, for the machine-readable APIs (Etherscan, Sourcify): a legacy record
 * (isLegacyRecord) counts as no record. Only the contract page shows legacy source.
 */
export async function resolveConfirmed(db: ChainDb, chain: ChainReader, address: string): Promise<Resolved | null> {
  const r = await resolveVerified(db, chain, address);
  if (r?.row && isLegacyRecord(r.row)) return { ...r, row: null, original: null };
  return r;
}

/** The standard JSON input of a record, or null for a legacy record. */
export function stdJsonOf(row: VerifiedRow): { language?: string; sources?: Record<string, { content: string }>; settings?: Record<string, unknown> } | null {
  if (!row.stdJsonInput) return null;
  try {
    return JSON.parse(row.stdJsonInput);
  } catch {
    return null;
  }
}

/** Readable source for the contract page: each file with a header line. */
export function displaySource(row: VerifiedRow): string | null {
  const std = stdJsonOf(row);
  if (!std?.sources) return row.legacySource ?? null;
  const files = Object.entries(std.sources);
  if (files.length === 1) return files[0][1].content;
  return files.map(([path, s]) => `// File: ${path}\n${s.content}`).join("\n\n");
}

/**
 * One verified_contracts row as JSON: the shape src/lib/contract/v2Types.ts describes.
 * A legacy record (isLegacyRecord) carries no match types: its old ones were never checked
 * against the code at the address now.
 */
export function recordJson(row: VerifiedRow) {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  if (isLegacyRecord(row)) {
    return { ...row, matchType: null, runtimeMatch: null, creationMatch: null, legacy: true, verified: false, createdAt };
  }
  return { ...row, legacy: false, verified: row.matchType === "full", createdAt };
}

/** One contract_proxies row as JSON. */
export function proxyJson(row: ProxyRow) {
  return { ...row, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
}

/**
 * The record the contract page reads (GET /api/contract/{a}/verified): best match for the
 * address's current code, the original of a similar match, and the latest proxy link.
 * `storeAvailable` is false only when no database is configured; a failing RPC or query
 * throws, so the caller answers 502 and the page says "unknown", never "unverified".
 */
export async function verifiedResponse(db: ChainDb | null, chain: ChainReader, address: string) {
  if (!db) return { record: null, original: null, proxy: null, storeAvailable: false };
  const r = await resolveVerified(db, chain, address);
  return {
    record: r?.row ? recordJson(r.row) : null,
    original: r?.original ? recordJson(r.original) : null,
    proxy: r?.proxy ? proxyJson(r.proxy) : null,
    storeAvailable: true,
  };
}
