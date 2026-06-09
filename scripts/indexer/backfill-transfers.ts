/**
 * Backfill token_transfers from already-indexed logs (RA-3 WP-3.4).
 *
 * Decodes the `logs` table (no RPC needed — logs are already persisted) into
 * `token_transfers`, joining `transactions` for block_hash + timestamp, and lazily
 * populates `tokens` metadata. Idempotent: re-runnable (onConflictDoNothing on the
 * unique (tx, log, id) index). Use after deploying the RA-3 ingest changes, or any
 * time to reconcile history.
 *
 *   DATABASE_URL="postgres://…neon…" npx tsx scripts/indexer/backfill-transfers.ts
 */
import { sql } from "drizzle-orm";
import { type Address } from "viem";
import { getDb } from "@/lib/db/client";
import { tokenTransfers, tokens, logs as logsTable, transactions } from "@/lib/db/schema";
import { decodeTransferLog, isTransferLog, type RawLog } from "@/lib/indexer/transferDecode";
import { getToken } from "@/lib/harness/ops";

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const db = getDb();
  if (!db) throw new Error("set DATABASE_URL");

  // Pull logs + their tx's block provenance.
  const rows = await db
    .select({
      txHash: logsTable.txHash,
      logIndex: logsTable.logIndex,
      address: logsTable.address,
      topic0: logsTable.topic0,
      topic1: logsTable.topic1,
      topic2: logsTable.topic2,
      topic3: logsTable.topic3,
      data: logsTable.data,
      blockHash: transactions.blockHash,
      blockHeight: transactions.blockHeight,
      timestamp: transactions.timestamp,
    })
    .from(logsTable)
    .leftJoin(transactions, sql`${logsTable.txHash} = ${transactions.hash}`);

  log(`scanning ${rows.length} log(s)…`);

  let inserted = 0;
  const seenTokens = new Map<string, string>();
  for (const r of rows) {
    const raw: RawLog = {
      address: r.address,
      topics: [r.topic0, r.topic1, r.topic2, r.topic3].filter((t): t is string => !!t),
      data: r.data ?? "0x",
      logIndex: r.logIndex ?? 0,
    };
    if (!isTransferLog(raw)) continue;
    for (const tr of decodeTransferLog(raw)) {
      await db
        .insert(tokenTransfers)
        .values({
          txHash: r.txHash,
          blockHash: r.blockHash ?? null,
          blockHeight: r.blockHeight ?? null,
          timestamp: r.timestamp ?? null,
          token: tr.token,
          standard: tr.standard,
          from: tr.from,
          to: tr.to,
          value: tr.value ?? null,
          tokenId: tr.tokenId ?? null,
          logIndex: tr.logIndex ?? 0,
        })
        .onConflictDoNothing();
      inserted += 1;
      if (!seenTokens.has(tr.token)) seenTokens.set(tr.token, tr.standard);
    }
  }

  // Populate metadata for newly-seen tokens.
  for (const [address, standard] of seenTokens) {
    const exists = await db.select({ a: tokens.address }).from(tokens).where(sql`${tokens.address} = ${address}`).limit(1);
    if (exists.length) continue;
    let name = null, symbol = null, decimals: number | null = null, totalSupply: string | null = null;
    try {
      const m = await getToken(address as Address);
      name = m.name ?? null; symbol = m.symbol ?? null; decimals = m.decimals ?? null; totalSupply = m.totalSupplyRaw ?? null;
    } catch { /* non-conforming token — store standard only */ }
    await db.insert(tokens).values({ address, type: standard, name, symbol, decimals, totalSupply }).onConflictDoNothing();
  }

  log(`backfill complete: ${inserted} token_transfer row(s) across ${seenTokens.size} token(s).`);
  if (inserted === 0) log("(no ERC-20/721/1155 Transfer events in the indexed logs yet — token_transfers stays empty, correctly.)");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
