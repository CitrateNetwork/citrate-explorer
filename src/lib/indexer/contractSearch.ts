/**
 * Contract lookup by name or address, for `GET /api/contracts` and the
 * omni-search.
 *
 * Data source (Rule 11): the `contracts` table (written by the indexer + the
 * backfill + book-label seeding). When the index is unprovisioned, errors, or
 * has nothing for the query yet, it answers from the vendored canonical address
 * book instead and says so (`source: "book"`), so a known deployment is never
 * unfindable just because the index is empty.
 */
import { asc, ilike, or, sql, type SQL } from "drizzle-orm";
import { log } from "@/lib/api/log";
import { getDb } from "@/lib/db/client";
import { contracts } from "@/lib/db/schema";
import { bookLabels } from "./contractLabels";

export const CONTRACTS_PAGE_DEFAULT = 25;
export const CONTRACTS_PAGE_MAX = 100;
/** Deep offsets are refused rather than turned into expensive scans. */
export const CONTRACTS_OFFSET_MAX = 10_000;
export const CONTRACTS_QUERY_MAX = 100;

export interface ContractListItem {
  address: string;
  name: string | null;
  creationTx: string | null;
  verified: boolean;
}

export interface ContractSearchResult {
  source: "index" | "book";
  query: string;
  results: ContractListItem[];
  /** Offset of the next page, or null on the last page. */
  nextOffset: number | null;
  note?: string;
}

export interface ContractSearchParams {
  q?: string;
  limit?: number;
  offset?: number;
}

/** Escapes LIKE metacharacters so a user query is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A query shaped like a (partial) hex address matches by address prefix. */
const ADDRESS_PREFIX_RE = /^0x[0-9a-fA-F]{1,40}$/;

export function normalizeParams(p: ContractSearchParams): { q: string; limit: number; offset: number } {
  const q = (p.q ?? "").trim().slice(0, CONTRACTS_QUERY_MAX);
  const rawLimit = Number.isFinite(p.limit) ? Math.trunc(p.limit as number) : CONTRACTS_PAGE_DEFAULT;
  const rawOffset = Number.isFinite(p.offset) ? Math.trunc(p.offset as number) : 0;
  return {
    q,
    limit: Math.min(Math.max(rawLimit, 1), CONTRACTS_PAGE_MAX),
    offset: Math.min(Math.max(rawOffset, 0), CONTRACTS_OFFSET_MAX),
  };
}

/** Pure: searches the vendored book (used as the fallback). Name match first, then address. */
export function searchBook(p: ContractSearchParams): ContractSearchResult {
  const { q, limit, offset } = normalizeParams(p);
  const needle = q.toLowerCase();
  const isAddr = ADDRESS_PREFIX_RE.test(q);
  const all = bookLabels()
    .filter((l) => !needle || (isAddr ? l.address.startsWith(needle) : l.name.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
  const page = all.slice(offset, offset + limit);
  return {
    source: "book",
    query: q,
    results: page.map((l) => ({ address: l.address, name: l.name, creationTx: l.creationTx, verified: false })),
    nextOffset: offset + limit < all.length ? offset + limit : null,
  };
}

/** The WHERE clause for a query (exported for tests). */
export function contractsWhere(q: string): SQL | undefined {
  if (!q) return undefined;
  if (ADDRESS_PREFIX_RE.test(q)) return ilike(contracts.address, `${escapeLike(q.toLowerCase())}%`);
  const pattern = `%${escapeLike(q)}%`;
  return or(ilike(contracts.name, pattern), ilike(contracts.address, pattern));
}

/**
 * Lists contracts matching `q` (case-insensitive substring of the name, or an
 * address prefix), named contracts first, by name then address. Pages by
 * offset; fetches limit+1 rows to know whether another page exists.
 */
export async function searchContracts(p: ContractSearchParams): Promise<ContractSearchResult> {
  const { q, limit, offset } = normalizeParams(p);
  const db = getDb();
  if (!db) return { ...searchBook({ q, limit, offset }), note: "index not provisioned; answering from the 40204 address book" };
  try {
    const rows = await db
      .select({
        address: contracts.address,
        name: contracts.name,
        creationTx: contracts.creationTx,
        verified: contracts.verified,
      })
      .from(contracts)
      .where(contractsWhere(q))
      .orderBy(sql`${contracts.name} is null`, asc(contracts.name), asc(contracts.address))
      .limit(limit + 1)
      .offset(offset);
    if (rows.length === 0 && offset === 0) {
      const book = searchBook({ q, limit, offset });
      if (book.results.length) return { ...book, note: "no indexed match yet; answering from the 40204 address book" };
    }
    return {
      source: "index",
      query: q,
      results: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  } catch (err) {
    log.warn("contracts.search.index_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ...searchBook({ q, limit, offset }), note: "index unavailable; answering from the 40204 address book" };
  }
}
