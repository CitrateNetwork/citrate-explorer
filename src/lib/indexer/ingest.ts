/**
 * Block ingestion (S-1 WP-1.3). Reads a block from live RPC and writes it — with
 * its DAG edges, transactions, receipts, and logs — into Neon. DAG-native: uses
 * the typed rpc.ts layer so `selected_parent_hash`, `merge_parent_hashes[]`, and
 * `blue_score` are first-class. Idempotent (onConflictDoNothing) so restart and
 * re-ingest never duplicate.
 *
 * Reorg/finality discipline:
 *  - a block displaced below finality is marked `superseded`, never deleted;
 *  - a block at depth >= finalityDepth (100) is finalized and never rewritten.
 *
 * No-op (persisted:false) when DATABASE_URL is unset, so `pnpm indexer` runs in a
 * dry "reads-but-doesn't-persist" mode for smoke-testing without a DB.
 *
 * Data source (Rule 11): live Citrate RPC; written to Neon tables.
 */
import { and, eq, ne, lte, inArray, sql } from "drizzle-orm";
import type { Address, Hash } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { getDagBlock, dagStats, isFinal, type DagBlock } from "@/lib/citrate/rpc";
import { getDb } from "@/lib/db/client";
import {
  blocks,
  dagEdges,
  transactions,
  receipts,
  logs,
  tokenTransfers,
  tokens,
  indexerState,
} from "@/lib/db/schema";
import { decodeTransferLog, type RawLog } from "./transferDecode";
import { getToken } from "@/lib/harness/ops";

const big = (h?: string): string => (h ? BigInt(h).toString() : "0");

export interface IngestResult {
  persisted: boolean;
  height: number;
  hash?: string;
  txCount: number;
  finalized?: boolean;
  superseded?: number;
}

export interface IngestOptions {
  /**
   * Advance the resume cursor (`indexer_state.last_height`). Default true. The smoke pass
   * (`pnpm indexer:once`) sets it false: it ingests only the head, and a cursor at the head would
   * tell the continuous worker that everything below it is indexed.
   */
  advanceCursor?: boolean;
}

/**
 * Ingests a single block by height or "latest". Returns what happened.
 *
 * Atomic per block: every RPC read (the block, DAG stats, receipts, token metadata) happens first,
 * then all of the block's writes commit in ONE database transaction. So a live `blocks` row exists
 * only once the block's edges, transactions, receipts, logs and transfers are stored too. An ingest
 * that dies partway (a crash, a killed smoke pass, a failed insert) leaves no block row, and
 * {@link resumePlan} / {@link isIndexed} see a hole to re-ingest. That is the single definition of
 * "indexed" for the resume plan, the recovery skip and the runbook's completeness check: a height
 * with a live `blocks` row.
 */
