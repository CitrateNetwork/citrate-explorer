/**
 * Block ingestion: read a block from live RPC and write it (plus its DAG edges
 * and transactions) into Neon. DAG-native — we capture Citrate's extra header
 * fields (blue_score, merge_parent_hashes) from the raw eth_getBlockByNumber
 * response, which viem's typed getBlock drops.
 *
 * No-op (persisted:false) when DATABASE_URL is unset, so `pnpm indexer` runs in
 * a dry mode for smoke-testing without a DB.
 *
 * Data source (Rule 11): live Citrate RPC; written to Neon tables.
 */
import { harnessClient } from "@/lib/harness/client";
import { getDagStats, isFinalized } from "@/lib/citrate/dag";
import { getDb } from "@/lib/db/client";
import { blocks, dagEdges, transactions } from "@/lib/db/schema";

/** The raw Citrate block shape (superset of the standard eth block). */
interface RawBlock {
  hash: string;
  number: string; // hex
  timestamp: string; // hex
  parentHash: string;
  miner?: string;
  proposer?: string;
  gasUsed?: string;
  gasLimit?: string;
  baseFeePerGas?: string;
  stateRoot?: string;
  transactionsRoot?: string;
  receiptsRoot?: string;
  blueScore?: string; // hex (Citrate)
  blueWork?: string; // hex (Citrate)
  selectedParentHash?: string; // (Citrate)
  mergeParentHashes?: string[]; // (Citrate)
  transactions?: RawTx[];
}

interface RawTx {
  hash: string;
  from: string;
  to?: string | null;
  value: string; // hex
  nonce: string; // hex
  gas?: string; // hex
  gasPrice?: string; // hex
  input?: string;
  transactionIndex?: string; // hex
  type?: string; // hex
}

const hexToNum = (h?: string): number => (h ? Number(BigInt(h)) : 0);
const hexToBig = (h?: string): string => (h ? BigInt(h).toString() : "0");
const toHex = (n: number | bigint): `0x${string}` => `0x${BigInt(n).toString(16)}`;

async function fetchRawBlock(height: number): Promise<RawBlock | null> {
  const client = harnessClient();
  const raw = (await (
    client as unknown as {
      request: (a: { method: string; params: unknown[] }) => Promise<unknown>;
    }
  ).request({
    method: "eth_getBlockByNumber",
    params: [toHex(height), true],
  })) as RawBlock | null;
  return raw;
}

export interface IngestResult {
  persisted: boolean;
  height: number;
  hash?: string;
  txCount: number;
  finalized?: boolean;
}

/** Ingests a single block by height. Returns what happened (Rule 11: honest). */
export async function ingestBlock(height: number): Promise<IngestResult> {
  const raw = await fetchRawBlock(height);
  if (!raw) return { persisted: false, height, txCount: 0 };

  const txs = raw.transactions ?? [];
  const db = getDb();
  if (!db) {
    // Dry mode: we successfully READ the block but have nowhere to persist it.
    return { persisted: false, height, hash: raw.hash, txCount: txs.length };
  }

  // Finality context from current DAG stats.
  let finalized = false;
  try {
    const stats = await getDagStats(harnessClient());
    finalized = isFinalized(
      hexToNum(raw.blueScore),
      stats.maxBlueScore,
      stats.ghostdagParams.finalityDepth,
    );
  } catch {
    // DAG stats unavailable — leave finalized=false (don't fabricate).
  }

  const selectedParent = raw.selectedParentHash ?? raw.parentHash;

  await db
    .insert(blocks)
    .values({
      hash: raw.hash,
      height: hexToNum(raw.number),
      blueScore: hexToNum(raw.blueScore),
      blueWork: hexToBig(raw.blueWork),
      finalized,
      timestamp: hexToNum(raw.timestamp),
      selectedParent,
      proposer: raw.proposer ?? raw.miner ?? null,
      gasUsed: hexToNum(raw.gasUsed),
      gasLimit: hexToNum(raw.gasLimit),
      baseFeePerGas: raw.baseFeePerGas ? hexToBig(raw.baseFeePerGas) : null,
      txCount: txs.length,
      stateRoot: raw.stateRoot ?? null,
      txRoot: raw.transactionsRoot ?? null,
      receiptRoot: raw.receiptsRoot ?? null,
    })
    .onConflictDoNothing();

  // DAG edges: selected parent + merge parents.
  const edges = [
    { child: raw.hash, parent: selectedParent, selected: true },
    ...(raw.mergeParentHashes ?? [])
      .filter((p) => p !== selectedParent)
      .map((p) => ({ child: raw.hash, parent: p, selected: false })),
  ];
  if (edges.length) await db.insert(dagEdges).values(edges).onConflictDoNothing();

  if (txs.length) {
    await db
      .insert(transactions)
      .values(
        txs.map((t) => ({
          hash: t.hash,
          blockHash: raw.hash,
          blockHeight: hexToNum(raw.number),
          txIndex: t.transactionIndex ? hexToNum(t.transactionIndex) : null,
          from: t.from.toLowerCase(),
          to: t.to ? t.to.toLowerCase() : null,
          value: hexToBig(t.value),
          nonce: hexToNum(t.nonce),
          gasLimit: t.gas ? hexToNum(t.gas) : null,
          gasPrice: t.gasPrice ? hexToBig(t.gasPrice) : null,
          methodId: t.input && t.input.length >= 10 ? t.input.slice(0, 10) : null,
          ethTxType: t.type ? hexToNum(t.type) : null,
          timestamp: hexToNum(raw.timestamp),
        })),
      )
      .onConflictDoNothing();
  }

  return { persisted: true, height, hash: raw.hash, txCount: txs.length, finalized };
}

/** Current chain head height. */
export async function headHeight(): Promise<number> {
  return Number(await harnessClient().getBlockNumber());
}
