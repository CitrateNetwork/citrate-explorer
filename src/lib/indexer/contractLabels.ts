/**
 * Contract name labels from the canonical 40204 address book.
 *
 * Source: the vendored copies of citrate-chain `contracts/addresses/40204.json`
 * and `40204.provenance.json` in src/generated/ (refresh with
 * `CITRATE_CHAIN_DIR=… pnpm sync-addresses`). The explorer never reads a sibling
 * checkout at runtime.
 *
 * Labelled sections: `contracts`, `aaStack`, `genesis`, `governance`
 * (GOVERNANCE / GUARDIAN) and the top-level single-contract keys
 * (`CitrateMemberSBT`, `MembershipStakeVault`). `precompiles` are NOT labelled
 * here: they are native precompile slots, not deployed contracts, and have no
 * creation tx. `deployer` is an EOA and is skipped.
 *
 * Name precedence when seeding `contracts.name`:
 *  - book name wins over null and over an unverified name (a re-roll re-labels);
 *  - a VERIFIED row whose name differs keeps its verified name, and the
 *    disagreement is reported (logged), never silently overwritten.
 */
import { inArray, sql } from "drizzle-orm";
import book from "@/generated/addresses.json";
import provenance from "@/generated/addresses.provenance.json";
import type { Database } from "@/lib/db/client";
import { contracts } from "@/lib/db/schema";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Top-level keys of the book that are metadata or EOAs, not contracts. */
const NON_CONTRACT_KEYS = new Set(["deployer"]);
const SECTION_KEYS = ["contracts", "aaStack", "genesis", "governance"] as const;

export interface BookLabel {
  /** Lowercase address. */
  address: string;
  name: string;
  /** Book section the name came from ("contracts", "aaStack", …, or "top-level"). */
  section: string;
  /** Deployer tx from the provenance ledger, when the address is in it. */
  creationTx: string | null;
  /** The tx sender (book deployer) for ledger entries, else null. */
  creator: string | null;
  kind: "CREATE" | "CREATE2" | null;
}

interface LedgerEntry {
  tx?: string;
  kind?: string;
  address?: string;
  status?: string;
}

type Json = Record<string, unknown>;

/**
 * Pure: derives the label list from a book + provenance pair. Exposed with
 * explicit arguments so tests can feed fixtures; {@link bookLabels} binds the
 * vendored copies. Throws if one address carries two different names, since
 * that would make a label ambiguous (the canonical book guarantees it does not).
 */
export function deriveBookLabels(bookJson: Json, provenanceJson: Json): BookLabel[] {
  const deployer =
    typeof provenanceJson.deployer === "string" && ADDRESS_RE.test(provenanceJson.deployer)
      ? provenanceJson.deployer.toLowerCase()
      : null;
  const ledger = new Map<string, LedgerEntry>();
  const entries = Array.isArray(provenanceJson.ledger) ? (provenanceJson.ledger as LedgerEntry[]) : [];
  for (const e of entries) {
    if (e?.status !== "canonical") continue;
    if (e.kind !== "CREATE" && e.kind !== "CREATE2") continue;
    if (typeof e.address !== "string" || !ADDRESS_RE.test(e.address)) continue;
    ledger.set(e.address.toLowerCase(), e);
  }

  const out = new Map<string, BookLabel>();
  const add = (name: string, value: unknown, section: string) => {
    if (typeof value !== "string" || !ADDRESS_RE.test(value)) return;
    const address = value.toLowerCase();
    const prior = out.get(address);
    if (prior) {
      if (prior.name !== name) {
        throw new Error(`address book names ${address} twice: ${prior.name} and ${name}`);
      }
      return;
    }
    const e = ledger.get(address);
    out.set(address, {
      address,
      name,
      section,
      creationTx: e?.tx ? e.tx.toLowerCase() : null,
      creator: e ? deployer : null,
      kind: e ? (e.kind as "CREATE" | "CREATE2") : null,
    });
  };

  for (const section of SECTION_KEYS) {
    const map = bookJson[section];
    if (!map || typeof map !== "object") continue;
    for (const [name, value] of Object.entries(map as Json)) add(name, value, section);
  }
  for (const [name, value] of Object.entries(bookJson)) {
    if (NON_CONTRACT_KEYS.has(name)) continue;
    if (typeof value === "string") add(name, value, "top-level");
  }
  return [...out.values()];
}