export async function ingestBlock(
  ref: number | "latest",
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const block = await getDagBlock(ref);
  if (!block) return { persisted: false, height: typeof ref === "number" ? ref : -1, txCount: 0 };

  const db = getDb();
  if (!db) {
    return { persisted: false, height: block.height, hash: block.hash, txCount: block.txCount };
  }

  let finalized = false;
  try {
    finalized = isFinal(block.blueScore, await dagStats());
  } catch {
    // DAG stats unavailable → leave finalized=false (don't fabricate).
  }

  // Reads first (RPC + a tokens lookup), so the transaction below holds no RPC round-trips.
  const txs = block.raw.transactions ?? [];
  const ref0: BlockRef = { height: block.height, blockHash: block.hash, timestamp: block.timestamp };
  const fetched = await fetchReceipts(txs.map((t) => t.hash as Hash), ref0);
  const newTokens = await fetchNewTokens(db, fetched.transfers);

  const superseded = await db.transaction(async (tx) => {
    // 1. Reorg: a different live (non-superseded, non-final) block already at this
    //    height is displaced by the incoming one — mark it superseded, never delete.
    const displaced = await tx
      .update(blocks)
      .set({ superseded: true })
      .where(
        and(
          eq(blocks.height, block.height),
          ne(blocks.hash, block.hash),
          eq(blocks.finalized, false),
          eq(blocks.superseded, false),
        ),
      )
      .returning({ hash: blocks.hash });

    // Reorg cleanup (RA-3): drop decoded transfers for displaced blocks so aggregates
    // (rich lists, token activity) never double-count across a reorg. Keyed to the
    // canonical block hash; the txs/logs rows are re-inserted for the winning block.
    if (displaced.length) {
      await tx.delete(tokenTransfers).where(
        inArray(tokenTransfers.blockHash, displaced.map((d) => d.hash)),
      );
    }

    // 2. Block row (idempotent insert). Committed together with everything below.
    await tx
      .insert(blocks)
      .values({
        hash: block.hash,
        height: block.height,
        blueScore: block.blueScore,
        blueWork: block.blueWork,
        finalized,
        timestamp: block.timestamp,
        selectedParent: block.selectedParent,
        proposer: block.proposer,
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit,
        baseFeePerGas: block.baseFeePerGas,
        txCount: block.txCount,
        stateRoot: block.raw.stateRoot ?? null,
        txRoot: block.raw.transactionsRoot ?? null,
        receiptRoot: block.raw.receiptsRoot ?? null,
      })
      .onConflictDoNothing();

    // 3. DAG edges: one selected_parent + N merge_parent rows.
    const edges = [
      { childHash: block.hash, parentHash: block.selectedParent, kind: "selected_parent" as const },
      ...block.mergeParents.map((p) => ({
        childHash: block.hash,
        parentHash: p,
        kind: "merge_parent" as const,
      })),
    ];
    await tx.insert(dagEdges).values(edges).onConflictDoNothing();

    // 4. Transactions, then their receipts, logs, decoded transfers and new tokens.
    if (txs.length) {
      await tx
        .insert(transactions)
        .values(
          txs.map((t) => ({
            hash: t.hash,
            blockHash: block.hash,
            blockHeight: block.height,
            txIndex: t.transactionIndex ? Number(BigInt(t.transactionIndex)) : null,
            from: t.from.toLowerCase(),
            to: t.to ? t.to.toLowerCase() : null,
            value: big(t.value),
            nonce: Number(BigInt(t.nonce)),
            gasLimit: t.gas ? Number(BigInt(t.gas)) : null,
            gasPrice: t.gasPrice ? big(t.gasPrice) : null,
            methodId: t.input && t.input.length >= 10 ? t.input.slice(0, 10) : null,
            ethTxType: t.type ? Number(BigInt(t.type)) : null,
            timestamp: block.timestamp,
          })),
        )
        .onConflictDoNothing();
    }
    if (fetched.receipts.length) await tx.insert(receipts).values(fetched.receipts).onConflictDoNothing();
    if (fetched.logs.length) await tx.insert(logs).values(fetched.logs).onConflictDoNothing();
    if (fetched.transfers.length) {
      await tx.insert(tokenTransfers).values(fetched.transfers).onConflictDoNothing();
    }
    if (newTokens.length) await tx.insert(tokens).values(newTokens).onConflictDoNothing();

    // 5. Advance the resume cursor (continuous worker only; see IngestOptions).
    if (opts.advanceCursor !== false) {
      await tx
        .insert(indexerState)
        .values({ id: 1, lastHeight: block.height, lastBlueScore: block.blueScore })
        .onConflictDoUpdate({
          target: indexerState.id,
          set: { lastHeight: block.height, lastBlueScore: block.blueScore, updatedAt: new Date() },
        });
    }
    return displaced.length;
  });

  return { persisted: true, height: block.height, hash: block.hash, txCount: txs.length, finalized, superseded };
}

type Db = NonNullable<ReturnType<typeof getDb>>;

interface BlockRef {
  height: number;
  blockHash: string;
  timestamp: number | null;
}

interface FetchedReceipts {
  receipts: (typeof receipts.$inferInsert)[];
  logs: (typeof logs.$inferInsert)[];
  transfers: (typeof tokenTransfers.$inferInsert & { standard: string })[];
}

/** Fetches receipts (and their logs) for a block's txs and decodes token transfers (RA-3).
 *  RPC reads only; ingestBlock writes the rows. */
async function fetchReceipts(hashes: Hash[], ref: BlockRef): Promise<FetchedReceipts> {
  const out: FetchedReceipts = { receipts: [], logs: [], transfers: [] };
  if (!hashes.length) return out;
  const client = harnessClient();
  for (const hash of hashes) {
    let r;
    try {
      r = await client.getTransactionReceipt({ hash });
    } catch {
      continue; // pending/unavailable — skip honestly (Rule 11), don't fabricate.
    }
    out.receipts.push({
      txHash: hash,
      status: r.status === "success" ? 1 : 0,
      gasUsed: Number(r.gasUsed),
      cumulativeGasUsed: Number(r.cumulativeGasUsed),
      contractAddress: r.contractAddress ?? null,
      logsCount: r.logs.length,
    });

    const rawLogs: (RawLog & { txHash: string })[] = r.logs.map((l) => ({
      txHash: hash,
      address: l.address.toLowerCase(),
      topics: l.topics,
      data: l.data,
      logIndex: Number(l.logIndex ?? 0),
    }));
    for (const l of rawLogs) {
      out.logs.push({
        txHash: l.txHash,
        logIndex: l.logIndex ?? 0,
        address: l.address,
        topic0: l.topics[0] ?? null,
        topic1: l.topics[1] ?? null,
        topic2: l.topics[2] ?? null,
        topic3: l.topics[3] ?? null,
        data: l.data,
        blockHeight: ref.height,
      });
      for (const tr of decodeTransferLog(l)) {
        out.transfers.push({
          txHash: l.txHash,
          blockHash: ref.blockHash,
          blockHeight: ref.height,
          timestamp: ref.timestamp,
          token: tr.token,
          standard: tr.standard,
          from: tr.from,
          to: tr.to,
          value: tr.value ?? null,
          tokenId: tr.tokenId ?? null,
          logIndex: tr.logIndex ?? 0,
        });
      }
    }
  }
  return out;
}

