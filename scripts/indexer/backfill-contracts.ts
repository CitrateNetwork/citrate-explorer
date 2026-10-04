/**
 * Backfill the `contracts` table from the already-indexed chain, and label it
 * from the canonical 40204 address book.
 *
 * The indexer only started writing `contracts` with the contract-index change;
 * every block ingested before that left the table empty. This walks the
 * indexed `transactions` + `receipts` and records the same creations the
 * indexer now records (src/lib/indexer/contracts.ts):
 *   - CREATE:  receipts.contract_address (successful txs only);
 *   - CREATE2: txs sent to the Arachnid factory 0x4e59…956c. `transactions`
 *     does not store calldata, so each factory tx's input is fetched with
 *     eth_getTransactionByHash, the address derived, and confirmed by eth_getCode.
 *
 * Phases (each idempotent; re-running converges):
 *   1. labels: seed/refresh contracts.name (+ creation_tx/creator from the
 *      provenance ledger) for every book address. Skip with --skip-labels.
 *   2. scan:   keyset-paged walk of indexed creation txs from the cursor.
 *   3. code:   fill bytecode_hash for any contracts row still missing it
 *      (e.g. book rows whose block predates the index). Skip with --skip-code.
 *
 * Read-mostly: the DB is only read in --dry-run; RPC is read-only and
 * rate-limited (BACKFILL_RPC_RPS, default 5 req/s). Resumable: the last fully
 * processed (block_height, tx hash) is written to the cursor file after every
 * page, and rows that are already complete are skipped without any RPC.
 *
 *   DATABASE_URL=… DATABASE_CA_CERT="$(cat ca.pem)" \
 *     npx tsx scripts/indexer/backfill-contracts.ts [--dry-run] [--from-height N]
 *     [--to-height N] [--page-size 500] [--cursor-file .backfill-contracts.cursor]
 *     [--reset-cursor] [--skip-labels] [--skip-code]
 *
 * Optional env: NEXT_PUBLIC_CITRATE_RPC_URL (default https://rpc.citrate.ai),
 * CITRATE_RPC_FALLBACK, BACKFILL_RPC_RPS.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { and, eq, isNotNull, isNull, or, sql, inArray } from "drizzle-orm";
import { keccak256, type Address, type Hash, type Hex } from "viem";
import { getDb, type Database } from "@/lib/db/client";
import { contracts, receipts, transactions } from "@/lib/db/schema";
import { harnessClient } from "@/lib/harness/client";
import {
  ARACHNID_FACTORY,
  arachnidDeployAddress,
  resolveCandidates,
  upsertContracts,
  type ContractCandidate,
} from "@/lib/indexer/contracts";
import { bookNameFor, seedBookLabels } from "@/lib/indexer/contractLabels";

interface Args {
  dryRun: boolean;
  fromHeight: number | null;
  toHeight: number | null;
  pageSize: number;
  cursorFile: string;
  resetCursor: boolean;
  skipLabels: boolean;
  skipCode: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dryRun: false,
    fromHeight: null,
    toHeight: null,
    pageSize: 500,
    cursorFile: ".backfill-contracts.cursor",
    resetCursor: false,
    skipLabels: false,
    skipCode: false,
  };
  const int = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a non-negative integer`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--dry-run") a.dryRun = true;
    else if (f === "--from-height") a.fromHeight = int(f, argv[++i]);
    else if (f === "--to-height") a.toHeight = int(f, argv[++i]);
    else if (f === "--page-size") a.pageSize = Math.min(5000, Math.max(1, int(f, argv[++i])));
    else if (f === "--cursor-file") a.cursorFile = argv[++i] ?? a.cursorFile;
    else if (f === "--reset-cursor") a.resetCursor = true;
    else if (f === "--skip-labels") a.skipLabels = true;
    else if (f === "--skip-code") a.skipCode = true;
    else throw new Error(`unknown flag ${f}`);
  }
  return a;
}

/** Spaces RPC calls to at most `rps` per second (sequential callers). */
function rateLimiter(rps: number) {
  const gap = 1000 / Math.max(0.1, rps);
  let nextAt = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const wait = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + gap;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return fn();
  };
}

interface Cursor {
  height: number;
  hash: string;
}

function readCursor(file: string): Cursor | null {
  if (!existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(c.height) && typeof c.hash === "string" ? c : null;
  } catch {
    return null;
  }
}

const log = (...a: unknown[]) => console.log("[backfill-contracts]", ...a);

