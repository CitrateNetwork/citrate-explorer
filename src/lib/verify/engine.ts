/**
 * Contract verification, read side (WS-2b, EXP-S2). The recompile-and-diff now
 * runs in the verify worker (./job.ts, `pnpm verify:worker`) with the compiler in
 * a capped child process; nothing here compiles. This module answers:
 *   - getVerificationByGuid: the status of one submission (any door);
 *   - getVerifiedContract: the best verified record for an address's current code,
 *     shaped for the contract page and the getVerifiedSource tool.
 *
 * Data sources (Rule 7): the verification_jobs / verified_contracts tables, and
 * the Citrate RPC for the genesis hash and live code hash (./read.ts).
 */
import { verifyDeps } from "./deps";
import { displaySource, resolveVerified } from "./read";
import { getJob, isLegacyPassJob, isLegacyRecord, LEGACY_NOTE } from "./store";
import type { VerifiedRow as SourceRow } from "./verifiedSource";

export interface VerificationRecord {
  guid: string;
  address: string;
  status: "pending" | "pass" | "fail";
  matchType: string | null;
  contractName: string | null;
  compilerVersion: string | null;
  message: string | null;
  verifiedAt: Date | null;
}

/** The poll record for a guid (job id), or null. */
export async function getVerificationByGuid(guid: string): Promise<VerificationRecord | null> {
  const { db } = verifyDeps();
  if (!db) return null;
  const job = await getJob(db, guid);
  if (!job) return null;
  const req = (() => {
    try {
      return JSON.parse(job.request) as { contractIdentifier?: string | null; compilerVersion?: string };
    } catch {
      return {};
    }
  })();
  if (isLegacyPassJob(job)) {
    // A v1 guid carried forward: not confirmed for the current code, so not a pass.
    return { guid: job.id, address: job.address, status: "fail", matchType: null, contractName: req.contractIdentifier ?? null, compilerVersion: req.compilerVersion ?? null, message: LEGACY_NOTE, verifiedAt: null };
  }
  return {
    guid: job.id,
    address: job.address,
    status: job.status === "pass" || job.status === "fail" ? job.status : "pending",
    matchType: job.matchType,
    contractName: req.contractIdentifier ?? null,
    compilerVersion: req.compilerVersion ?? null,
    message: job.resultMessage ?? (job.status === "pending" || job.status === "running" ? "Pending in queue" : null),
    verifiedAt: job.status === "pass" ? job.finishedAt : null,
  };
}

/** The best verified record for the code currently at `address`, or null. */
export async function getVerifiedContract(address: string): Promise<SourceRow | null> {
  const { db, chain } = verifyDeps();
  if (!db) return null;
  const r = await resolveVerified(db, chain, address);
  const row = r?.row;
  if (!row) return null;
  return {
    matchType: row.matchType,
    contractName: row.fullyQualifiedName ?? row.contractName,
    compilerVersion: row.solcLongVersion ? `v${row.solcLongVersion}` : row.compilerVersion,
    sourceHash: row.sourceHash,
    source: displaySource(row),
    abi: row.abi,
    verifiedAt: row.createdAt,
    legacy: isLegacyRecord(row),
  };
}
