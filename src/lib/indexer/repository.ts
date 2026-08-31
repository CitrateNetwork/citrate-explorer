/**
 * Read queries over the chain index (Neon). Every function degrades gracefully
 * to a "not provisioned" note when DATABASE_URL is unset, so the explorer + agent
 * keep working against live RPC for single-entity reads (Rule 11: never fake).
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { formatUnits, type Address } from "viem";
import { getDb } from "@/lib/db/client";
import { blocks, transactions, tokenTransfers } from "@/lib/db/schema";
import { NOT_PROVISIONED, type NotProvisioned } from "./types";

export async function getRecentBlocks(limit = 25) {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  return db.select().from(blocks).orderBy(desc(blocks.blueScore)).limit(limit);
}

/**
 * The highest block height the indexer has persisted, for freshness/lag checks
 * (P-8 health). Returns null when the index isn't provisioned or is empty.
 */
export async function indexerHead(): Promise<number | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ height: sql<number>`max(${blocks.height})` })
    .from(blocks);
  return row?.height ?? null;
}

export async function getBlockByHeight(height: number) {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const rows = await db.select().from(blocks).where(eq(blocks.height, height)).limit(1);
  return rows[0] ?? null;
}

export async function getTxByHash(hash: string) {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.hash, hash))
    .limit(1);
  return rows[0] ?? null;
}

export async function searchTransactions(
  address: Address,
  limit = 25,
): Promise<NotProvisioned | { provisioned: true; results: unknown[] }> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const a = address.toLowerCase();
  const results = await db
    .select()
    .from(transactions)
    .where(or(eq(transactions.from, a), eq(transactions.to, a)))
    .orderBy(desc(transactions.timestamp))
    .limit(limit);
  return { provisioned: true, results };
}

// --- native SALT value queries (RA-2) -------------------------------------

export interface NativeTransferQuery {
  minGrains?: bigint;
  maxGrains?: bigint;
  counterparty?: string;
  direction?: "sent" | "received" | "either";
  fromTs?: number;
  toTs?: number;
  successOnly?: boolean;
  order?: "value_desc" | "value_asc" | "time_desc";
  limit?: number;
}

export interface NativeTransferRow {
  hash: string;
  blockHeight: number | null;
  timestamp: number | null;
  from: string;
  to: string | null;
  grains: string;
  salt: string;
  status: number | null;
}

export interface NativeTransfersResult {
  provisioned: true;
  asset: "SALT (native)";
  coverage: { minTimestamp: number | null; maxTimestamp: number | null; minHeight: number | null; maxHeight: number | null };
  truncated: boolean;
  count: number;
  transfers: NativeTransferRow[];
}

/**
 * Find native SALT transfers (`transactions.value`) by amount range, time window,
 * counterparty, and direction — the RA-2 hash-free value query. Value comparison
 * uses NUMERIC casting so 256-bit magnitudes order correctly (the column is a
 * decimal-string of grains). Zero-value txs are excluded (not value transfers).
 * Always reports the index `coverage` window and a `truncated` flag (X-2: no
 * silent truncation). Native SALT only — token transfers land in RA-3.
 *
 * Data source (Rule 11): Neon `transactions`, written by the indexer from live RPC.
 */
export async function findNativeTransfers(
  q: NativeTransferQuery,
): Promise<NotProvisioned | NativeTransfersResult> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;

  const valueNumeric = sql`CAST(${transactions.value} AS NUMERIC)`;
  const conds = [sql`${valueNumeric} > 0`];
  if (q.minGrains !== undefined) conds.push(sql`${valueNumeric} >= CAST(${q.minGrains.toString()} AS NUMERIC)`);
  if (q.maxGrains !== undefined) conds.push(sql`${valueNumeric} <= CAST(${q.maxGrains.toString()} AS NUMERIC)`);
  if (q.counterparty) {
    const cp = q.counterparty.toLowerCase();
    if (q.direction === "sent") conds.push(eq(transactions.from, cp));
    else if (q.direction === "received") conds.push(eq(transactions.to, cp));
    else conds.push(or(eq(transactions.from, cp), eq(transactions.to, cp))!);
  }
  if (q.fromTs !== undefined) conds.push(sql`${transactions.timestamp} >= ${q.fromTs}`);
  if (q.toTs !== undefined) conds.push(sql`${transactions.timestamp} <= ${q.toTs}`);
  if (q.successOnly) conds.push(sql`(${transactions.status} = 1 OR ${transactions.status} IS NULL)`);

  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const orderBy =
    q.order === "value_asc" ? sql`${valueNumeric} ASC` :
    q.order === "time_desc" ? desc(transactions.timestamp) :
    sql`${valueNumeric} DESC`;

  const rows = await db
    .select({
      hash: transactions.hash,
      blockHeight: transactions.blockHeight,
      timestamp: transactions.timestamp,
      from: transactions.from,
      to: transactions.to,
      value: transactions.value,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(...conds))
    .orderBy(orderBy)
    .limit(limit + 1);

  const truncated = rows.length > limit;
  const transfers: NativeTransferRow[] = rows.slice(0, limit).map((r) => ({
    hash: r.hash,
    blockHeight: r.blockHeight,
    timestamp: r.timestamp,
    from: r.from,
    to: r.to,
    grains: r.value,
    salt: formatUnits(BigInt(r.value || "0"), 18),
    status: r.status,
  }));

  const [cov] = await db
    .select({
      minTs: sql<number | null>`min(${transactions.timestamp})`,
      maxTs: sql<number | null>`max(${transactions.timestamp})`,
      minH: sql<number | null>`min(${transactions.blockHeight})`,
      maxH: sql<number | null>`max(${transactions.blockHeight})`,
    })
    .from(transactions);

  // Postgres min/max(bigint) come back as strings via the driver — coerce to numbers
  // so the result type (and the agent) gets real numbers, not "1004".
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    provisioned: true,
    asset: "SALT (native)",
    coverage: {
      minTimestamp: num(cov?.minTs),
      maxTimestamp: num(cov?.maxTs),
      minHeight: num(cov?.minH),
      maxHeight: num(cov?.maxH),
    },
    truncated,
    count: transfers.length,
    transfers,
  };
}

