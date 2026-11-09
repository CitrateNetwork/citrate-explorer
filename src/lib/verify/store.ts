/**
 * Verification store v2 (EXP-S2): the job queue and the append-only verified
 * records. Every function takes the database, so the web routes (getDb()), the
 * worker and the PGlite tests run the same SQL.
 *
 * Data sources (Rule 7): the `verification_jobs`, `verified_contracts`,
 * `contract_proxies` and `verification_state` tables; the indexer's
 * `transactions` / `receipts` tables for contract creations.
 */
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  contractProxies,
  receipts,
  transactions,
  verificationJobs,
  verificationState,
  verifiedContracts,
} from "@/lib/db/schema";
import type { ChainDb } from "@/lib/indexer/types";

export type JobRow = typeof verificationJobs.$inferSelect;
export type VerifiedRow = typeof verifiedContracts.$inferSelect;
export type NewVerifiedRow = Omit<typeof verifiedContracts.$inferInsert, "id" | "createdAt">;
export type ProxyRow = typeof contractProxies.$inferSelect;

/**
 * A record copied forward from the v1 store (migration 0006). The old store recorded neither
 * the chain nor the code a match was made against, so the record is not confirmed for the
 * code at the address now. The machine-readable APIs treat it as not verified; the contract
 * page shows its source, labelled.
 */
export function isLegacyRecord(row: Pick<VerifiedRow, "sourceFormat" | "legacyGuid" | "genesisHash">): boolean {
  return row.sourceFormat === "legacy" || (row.legacyGuid !== null && row.genesisHash === null);
}

/** A v1 guid that passed under the old store: carried forward, never re-checked. */
export function isLegacyPassJob(job: Pick<JobRow, "origin" | "resultCode">): boolean {
  return job.origin === "legacy" && job.resultCode === "legacy_pass";
}

export const LEGACY_NOTE =
  "Legacy record from before verification v2, not confirmed for the current code; resubmit to verify";

/** Random, unguessable ids for jobs and records (a UUID works as both an Etherscan guid and a Sourcify verificationId). */
export const newId = (): string => randomUUID();

export interface NewJob {
  kind: "verify" | "proxy";
  origin: "etherscan" | "sourcify" | "api" | "legacy";
  chainId: number;
  genesisHash: string | null;
  address: string;
  request: unknown;
  sourceHash?: string | null;
}

export async function enqueueJob(db: ChainDb, job: NewJob): Promise<string> {
  const id = newId();
  await db.insert(verificationJobs).values({
    id,
    kind: job.kind,
    origin: job.origin,
    chainId: job.chainId,
    genesisHash: job.genesisHash,
    address: job.address.toLowerCase(),
    request: JSON.stringify(job.request),
    sourceHash: job.sourceHash ?? null,
  });
  return id;
}

export async function getJob(db: ChainDb, id: string): Promise<JobRow | null> {
  const [row] = await db.select().from(verificationJobs).where(eq(verificationJobs.id, id)).limit(1);
  return row ?? null;
}

export async function countOpenJobs(db: ChainDb): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationJobs)
    .where(inArray(verificationJobs.status, ["pending", "running"]));
  return Number(r?.n ?? 0);
}

/**
 * Claim the oldest runnable job: pending, or running with a lease older than
 * `leaseMs` (its worker died). FOR UPDATE SKIP LOCKED lets several workers share
 * the queue without double-claiming.
 */
export async function claimNextJob(db: ChainDb, workerId: string, leaseMs: number): Promise<JobRow | null> {
  const cutoff = new Date(Date.now() - leaseMs);
  const result = await db.execute(sql`
    update ${verificationJobs}
       set status = 'running', worker_id = ${workerId}, locked_at = now(),
           started_at = coalesce(started_at, now()), attempts = attempts + 1
     where id = (
       select id from ${verificationJobs}
        where status = 'pending' or (status = 'running' and locked_at < ${cutoff.toISOString()}::timestamptz)
        order by created_at asc
        limit 1
        for update skip locked)
    returning id`);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows ?? (result as unknown as Array<{ id: string }>);
  const id = rows?.[0]?.id;
  return id ? getJob(db, id) : null;
}

