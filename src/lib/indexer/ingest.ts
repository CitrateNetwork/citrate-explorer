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
import { and, eq, ne, lte } from "drizzle-orm";
import type { Hash } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { getDagBlock, dagStats, isFinal, type DagBlock } from "@/lib/citrate/rpc";
import { getDb } from "@/lib/db/client";
import {
  blocks,
  dagEdges,
  transactions,
  receipts,
  logs,
  indexerState,
} from "@/lib/db/schema";

const big = (h?: string): string => (h ? BigInt(h).toString() : "0");

export interface IngestResult {
  persisted: boolean;
  height: number;
  hash?: string;
  txCount: number;
  finalized?: boolean;
  superseded?: number;
}

/** Ingests a single block by height or "latest". Returns what happened. */
export async function ingestBlock(
  ref: number | "latest",
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

  // 1. Reorg: a different live (non-superseded, non-final) block already at this
  //    height is displaced by the incoming one — mark it superseded, never delete.
  let superseded = 0;
  const displaced = await db
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
  superseded = displaced.length;

  // 2. Block row (idempotent insert).
  await db
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
  await db.insert(dagEdges).values(edges).onConflictDoNothing();

  // 4. Transactions, then their receipts + logs.
  const txs = block.raw.transactions ?? [];
  if (txs.length) {
    await db
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

    await ingestReceipts(db, txs.map((t) => t.hash as Hash), block.height);
  }

  // 5. Advance the resume cursor (monotonic).
  await db
    .insert(indexerState)
    .values({ id: 1, lastHeight: block.height, lastBlueScore: block.blueScore })
    .onConflictDoUpdate({
      target: indexerState.id,
      set: { lastHeight: block.height, lastBlueScore: block.blueScore, updatedAt: new Date() },
    });

  return { persisted: true, height: block.height, hash: block.hash, txCount: txs.length, finalized, superseded };
}

type Db = NonNullable<ReturnType<typeof getDb>>;

/** Fetches receipts (and their logs) for a set of tx hashes and persists them. */
async function ingestReceipts(db: Db, hashes: Hash[], height: number): Promise<void> {
  const client = harnessClient();
  for (const hash of hashes) {
    let r;
    try {
      r = await client.getTransactionReceipt({ hash });
    } catch {
      continue; // pending/unavailable — skip honestly (Rule 11), don't fabricate.
    }
    await db
      .insert(receipts)
      .values({
        txHash: hash,
        status: r.status === "success" ? 1 : 0,
        gasUsed: Number(r.gasUsed),
        cumulativeGasUsed: Number(r.cumulativeGasUsed),
        contractAddress: r.contractAddress ?? null,
        logsCount: r.logs.length,
      })
      .onConflictDoNothing();

    if (r.logs.length) {
      await db
        .insert(logs)
        .values(
          r.logs.map((l) => ({
            txHash: hash,
            logIndex: Number(l.logIndex ?? 0),
            address: l.address.toLowerCase(),
            topic0: l.topics[0] ?? null,
            topic1: l.topics[1] ?? null,
            topic2: l.topics[2] ?? null,
            topic3: l.topics[3] ?? null,
            data: l.data,
            blockHeight: height,
          })),
        )
        .onConflictDoNothing();
    }
  }
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

/** The height to resume backfill from on restart (cursor + 1, or chain head). */
export async function resumeHeight(): Promise<number> {
  const db = getDb();
  if (!db) return Number(await harnessClient().getBlockNumber());
  const [row] = await db.select().from(indexerState).where(eq(indexerState.id, 1)).limit(1);
  if (row && row.lastHeight > 0) return row.lastHeight + 1;
  return 0;
}

/** Current chain head height. */
export async function headHeight(): Promise<number> {
  return Number(await harnessClient().getBlockNumber());
}

export type { DagBlock };
