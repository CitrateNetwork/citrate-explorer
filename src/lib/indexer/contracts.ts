/**
 * Contract-creation indexing. Turns a block's transactions + receipts into rows
 * of the `contracts` table so deployments are findable by address and name.
 *
 * Two creation paths are recognised:
 *  - CREATE: a top-level deployment tx; the receipt carries `contractAddress`.
 *  - CREATE2 via the Arachnid deterministic-deployment proxy
 *    (0x4e59b44847b379578588920ca78fbf26c0b4956c). Most Citrate contracts are
 *    deployed this way (forge scripts with a salt). The tx is a plain CALL to the
 *    factory, so the receipt has NO `contractAddress`. The factory's calldata is
 *    `salt (32 bytes) ++ initcode`, and the deployed address is
 *    keccak256(0xff ++ factory ++ salt ++ keccak256(initcode))[12:] (EIP-1014).
 *    A derived address is recorded only after eth_getCode confirms it has code
 *    (a reverted or out-of-gas factory call leaves nothing there).
 *
 * `creator` is the tx sender (the EOA that paid for the deployment), for both
 * paths. For CREATE2 the EVM-level creator is the factory; the sender is what
 * an operator searches by, and the factory is implied by the tx's `to`.
 *
 * Every function here is total: bad input yields "no candidate", never a throw.
 * The ingest hot path wraps the whole step in try/catch as well, so a contract
 * indexing failure can never fail block ingestion.
 *
 * Data source (Rule 11): block txs + receipts from live RPC; eth_getCode for the
 * runtime bytecode; written to the `contracts` table.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { concat, keccak256, type Address, type Hex } from "viem";
import type { Database } from "@/lib/db/client";
import { contracts, transactions } from "@/lib/db/schema";

/** Arachnid deterministic-deployment proxy (same address on every EVM chain). */
export const ARACHNID_FACTORY = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * EIP-1014 CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:].
 * Returns the lowercase address (the index stores addresses lowercased).
 */
export function create2Address(deployer: Hex, salt: Hex, initCode: Hex): Address {
  const digest = keccak256(concat(["0xff", deployer, salt, keccak256(initCode)]));
  return `0x${digest.slice(-40)}`.toLowerCase() as Address;
}

/**
 * Splits Arachnid factory calldata into salt + initcode. Returns null when the
 * input is not hex or carries no initcode (the factory would deploy nothing).
 */
export function parseArachnidInput(input: string | null | undefined): { salt: Hex; initCode: Hex } | null {
  if (typeof input !== "string" || !HEX_RE.test(input)) return null;
  // 2 ("0x") + 64 (salt) + at least one initcode byte.
  if (input.length < 2 + 64 + 2) return null;
  return {
    salt: `0x${input.slice(2, 66)}` as Hex,
    initCode: `0x${input.slice(66)}` as Hex,
  };
}

/** The address an Arachnid-factory tx deploys to, or null if the input is not a deployment. */
export function arachnidDeployAddress(input: string | null | undefined): Address | null {
  const parsed = parseArachnidInput(input);
  if (!parsed) return null;
  return create2Address(ARACHNID_FACTORY, parsed.salt, parsed.initCode);
}

/** The slice of a block transaction this module needs. */
export interface CreationTx {
  hash: string;
  from: string;
  to?: string | null;
  input?: string | null;
}

/** The slice of a receipt this module needs. status: 1 success, 0 reverted. */
export interface CreationReceipt {
  status: number | null;
  contractAddress: string | null;
}

export type CreationKind = "CREATE" | "CREATE2";

/** A contract that may have been created by a transaction; not yet confirmed on-chain. */
export interface ContractCandidate {
  address: string;
  creator: string;
  creationTx: string;
  kind: CreationKind;
}

/** A confirmed `contracts` row (the columns the indexer owns). */
export interface ContractRow {
  address: string;
  name: string | null;
  creator: string | null;
  creationTx: string | null;
  bytecodeHash: string | null;
}

/**
 * Pure: finds the contract-creation candidates in a block. A reverted receipt
 * (status 0) never yields a candidate. A CREATE2 candidate does not need a
 * receipt (the code check gates it), but a known-reverted one is dropped.
 * The result is deduplicated by address; the first creation wins.
 */