export interface JobResult {
  status: "pass" | "fail";
  code: string;
  message: string;
  matchType?: string | null;
  verifiedContractId?: string | null;
}

/** Record a job's outcome. Only the claiming worker's running job moves. */
export async function finishJob(db: ChainDb, id: string, workerId: string, r: JobResult): Promise<void> {
  await db
    .update(verificationJobs)
    .set({
      status: r.status,
      resultCode: r.code,
      resultMessage: r.message,
      matchType: r.matchType ?? null,
      verifiedContractId: r.verifiedContractId ?? null,
      finishedAt: new Date(),
      lockedAt: null,
    })
    .where(and(eq(verificationJobs.id, id), eq(verificationJobs.status, "running"), eq(verificationJobs.workerId, workerId)));
}

/** Hand a job back to the queue after a transient failure (the claiming worker only). */
export async function releaseJob(db: ChainDb, id: string, workerId: string): Promise<void> {
  await db
    .update(verificationJobs)
    .set({ status: "pending", lockedAt: null, workerId: null })
    .where(and(eq(verificationJobs.id, id), eq(verificationJobs.status, "running"), eq(verificationJobs.workerId, workerId)));
}

/** Append a verified record. There is no update path: the table rejects UPDATE and DELETE. */
export async function appendVerified(db: ChainDb, row: NewVerifiedRow): Promise<string> {
  const id = newId();
  await db.insert(verifiedContracts).values({ ...row, id, address: row.address.toLowerCase() });
  return id;
}

export async function getVerified(db: ChainDb, id: string): Promise<VerifiedRow | null> {
  const [row] = await db.select().from(verifiedContracts).where(eq(verifiedContracts.id, id)).limit(1);
  return row ?? null;
}

const MATCH_RANK = sql`case ${verifiedContracts.matchType} when 'full' then 0 when 'partial' then 1 else 2 end`;
const CREATION_RANK = sql`case ${verifiedContracts.creationMatch} when 'full' then 0 when 'partial' then 1 else 2 end`;

export interface MatchKey {
  genesisHash: string;
  address: string;
  /** keccak256 of the live runtime code; when given, only records for that code are returned. */
  runtimeCodeHash?: string | null;
}

/**
 * Every record for a contract, best first: full before partial before similar,
 * then creation full before partial before unchecked, then the earliest record
 * (a later identical submission never displaces the first).
 */
export async function listMatches(db: ChainDb, key: MatchKey): Promise<VerifiedRow[]> {
  const conds = [eq(verifiedContracts.genesisHash, key.genesisHash), eq(verifiedContracts.address, key.address.toLowerCase())];
  if (key.runtimeCodeHash) conds.push(eq(verifiedContracts.runtimeCodeHash, key.runtimeCodeHash.toLowerCase()));
  return db
    .select()
    .from(verifiedContracts)
    .where(and(...conds))
    .orderBy(MATCH_RANK, CREATION_RANK, asc(verifiedContracts.createdAt));
}

/**
 * The best record for a contract. Falls back to a legacy record (copied from the
 * pre-v2 store, no genesis or code hash) only when no v2 record exists.
 */
export async function bestMatch(db: ChainDb, key: MatchKey): Promise<VerifiedRow | null> {
  const [best] = await listMatches(db, key);
  if (best) return best;
  const [legacy] = await db
    .select()
    .from(verifiedContracts)
    .where(and(isNull(verifiedContracts.genesisHash), eq(verifiedContracts.address, key.address.toLowerCase())))
    .orderBy(MATCH_RANK, asc(verifiedContracts.createdAt))
    .limit(1);
  return legacy ?? null;
}

/** Original (non-similar) records of a given runtime length on this chain: similar-match candidates. */
export async function originalsByLength(db: ChainDb, genesisHash: string, length: number): Promise<VerifiedRow[]> {
  return db
    .select()
    .from(verifiedContracts)
    .where(
      and(
        eq(verifiedContracts.genesisHash, genesisHash),
        eq(verifiedContracts.runtimeCodeLength, length),
        ne(verifiedContracts.matchType, "similar"),
        isNotNull(verifiedContracts.runtimeMaskedHash),
      ),
    )
    .orderBy(MATCH_RANK, asc(verifiedContracts.createdAt))
    .limit(20);
}