/** Metadata rows for tokens first seen in these transfers (not yet in `tokens`). Reads only. */
async function fetchNewTokens(
  db: Db,
  transfers: FetchedReceipts["transfers"],
): Promise<(typeof tokens.$inferInsert)[]> {
  const seen = new Map<string, string>(); // address -> standard
  for (const row of transfers) if (!seen.has(row.token)) seen.set(row.token, row.standard);
  const rows: (typeof tokens.$inferInsert)[] = [];
  for (const [address, standard] of seen) {
    const existing = await db.select({ a: tokens.address }).from(tokens).where(eq(tokens.address, address)).limit(1);
    if (existing.length) continue;
    let name: string | null = null;
    let symbol: string | null = null;
    let decimals: number | null = null;
    let totalSupply: string | null = null;
    try {
      const meta = await getToken(address as Address);
      name = meta.name ?? null;
      symbol = meta.symbol ?? null;
      decimals = meta.decimals ?? null; // honest null — never a fabricated 18
      totalSupply = meta.totalSupplyRaw ?? null;
    } catch {
      // unreadable / non-conforming token — store what we know (standard) honestly
    }
    rows.push({ address, type: standard, name, symbol, decimals, totalSupply });
  }
  return rows;
}

/**
 * Finality reconciliation: marks every non-final block whose depth has reached
 * `finalityDepth` as finalized. Finalized rows are then immutable (the reorg
 * update in ingestBlock excludes `finalized = true`).
 */
export async function reconcileFinality(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const stats = await dagStats();
  // final iff maxBlueScore − blueScore >= finalityDepth  ⇔  blueScore <= cutoff
  const cutoff = stats.maxBlueScore - stats.ghostdagParams.finalityDepth;
  if (cutoff < 0) return 0;
  const updated = await db
    .update(blocks)
    .set({ finalized: true })
    .where(and(eq(blocks.finalized, false), lte(blocks.blueScore, cutoff)))
    .returning({ hash: blocks.hash });
  return updated.length;
}

export interface ResumePlan {
  /** The first height the continuous worker ingests. */
  next: number;
  /**
   * When `next` is a hole below heights already reached: the highest reached height. Heights up to
   * here that are already indexed are skipped, not refetched (loop.ts skipIndexedThrough).
   * -1 when there is nothing to recover.
   */
  recoverThrough: number;
}

/**
 * Where the continuous worker starts. Never above a hole: the lowest height in [0, reached] with
 * no live block, where `reached` is the higher of the cursor and the highest live block. Without
 * this, a cursor advanced past missing heights (a smoke pass on an older build ingested only the
 * head; a failed block in a batch) would skip them for good while health reported zero lag. With
 * no hole, resume at reached + 1.
 *
 * Reads only `indexer_state.last_height` and `blocks`, so it works on a database that predates
 * later indexer_state migrations (e.g. 0005's genesis columns): the genesis guard, not a crash,
 * decides what happens next. The hole query scans the live block heights once, at start-up.
 */
export async function resumePlan(): Promise<ResumePlan> {
  const db = getDb();
  if (!db) return { next: await headHeight(), recoverThrough: -1 };
  const [cursor] = await db
    .select({ lastHeight: indexerState.lastHeight })
    .from(indexerState)
    .where(eq(indexerState.id, 1))
    .limit(1);
  const [top] = await db
    .select({ h: sql<string | null>`max(${blocks.height})` })
    .from(blocks)
    .where(eq(blocks.superseded, false));
  // last_height defaults to 0, so 0 cannot tell "block 0 indexed" from "nothing yet": only a
  // positive cursor counts; block 0 itself is covered by max(blocks.height).
  const reached = Math.max(
    cursor && cursor.lastHeight > 0 ? cursor.lastHeight : -1,
    top?.h != null ? Number(top.h) : -1,
  );
  if (reached < 0) return { next: 0, recoverThrough: -1 };
  const res = await db.execute<{ hole: string | null }>(sql`
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM ${blocks} WHERE ${blocks.height} = 0 AND ${blocks.superseded} = false) THEN 0
      ELSE (
        SELECT min(b.height) + 1 FROM ${blocks} b
        WHERE b.superseded = false AND b.height < ${reached}
          AND NOT EXISTS (SELECT 1 FROM ${blocks} c WHERE c.height = b.height + 1 AND c.superseded = false)
      )
    END AS hole`);
  const hole = res.rows[0]?.hole;
  if (hole == null) return { next: reached + 1, recoverThrough: -1 };
  return { next: Number(hole), recoverThrough: reached };
}

/** Whether the index holds a live (non-superseded) block at `height`. */
export async function isIndexed(height: number): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const rows = await db
    .select({ h: blocks.height })
    .from(blocks)
    .where(and(eq(blocks.height, height), eq(blocks.superseded, false)))
    .limit(1);
  return rows.length > 0;
}

/** Current chain head height. */
export async function headHeight(): Promise<number> {
  return Number(await harnessClient().getBlockNumber());
}

export type { DagBlock };
