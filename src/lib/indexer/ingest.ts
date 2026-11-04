/**
 * Block ingestion (S-1 WP-1.3). Reads a block from live RPC and writes it — with
 * its DAG edges, transactions, receipts, and logs — into the index. DAG-native: uses
 * the typed rpc.ts layer so `selected_parent_hash`, `merge_parent_hashes[]`, and
 * `blue_score` are first-class. Re-ingesting a block never duplicates rows.
 *
 * All or nothing (explorer#40): every RPC read for a block (the block, each
 * receipt, new token metadata) happens first; then every row is written in one
 * transaction. A failed read or write fails the height, and the loop's
 * scheduler retries it, so "a block row exists" means the whole block landed.
 * The resume cursor is not written here; the loop advances it (`advanceCursor`)
 * only over heights that all landed.
 *
 * Reorg/finality discipline:
 *  - a block displaced below finality is marked `superseded`, never deleted;
 *  - a transaction whose block was superseded moves to the block that now
 *    includes it, with its receipt refreshed and its logs replaced;
 *  - a block at depth >= finalityDepth (100) is finalized and never rewritten.
 *
 * No-op (persisted:false) when DATABASE_URL is unset, so `pnpm indexer` runs in a
 * dry "reads-but-doesn't-persist" mode for smoke-testing without a DB.
 *
 * Data source (Rule 11): live Citrate RPC; written to Neon tables.
 */
import { and, eq, ne, lte, inArray, sql } from "drizzle-orm";
import type { Address, Hash, PublicClient } from "viem";
import { buildHarnessClient, harnessClient } from "@/lib/harness/client";
import { getDagBlock, dagStats, isFinal, type DagBlock } from "@/lib/citrate/rpc";
import type { DagStats } from "@/lib/citrate/dag";
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
import type { ChainDb } from "./types";
import { makeDagStatsCache } from "./dagStatsCache";

const big = (h?: string): string => (h ? BigInt(h).toString() : "0");

/** Per-block finality labels read DAG stats at most once per window (see dagStatsCache). */
const ingestDagStats = makeDagStatsCache(() => dagStats(), 5_000);

export interface IngestResult {
  persisted: boolean;
  height: number;
  hash?: string;
  txCount: number;
  finalized?: boolean;
  superseded?: number;
}

/** The receipt fields the index stores. */
export interface IngestReceipt {
  status: "success" | "reverted";
  gasUsed: bigint;
  cumulativeGasUsed: bigint;
  contractAddress?: string | null;
  logs: { address: string; topics: readonly string[]; data: string; logIndex?: number | null }[];
}

export interface TokenMeta {
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupplyRaw?: string | null;
}

/** Every chain read ingest makes. */
export interface ChainSource {
  /** How many receipt reads ingest issues at once (1 = one after another). */
  receiptBatchSize?: number;
  block(ref: number | "latest"): Promise<DagBlock | null>;
  finalityStats(): Promise<DagStats>;
  receipt(hash: Hash): Promise<IngestReceipt>;
  tokenMeta(address: Address): Promise<TokenMeta>;
}

/**
 * JSON-RPC batch size for the indexer's reads (INDEXER_RPC_BATCH, default 50).
 * Clamped to [1, 100]: the node refuses batches over 100 calls
 * (core/api/src/rpc_limits.rs MAX_BATCH_SIZE) and charges each call against
 * the client's rate bucket. 1 disables batching.
 */
export function rpcBatchSize(env: Record<string, string | undefined> = process.env): number {
  const raw = env.INDEXER_RPC_BATCH;
  if (raw === undefined || raw === "") return 50;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, n));
}

/**
 * The live Citrate RPC (data source, Rule 7: `eth_getBlockByNumber`,
 * `eth_getTransactionReceipt`, `citrate_getDagStats`, ERC-20/721 views). Receipt
 * reads for one block are issued `batchSize` at a time on a batching client, so
 * they reach the node as JSON-RPC batch POSTs instead of one POST per tx.
 */
export function liveChainSource(
  explicitClient?: PublicClient,
  batchSize: number = rpcBatchSize(),
): ChainSource {
  const client = explicitClient ?? buildHarnessClient({ batchSize: rpcBatchSize() });
  return {
    receiptBatchSize: batchSize,
    block: (ref) => getDagBlock(ref, client),
    // The default source is built per block, so it reads finality stats through the
    // module-level 5 s window (#41). A source on an explicit client reads that client.
    finalityStats: explicitClient ? () => dagStats(explicitClient) : () => ingestDagStats(),
    async receipt(hash) {
      const r = await client.getTransactionReceipt({ hash });
      return {
        status: r.status,
        gasUsed: r.gasUsed,
        cumulativeGasUsed: r.cumulativeGasUsed,
        contractAddress: r.contractAddress ?? null,
        logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
      };
    },
    tokenMeta: (address) => getToken(address),
  };
}