let cached: BookLabel[] | null = null;
let byAddress: Map<string, BookLabel> | null = null;

/** Labels from the vendored canonical book (memoized). */
export function bookLabels(): BookLabel[] {
  if (!cached) cached = deriveBookLabels(book as Json, provenance as Json);
  return cached;
}

/** Book name for an address (any case), or null. */
export function bookNameFor(address: string): string | null {
  if (!byAddress) byAddress = new Map(bookLabels().map((l) => [l.address, l]));
  return byAddress.get(address.toLowerCase())?.name ?? null;
}

export interface ExistingContractName {
  address: string;
  name: string | null;
  verified: boolean;
}

export interface LabelConflict {
  address: string;
  bookName: string;
  verifiedName: string;
}

export interface LabelPlan {
  /** Rows whose name will be set (new, null, or unverified-different). */
  rename: BookLabel[];
  /** Verified rows whose name differs from the book: kept, reported. */
  conflicts: LabelConflict[];
  /** Rows already carrying the book name. */
  unchanged: BookLabel[];
}

/** Pure: decides what seeding will do to each label given the current rows. */
export function planLabelUpserts(
  labels: readonly BookLabel[],
  existing: readonly ExistingContractName[],
): LabelPlan {
  const current = new Map(existing.map((e) => [e.address.toLowerCase(), e]));
  const plan: LabelPlan = { rename: [], conflicts: [], unchanged: [] };
  for (const l of labels) {
    const row = current.get(l.address);
    if (row && row.name === l.name) plan.unchanged.push(l);
    else if (row && row.verified && row.name) {
      plan.conflicts.push({ address: l.address, bookName: l.name, verifiedName: row.name });
    } else plan.rename.push(l);
  }
  return plan;
}

/**
 * The idempotent label upsert. Name: the book wins unless the row is verified
 * and already named (enforced in SQL too, so a verification landing between
 * the plan and the write is still respected). creation_tx / creator: filled
 * only where null.
 */
export function labelsUpsert(db: Database, labels: readonly BookLabel[]) {
  return db
    .insert(contracts)
    .values(
      labels.map((l) => ({
        address: l.address,
        name: l.name,
        creationTx: l.creationTx,
        creator: l.creator,
      })),
    )
    .onConflictDoUpdate({
      target: contracts.address,
      set: {
        name: sql`case when ${contracts.verified} and ${contracts.name} is not null then ${contracts.name} else excluded.name end`,
        creationTx: sql`coalesce(${contracts.creationTx}, excluded.creation_tx)`,
        creator: sql`coalesce(${contracts.creator}, excluded.creator)`,
      },
    });
}

export interface SeedResult {
  total: number;
  renamed: number;
  unchanged: number;
  conflicts: LabelConflict[];
  dryRun: boolean;
}

/**
 * Seeds / refreshes `contracts.name` (and creation_tx / creator from the
 * provenance ledger) for every book address. One read + one batched write.
 * With dryRun, reads and plans but writes nothing.
 */
export async function seedBookLabels(
  db: Database,
  opts: { labels?: readonly BookLabel[]; dryRun?: boolean; warn?: (msg: string) => void } = {},
): Promise<SeedResult> {
  const labels = opts.labels ?? bookLabels();
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (!labels.length) return { total: 0, renamed: 0, unchanged: 0, conflicts: [], dryRun: !!opts.dryRun };
  const existing = await db
    .select({ address: contracts.address, name: contracts.name, verified: contracts.verified })
    .from(contracts)
    .where(inArray(contracts.address, labels.map((l) => l.address)));
  const plan = planLabelUpserts(labels, existing);
  for (const c of plan.conflicts) {
    warn(
      `[contract-labels] ${c.address}: verified name "${c.verifiedName}" differs from address-book name "${c.bookName}"; keeping the verified name`,
    );
  }
  if (!opts.dryRun) await labelsUpsert(db, labels);
  return {
    total: labels.length,
    renamed: plan.rename.length,
    unchanged: plan.unchanged.length,
    conflicts: plan.conflicts,
    dryRun: !!opts.dryRun,
  };
}