/** Addresses on this chain that already have a v2 record. */
export async function verifiedAddresses(db: ChainDb, genesisHash: string, addresses: string[]): Promise<Set<string>> {
  if (!addresses.length) return new Set();
  const rows = await db
    .selectDistinct({ a: verifiedContracts.address })
    .from(verifiedContracts)
    .where(and(eq(verifiedContracts.genesisHash, genesisHash), inArray(verifiedContracts.address, addresses.map((a) => a.toLowerCase()))));
  return new Set(rows.map((r) => r.a));
}

export interface Creation {
  address: string;
  txHash: string;
  creator: string | null;
  blockHeight: number | null;
  timestamp: number | null;
}

/** The indexed creation transaction of a contract (EOA deploys; factory creations are not indexed yet). */
export async function findCreation(db: ChainDb, address: string): Promise<Creation | null> {
  const a = address.toLowerCase();
  const [tx] = await db
    .select({ hash: transactions.hash, from: transactions.from, h: transactions.blockHeight, ts: transactions.timestamp })
    .from(transactions)
    .where(sql`lower(${transactions.createdContract}) = ${a}`)
    .orderBy(asc(transactions.blockHeight))
    .limit(1);
  if (tx) return { address: a, txHash: tx.hash, creator: tx.from, blockHeight: tx.h, timestamp: tx.ts };
  const [r] = await db
    .select({ hash: receipts.txHash })
    .from(receipts)
    .where(sql`lower(${receipts.contractAddress}) = ${a}`)
    .limit(1);
  return r ? { address: a, txHash: r.hash, creator: null, blockHeight: null, timestamp: null } : null;
}

/** Indexed contract creations after `afterHeight`, oldest first. */
export async function listCreations(
  db: ChainDb,
  opts: { afterHeight?: number; limit: number; newestFirst?: boolean },
): Promise<Array<{ address: string; blockHeight: number }>> {
  const rows = await db
    .select({ a: transactions.createdContract, h: transactions.blockHeight })
    .from(transactions)
    .where(and(isNotNull(transactions.createdContract), gt(sql`coalesce(${transactions.blockHeight}, 0)`, opts.afterHeight ?? -1)))
    .orderBy(opts.newestFirst ? desc(transactions.blockHeight) : asc(transactions.blockHeight))
    .limit(opts.limit);
  return rows.filter((r) => r.a).map((r) => ({ address: (r.a as string).toLowerCase(), blockHeight: r.h ?? 0 }));
}

export async function appendProxy(
  db: ChainDb,
  row: Omit<typeof contractProxies.$inferInsert, "id" | "createdAt">,
): Promise<string> {
  const id = newId();
  await db.insert(contractProxies).values({ ...row, id, address: row.address.toLowerCase(), implementation: row.implementation.toLowerCase() });
  return id;
}

/** The newest proxy link for a contract (an upgrade appends a new row). */
export async function latestProxy(db: ChainDb, genesisHash: string, address: string): Promise<ProxyRow | null> {
  const [row] = await db
    .select()
    .from(contractProxies)
    .where(and(eq(contractProxies.genesisHash, genesisHash), eq(contractProxies.address, address.toLowerCase())))
    .orderBy(desc(contractProxies.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getState(db: ChainDb, key: string): Promise<string | null> {
  const [row] = await db.select().from(verificationState).where(eq(verificationState.key, key)).limit(1);
  return row?.value ?? null;
}

export async function setState(db: ChainDb, key: string, value: string): Promise<void> {
  await db
    .insert(verificationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: verificationState.key, set: { value, updatedAt: new Date() } });
}

/** Legacy passing records whose source was standard JSON, for re-verification against the current chain. */
export async function legacyRecords(db: ChainDb, limit: number): Promise<VerifiedRow[]> {
  return db
    .select()
    .from(verifiedContracts)
    .where(and(isNull(verifiedContracts.genesisHash), isNotNull(verifiedContracts.legacyGuid), isNotNull(verifiedContracts.legacySource)))
    .orderBy(asc(verifiedContracts.createdAt))
    .limit(limit);
}