// --- token (ERC-20/721/1155) transfer queries (RA-3) ----------------------

export interface TokenTransferQuery {
  token: string;
  minRaw?: bigint;
  maxRaw?: bigint;
  counterparty?: string;
  direction?: "sent" | "received" | "either";
  fromTs?: number;
  toTs?: number;
  order?: "value_desc" | "value_asc" | "time_desc";
  limit?: number;
}

export interface TokenTransferRow {
  txHash: string;
  blockHeight: number | null;
  timestamp: number | null;
  standard: string | null;
  from: string;
  to: string;
  valueRaw: string | null;
  tokenId: string | null;
}

export interface TokenTransfersResult {
  provisioned: true;
  token: string;
  truncated: boolean;
  count: number;
  transfers: TokenTransferRow[];
}

/**
 * Find ERC-20/721/1155 transfers of one token by amount range (raw units), time
 * window, counterparty, and direction (RA-3). Amounts compare via NUMERIC cast on
 * the raw value; the caller converts a human amount using the token's decimals.
 *
 * Data source (Rule 11): Neon `token_transfers`, decoded at index time from logs.
 */
export async function findTokenTransfers(
  q: TokenTransferQuery,
): Promise<NotProvisioned | TokenTransfersResult> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;

  const valueNumeric = sql`CAST(${tokenTransfers.value} AS NUMERIC)`;
  const conds = [eq(tokenTransfers.token, q.token.toLowerCase())];
  if (q.minRaw !== undefined) conds.push(sql`${valueNumeric} >= CAST(${q.minRaw.toString()} AS NUMERIC)`);
  if (q.maxRaw !== undefined) conds.push(sql`${valueNumeric} <= CAST(${q.maxRaw.toString()} AS NUMERIC)`);
  if (q.counterparty) {
    const cp = q.counterparty.toLowerCase();
    if (q.direction === "sent") conds.push(eq(tokenTransfers.from, cp));
    else if (q.direction === "received") conds.push(eq(tokenTransfers.to, cp));
    else conds.push(or(eq(tokenTransfers.from, cp), eq(tokenTransfers.to, cp))!);
  }
  if (q.fromTs !== undefined) conds.push(sql`${tokenTransfers.timestamp} >= ${q.fromTs}`);
  if (q.toTs !== undefined) conds.push(sql`${tokenTransfers.timestamp} <= ${q.toTs}`);

  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const orderBy =
    q.order === "value_asc" ? sql`${valueNumeric} ASC NULLS LAST` :
    q.order === "time_desc" ? desc(tokenTransfers.timestamp) :
    sql`${valueNumeric} DESC NULLS LAST`;

  const rows = await db
    .select({
      txHash: tokenTransfers.txHash,
      blockHeight: tokenTransfers.blockHeight,
      timestamp: tokenTransfers.timestamp,
      standard: tokenTransfers.standard,
      from: tokenTransfers.from,
      to: tokenTransfers.to,
      value: tokenTransfers.value,
      tokenId: tokenTransfers.tokenId,
    })
    .from(tokenTransfers)
    .where(and(...conds))
    .orderBy(orderBy)
    .limit(limit + 1);

  const truncated = rows.length > limit;
  const transfers: TokenTransferRow[] = rows.slice(0, limit).map((r) => ({
    txHash: r.txHash,
    blockHeight: r.blockHeight,
    timestamp: r.timestamp,
    standard: r.standard,
    from: r.from,
    to: r.to,
    valueRaw: r.value,
    tokenId: r.tokenId,
  }));

  return { provisioned: true, token: q.token.toLowerCase(), truncated, count: transfers.length, transfers };
}