/** Addresses / creation txs that already have every indexer-owned column filled. */
async function completeSets(db: Database, addrs: string[], txs: string[]) {
  const done = new Set<string>();
  const doneTx = new Set<string>();
  if (!addrs.length && !txs.length) return { done, doneTx };
  const rows = await db
    .select({ address: contracts.address, creationTx: contracts.creationTx })
    .from(contracts)
    .where(
      and(
        isNotNull(contracts.bytecodeHash),
        isNotNull(contracts.creationTx),
        or(
          addrs.length ? inArray(contracts.address, addrs) : sql`false`,
          txs.length ? inArray(contracts.creationTx, txs) : sql`false`,
        ),
      ),
    );
  for (const r of rows) {
    done.add(r.address);
    if (r.creationTx) doneTx.add(r.creationTx);
  }
  return { done, doneTx };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  if (!db) throw new Error("set DATABASE_URL (and DATABASE_CA_CERT for a TLS cluster)");
  const client = harnessClient();
  const limited = rateLimiter(Number(process.env.BACKFILL_RPC_RPS ?? 5));
  const getCode = (address: Address) => limited(() => client.getCode({ address }));
  const warn = (m: string) => console.warn("[backfill-contracts]", m);
  const mode = args.dryRun ? "DRY RUN (no writes)" : "write";
  log(`mode=${mode} page=${args.pageSize} rps=${process.env.BACKFILL_RPC_RPS ?? 5}`);

  // 1. Labels from the address book.
  if (!args.skipLabels) {
    const r = await seedBookLabels(db, { dryRun: args.dryRun, warn });
    log(
      `labels: ${r.total} book address(es); ${r.renamed} to (re)label, ${r.unchanged} unchanged, ` +
        `${r.conflicts.length} verified-name conflict(s) kept`,
    );
  }

  // 2. Scan indexed creation txs.
  if (args.resetCursor && existsSync(args.cursorFile)) rmSync(args.cursorFile);
  let cursor: Cursor | null =
    args.fromHeight !== null ? { height: args.fromHeight, hash: "" } : readCursor(args.cursorFile);
  if (cursor) log(`resuming after height=${cursor.height} hash=${cursor.hash || "(start of height)"}`);

  let scanned = 0;
  let written = 0;
  let skipped = 0;
  for (;;) {
    const after = cursor
      ? sql`(${transactions.blockHeight}, ${transactions.hash}) > (${cursor.height}, ${cursor.hash})`
      : undefined;
    const rows = await db
      .select({
        hash: transactions.hash,
        from: transactions.from,
        to: transactions.to,
        blockHeight: transactions.blockHeight,
        status: receipts.status,
        contractAddress: receipts.contractAddress,
      })
      .from(transactions)
      .leftJoin(receipts, eq(receipts.txHash, transactions.hash))
      .where(
        and(
          isNotNull(transactions.blockHeight),
          after,
          args.toHeight !== null ? sql`${transactions.blockHeight} <= ${args.toHeight}` : undefined,
          or(eq(transactions.to, ARACHNID_FACTORY), isNotNull(receipts.contractAddress)),
        ),
      )
      .orderBy(transactions.blockHeight, transactions.hash)
      .limit(args.pageSize);
    if (!rows.length) break;
    scanned += rows.length;

    // Skip anything already complete (no RPC on a re-run).
    const createAddrs = rows
      .filter((r) => r.contractAddress && r.status !== 0)
      .map((r) => (r.contractAddress as string).toLowerCase());
    const factoryTxs = rows.filter((r) => r.to === ARACHNID_FACTORY && r.status !== 0).map((r) => r.hash.toLowerCase());
    const { done, doneTx } = await completeSets(db, createAddrs, factoryTxs);

    const candidates: ContractCandidate[] = [];
    for (const r of rows) {
      if (r.status === 0) continue; // reverted: nothing was created
      const creator = r.from.toLowerCase();
      const creationTx = r.hash.toLowerCase();
      if (r.contractAddress) {
        const address = r.contractAddress.toLowerCase();
        if (done.has(address)) skipped++;
        else candidates.push({ address, creator, creationTx, kind: "CREATE" });
        continue;
      }
      if (doneTx.has(creationTx)) {
        skipped++;
        continue;
      }
      try {
        const tx = await limited(() => client.getTransaction({ hash: r.hash as Hash }));
        const address = arachnidDeployAddress(tx.input);
        if (address) candidates.push({ address, creator, creationTx, kind: "CREATE2" });
      } catch (err) {
        warn(`getTransaction ${r.hash} failed: ${(err as Error).message} (re-run to retry)`);
      }
    }

    // resolveCandidates calls getCode once per candidate; concurrency 1 keeps
    // the limiter's spacing exact.
    const resolved = await resolveCandidates(candidates, { getCode, nameFor: bookNameFor, concurrency: 1, warn });
    if (!args.dryRun) written += await upsertContracts(db, resolved);
    else {
      written += resolved.length;
      for (const c of resolved) log(`would record ${c.address} ${c.name ?? ""} tx=${c.creationTx}`);
    }

    const last = rows[rows.length - 1];
    cursor = { height: last.blockHeight as number, hash: last.hash };
    if (!args.dryRun) writeFileSync(args.cursorFile, JSON.stringify(cursor) + "\n");
    log(`page done through height ${cursor.height}: scanned=${scanned} recorded=${written} skipped=${skipped}`);
    if (rows.length < args.pageSize) break;
  }

  // 3. Fill bytecode_hash where still missing (book rows, getCode failures).
  if (!args.skipCode) {
    const missing = await db
      .select({ address: contracts.address })
      .from(contracts)
      .where(isNull(contracts.bytecodeHash));
    let filled = 0;
    for (const { address } of missing) {
      let code: Hex | undefined;
      try {
        code = await getCode(address as Address);
      } catch (err) {
        warn(`getCode ${address} failed: ${(err as Error).message}`);
        continue;
      }
      if (!code || code === "0x") {
        warn(`${address} has no code on-chain; bytecode_hash left null`);
        continue;
      }
      filled++;
      if (!args.dryRun) {
        await db
          .update(contracts)
          .set({ bytecodeHash: keccak256(code) })
          .where(and(eq(contracts.address, address), isNull(contracts.bytecodeHash)));
      }
    }
    log(`code: ${missing.length} row(s) missing bytecode_hash; ${filled} filled${args.dryRun ? " (dry run)" : ""}`);
  }

  log(`done: scanned=${scanned} recorded=${written} skipped(complete)=${skipped} mode=${mode}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[backfill-contracts] fatal:", e);
    process.exit(1);
  },
);