export function contractCandidates(
  txs: readonly CreationTx[],
  receipts: ReadonlyMap<string, CreationReceipt>,
): ContractCandidate[] {
  const out = new Map<string, ContractCandidate>();
  for (const tx of txs) {
    if (!tx || typeof tx.hash !== "string" || typeof tx.from !== "string") continue;
    const receipt = receipts.get(tx.hash.toLowerCase()) ?? receipts.get(tx.hash);
    if (receipt && receipt.status === 0) continue;
    const creator = tx.from.toLowerCase();
    const creationTx = tx.hash.toLowerCase();

    const created = receipt?.contractAddress;
    if (typeof created === "string" && ADDRESS_RE.test(created)) {
      const address = created.toLowerCase();
      if (!out.has(address)) out.set(address, { address, creator, creationTx, kind: "CREATE" });
      continue;
    }

    if (typeof tx.to === "string" && tx.to.toLowerCase() === ARACHNID_FACTORY) {
      const address = arachnidDeployAddress(tx.input);
      if (address && !out.has(address)) out.set(address, { address, creator, creationTx, kind: "CREATE2" });
    }
  }
  return [...out.values()];
}

/** Dependencies for {@link resolveCandidates}; injected so tests need no RPC. */
export interface ResolveDeps {
  /** eth_getCode for an address. Called at most once per candidate. */
  getCode: (address: Address) => Promise<Hex | undefined>;
  /** Book name for an address, if any (see contractLabels.ts). */
  nameFor?: (address: string) => string | null;
  /** Max concurrent getCode calls (default 4). */
  concurrency?: number;
  /** Diagnostics sink (default: silent). */
  warn?: (msg: string) => void;
}

const hasCode = (code: Hex | undefined): code is Hex =>
  typeof code === "string" && code.length > 2 && code !== "0x";

/**
 * Confirms candidates against on-chain code and builds `contracts` rows.
 *  - code present: recorded with bytecode_hash = keccak256(runtime code).
 *  - code confirmed empty: dropped (nothing was deployed, or it is gone).
 *  - getCode failed: a CREATE candidate is still recorded (its receipt is
 *    authoritative) with bytecode_hash null, for the backfill to fill later.
 *    A CREATE2 candidate is dropped: its address is derived, not observed, so
 *    it is never recorded unconfirmed.
 */
export async function resolveCandidates(
  candidates: readonly ContractCandidate[],
  deps: ResolveDeps,
): Promise<ContractRow[]> {
  const rows: (ContractRow | null)[] = new Array(candidates.length).fill(null);
  const limit = Math.max(1, Math.min(16, deps.concurrency ?? 4));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      let code: Hex | undefined;
      let failed = false;
      try {
        code = await deps.getCode(c.address as Address);
      } catch (err) {
        failed = true;
        deps.warn?.(`getCode ${c.address} (${c.kind} ${c.creationTx}) failed: ${(err as Error).message}`);
      }
      if (!failed && !hasCode(code)) continue;
      if (failed && c.kind === "CREATE2") continue;
      rows[i] = {
        address: c.address,
        name: deps.nameFor?.(c.address) ?? null,
        creator: c.creator,
        creationTx: c.creationTx,
        bytecodeHash: hasCode(code) ? keccak256(code) : null,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, candidates.length) }, worker));
  return rows.filter((r): r is ContractRow => r !== null);
}

/**
 * The upsert for indexer-owned columns: insert new rows; on an existing address
 * fill only the columns that are still null (never overwrite a value, and never
 * touch verified / compiler_version / proxy_impl, which the verify flow owns).
 * Built separately from the write so the SQL is unit-testable.
 */
export function contractsUpsert(db: Database, rows: readonly ContractRow[]) {
  return db
    .insert(contracts)
    .values(
      rows.map((r) => ({
        address: r.address.toLowerCase(),
        name: r.name,
        creator: r.creator,
        creationTx: r.creationTx,
        bytecodeHash: r.bytecodeHash,
      })),
    )
    .onConflictDoUpdate({
      target: contracts.address,
      set: {
        name: sql`coalesce(${contracts.name}, excluded.name)`,
        creator: sql`coalesce(${contracts.creator}, excluded.creator)`,
        creationTx: sql`coalesce(${contracts.creationTx}, excluded.creation_tx)`,
        bytecodeHash: sql`coalesce(${contracts.bytecodeHash}, excluded.bytecode_hash)`,
      },
    });
}

/**
 * Persists rows: one batched upsert into `contracts`, then links each creating
 * tx to its contract (`transactions.created_contract`, only where still null).
 * Returns the number of rows written.
 */
export async function upsertContracts(db: Database, rows: readonly ContractRow[]): Promise<number> {
  if (!rows.length) return 0;
  await contractsUpsert(db, rows);
  for (const r of rows) {
    if (!r.creationTx) continue;
    await db
      .update(transactions)
      .set({ createdContract: r.address.toLowerCase() })
      .where(and(eq(transactions.hash, r.creationTx), isNull(transactions.createdContract)));
  }
  return rows.length;
}