export interface IngestOptions {
  db?: ChainDb | null;
  source?: ChainSource;
}

interface FetchedTx {
  hash: string;
  receipt: IngestReceipt;
  logs: (RawLog & { txHash: string; logIndex: number })[];
}

/**
 * Ingests a single block by height or "latest". Throws when any read or write
 * fails, so the caller retries the height; returns what happened otherwise.
 */
export async function ingestBlock(ref: number | "latest", opts: IngestOptions = {}): Promise<IngestResult> {
  const source = opts.source ?? liveChainSource();
  const db = opts.db === undefined ? getDb() : opts.db;

  const block = await source.block(ref);
  if (!block) {
    if (typeof ref === "number") throw new Error(`RPC returned no block at height ${ref}`);
    throw new Error("RPC returned no latest block");
  }
  if (!db) {
    return { persisted: false, height: block.height, hash: block.hash, txCount: block.txCount };
  }

  let finalized = false;
  try {
    finalized = isFinal(block.blueScore, await source.finalityStats());
  } catch {
    // DAG stats unavailable → leave finalized=false (don't fabricate).
  }

  // Reads first: a receipt error fails the whole height (explorer#40 item 1).
  const txs = block.raw.transactions ?? [];
  const fetched: FetchedTx[] = [];
  const chunk = Math.max(1, source.receiptBatchSize ?? 1);
  for (let i = 0; i < txs.length; i += chunk) {
    const part = txs.slice(i, i + chunk);
    const rs = await Promise.all(part.map((t) => source.receipt(t.hash as Hash)));
    part.forEach((t, j) => {
      const r = rs[j];
      fetched.push({
        hash: t.hash,
        receipt: r,
        logs: r.logs.map((l) => ({
          txHash: t.hash,
          address: l.address.toLowerCase(),
          topics: l.topics,
          data: l.data,
          logIndex: Number(l.logIndex ?? 0),
        })),
      });
    });
  }
  const transferRows = fetched.flatMap((f) =>
    f.logs.flatMap((l) =>
      decodeTransferLog(l).map((tr) => ({
        txHash: l.txHash,
        blockHash: block.hash,
        blockHeight: block.height,
        timestamp: block.timestamp,
        token: tr.token,
        standard: tr.standard,
        from: tr.from,
        to: tr.to,
        value: tr.value ?? null,
        tokenId: tr.tokenId ?? null,
        logIndex: tr.logIndex ?? 0,
      })),
    ),
  );
  const newTokens = await fetchNewTokens(db, source, transferRows);

  let superseded = 0;
  await db.transaction(async (tx) => {
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
    superseded = displaced.length;

    // Reorg cleanup (RA-3): drop decoded transfers for displaced blocks so aggregates
    // (rich lists, token activity) never double-count across a reorg.
    if (displaced.length) {
      await tx.delete(tokenTransfers).where(
        inArray(tokenTransfers.blockHash, displaced.map((d) => d.hash)),
      );
    }

    // 2. Block row. A block the RPC serves again after it was displaced is live
    //    again (the displacement above has just superseded its rival).
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
      .onConflictDoUpdate({
        target: blocks.hash,
        set: { superseded: false },
        setWhere: sql`${blocks.superseded} and not ${blocks.finalized}`,
      });

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

    if (!txs.length) return;

    // 4. Transactions. A row already pointing at another live block stays there;
    //    a row whose block is superseded (or unknown) moves to this block.
    const movable = sql`(${transactions.blockHash} is null or ${transactions.blockHash} = excluded.block_hash or exists (select 1 from ${blocks} b where b.hash = ${transactions.blockHash} and b.superseded))`;
    const written = await tx
      .insert(transactions)
      .values(
        [...txs]
          .sort((a, b) => (a.hash < b.hash ? -1 : 1))
          .map((t) => ({
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
      .onConflictDoUpdate({
        target: transactions.hash,
        set: {
          blockHash: sql`excluded.block_hash`,
          blockHeight: sql`excluded.block_height`,
          txIndex: sql`excluded.tx_index`,
          timestamp: sql`excluded.timestamp`,
        },
        setWhere: movable,
      })
      .returning({ hash: transactions.hash, blockHash: transactions.blockHash });

    // Receipts, logs and transfers are this block's only for the txs it owns now.
    const owned = new Set(written.filter((w) => w.blockHash === block.hash).map((w) => w.hash));
    const mine = fetched.filter((f) => owned.has(f.hash));
    if (!mine.length) return;

    // 5. Receipts (refreshed on re-ingest: a reorg can change status and gas).
    await tx
      .insert(receipts)
      .values(
        mine.map((f) => ({
          txHash: f.hash,
          status: f.receipt.status === "success" ? 1 : 0,
          gasUsed: Number(f.receipt.gasUsed),
          cumulativeGasUsed: Number(f.receipt.cumulativeGasUsed),
          contractAddress: f.receipt.contractAddress ?? null,
          logsCount: f.receipt.logs.length,
        })),
      )
      .onConflictDoUpdate({
        target: receipts.txHash,
        set: {
          status: sql`excluded.status`,
          gasUsed: sql`excluded.gas_used`,
          cumulativeGasUsed: sql`excluded.cumulative_gas_used`,
          contractAddress: sql`excluded.contract_address`,
          logsCount: sql`excluded.logs_count`,
        },
      });

    // 6. Logs: replaced, not appended, so a re-ingest never duplicates them.
    const mineHashes = mine.map((f) => f.hash);
    await tx.delete(logs).where(inArray(logs.txHash, mineHashes));
    const logRows = mine.flatMap((f) =>
      f.logs.map((l) => ({
        txHash: l.txHash,
        logIndex: l.logIndex,
        address: l.address,
        topic0: l.topics[0] ?? null,
        topic1: l.topics[1] ?? null,
        topic2: l.topics[2] ?? null,
        topic3: l.topics[3] ?? null,
        data: l.data,
        blockHeight: block.height,
      })),
    );
    if (logRows.length) await tx.insert(logs).values(logRows);

    // 7. Decoded token transfers + newly seen tokens (RA-3).
    await tx.delete(tokenTransfers).where(inArray(tokenTransfers.txHash, mineHashes));
    const myTransfers = transferRows.filter((r) => owned.has(r.txHash));
    if (myTransfers.length) await tx.insert(tokenTransfers).values(myTransfers).onConflictDoNothing();
    if (newTokens.length) {
      await tx.insert(tokens).values(newTokens).onConflictDoNothing();
    }
  });

  return { persisted: true, height: block.height, hash: block.hash, txCount: txs.length, finalized, superseded };
}

type TransferRow = { token: string; standard: string };

/** Token metadata for tokens this block's transfers mention that the index lacks. */
async function fetchNewTokens(db: ChainDb, source: ChainSource, rows: TransferRow[]) {
  const seen = new Map<string, string>(); // address -> standard
  for (const row of rows) if (!seen.has(row.token)) seen.set(row.token, row.standard);
  if (!seen.size) return [];
  const known = await db
    .select({ a: tokens.address })
    .from(tokens)
    .where(inArray(tokens.address, [...seen.keys()]));
  for (const k of known) seen.delete(k.a);
  const out: (typeof tokens.$inferInsert)[] = [];
  for (const [address, standard] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let meta: TokenMeta = {};
    try {
      meta = await source.tokenMeta(address as Address);
    } catch {
      // unreadable / non-conforming token — store what we know (standard) honestly
    }
    out.push({
      address,
      type: standard,
      name: meta.name ?? null,
      symbol: meta.symbol ?? null,
      decimals: meta.decimals ?? null, // honest null — never a fabricated 18
      totalSupply: meta.totalSupplyRaw ?? null,
    });
  }
  return out;
}

/**
 * Moves the resume cursor forward to `height` (never back). The loop calls it
 * with the scheduler's contiguous watermark, so every height at or below the
 * cursor has landed. Keeps the recorded genesis.
 */
export async function advanceCursor(db: ChainDb, height: number): Promise<void> {
  if (height < 0) return;
  const blueAt = sql`(select max(${blocks.blueScore}) from ${blocks} where ${blocks.height} = ${height} and not ${blocks.superseded})`;
  await db
    .insert(indexerState)
    .values({ id: 1, lastHeight: height, lastBlueScore: sql`coalesce(${blueAt}, 0)` })
    .onConflictDoUpdate({
      target: indexerState.id,
      set: {
        lastHeight: sql`greatest(${indexerState.lastHeight}, excluded.last_height)`,
        lastBlueScore: sql`greatest(${indexerState.lastBlueScore}, excluded.last_blue_score)`,
        updatedAt: new Date(),
      },
    });
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