/** Count a token's transfers (and distinct counterparties) in a time window. */
export async function tokenActivity(
  token: string,
  opts: { fromTs?: number; toTs?: number } = {},
): Promise<NotProvisioned | { provisioned: true; token: string; transfers: number; senders: number; recipients: number }> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const conds = [eq(tokenTransfers.token, token.toLowerCase())];
  if (opts.fromTs !== undefined) conds.push(sql`${tokenTransfers.timestamp} >= ${opts.fromTs}`);
  if (opts.toTs !== undefined) conds.push(sql`${tokenTransfers.timestamp} <= ${opts.toTs}`);
  const [row] = await db
    .select({
      transfers: sql<number>`count(*)::int`,
      senders: sql<number>`count(distinct ${tokenTransfers.from})::int`,
      recipients: sql<number>`count(distinct ${tokenTransfers.to})::int`,
    })
    .from(tokenTransfers)
    .where(and(...conds));
  return {
    provisioned: true,
    token: token.toLowerCase(),
    transfers: row?.transfers ?? 0,
    senders: row?.senders ?? 0,
    recipients: row?.recipients ?? 0,
  };
}

export async function addressActivity(
  address: Address,
): Promise<
  | NotProvisioned
  | {
      provisioned: true;
      address: string;
      sent: number;
      received: number;
      tokenSent: number;
      tokenReceived: number;
    }
> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const a = address.toLowerCase();
  // A relayer-funded member (nonce 0) is NEVER a tx-level `from`/`to` — the relayer is `from` and the
  // SBT/vault contract is `to` — so tx counts alone read 0 and the address looks empty/unknown. But the
  // member IS the recipient of the SBT mint + grant transfer, captured in token_transfers. Count those
  // too so such an address resolves with its real activity (Rule 11: source is indexed token_transfers).
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.from, a));
  const [received] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.to, a));
  const [tokenSent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tokenTransfers)
    .where(eq(tokenTransfers.from, a));
  const [tokenReceived] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tokenTransfers)
    .where(eq(tokenTransfers.to, a));
  return {
    provisioned: true,
    address: a,
    sent: sent?.n ?? 0,
    received: received?.n ?? 0,
    tokenSent: tokenSent?.n ?? 0,
    tokenReceived: tokenReceived?.n ?? 0,
  };
}

/**
 * A relayer-funded recipient's token history (SBT mint, grant transfer, …) — the transfers where the
 * address is `from` or `to`, newest first. This is what makes a nonce-0 member resolve with real
 * on-chain history instead of an empty page. Data source (Rule 11): indexed `token_transfers`.
 */
export async function addressTokenTransfers(
  address: Address,
  limit = 25,
): Promise<NotProvisioned | { provisioned: true; results: unknown[] }> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const a = address.toLowerCase();
  const results = await db
    .select({
      txHash: tokenTransfers.txHash,
      blockHeight: tokenTransfers.blockHeight,
      timestamp: tokenTransfers.timestamp,
      standard: tokenTransfers.standard,
      token: tokenTransfers.token,
      from: tokenTransfers.from,
      to: tokenTransfers.to,
      value: tokenTransfers.value,
      tokenId: tokenTransfers.tokenId,
    })
    .from(tokenTransfers)
    .where(or(eq(tokenTransfers.from, a), eq(tokenTransfers.to, a)))
    .orderBy(desc(tokenTransfers.timestamp))
    .limit(limit);
  return { provisioned: true, results };
}

export async function topHolders(
  token: Address,
  limit = 10,
): Promise<NotProvisioned | { provisioned: true; token: string; holders: unknown[] }> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  // Net holders are derived from indexed token_transfers; the full balance
  // rollup lands in S-2. For now expose the transfer-recipient leaderboard.
  const rows = await db.execute(sql`
    SELECT to_addr AS holder, count(*)::int AS transfers
    FROM token_transfers
    WHERE token = ${token.toLowerCase()}
    GROUP BY to_addr
    ORDER BY transfers DESC
    LIMIT ${limit}
  `);
  const holders = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return { provisioned: true, token: token.toLowerCase(), holders };
}

/** Exists-check used by omni-search: is this hash a block or a tx? */
export async function classifyHash(
  hash: string,
): Promise<"block" | "transaction" | "unknown" | NotProvisioned> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const [b] = await db.select({ h: blocks.hash }).from(blocks).where(eq(blocks.hash, hash)).limit(1);
  if (b) return "block";
  const [t] = await db
    .select({ h: transactions.hash })
    .from(transactions)
    .where(eq(transactions.hash, hash))
    .limit(1);
  if (t) return "transaction";
  return "unknown";
}
