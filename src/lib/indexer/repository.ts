/**
 * Read queries over the chain index (Neon). Every function degrades gracefully
 * to a "not provisioned" note when DATABASE_URL is unset, so the explorer + agent
 * keep working against live RPC for single-entity reads (Rule 11: never fake).
 */
import { desc, eq, or, sql } from "drizzle-orm";
import type { Address } from "viem";
import { getDb } from "@/lib/db/client";
import { blocks, transactions } from "@/lib/db/schema";
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

export async function addressActivity(
  address: Address,
): Promise<NotProvisioned | { provisioned: true; address: string; sent: number; received: number }> {
  const db = getDb();
  if (!db) return NOT_PROVISIONED;
  const a = address.toLowerCase();
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.from, a));
  const [received] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.to, a));
  return {
    provisioned: true,
    address: a,
    sent: sent?.n ?? 0,
    received: received?.n ?? 0,
  };
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
