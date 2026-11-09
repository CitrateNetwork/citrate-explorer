/**
 * Verification v2 record shapes, as TYPES ONLY (EXP-S3).
 *
 * Verification v2 (EXP-S2) stores one append-only `verified_contracts` row per
 * passing match, plus `contract_proxies` links (src/lib/db/schema.ts). This is the
 * shape of a record as JSON (camelCase columns, timestamps as ISO strings) that
 * GET /api/contract/{a}/verified returns (src/lib/verify/read.ts verifiedResponse).
 *
 * `fromV2Response` (infoSources.ts) maps a response to ContractInfo; the contract
 * page reads it through createApiSourceV2.
 */

/** One `verified_contracts` row as JSON. All text columns are nullable unless noted. */
export interface VerifiedContractRecordV2 {
  id: string;
  chainId: number;
  genesisHash: string | null;
  address: string;
  runtimeCodeHash: string | null;
  runtimeMaskedHash?: string | null;
  runtimeCodeLength?: number | null;
  /** full | partial | similar */
  /** Null for a legacy record (see `legacy`). */
  matchType: "full" | "partial" | "similar" | null;
  /** How the runtime matched. */
  runtimeMatch: "full" | "partial" | null;
  /** Null when no creation transaction could be compared. */
  creationMatch: "full" | "partial" | null;
  /** For a similar match: the id of the record whose source was applied. */
  similarTo: string | null;
  sourceFormat: string;
  contractName: string | null;
  fullyQualifiedName: string | null;
  compilerVersion: string | null;
  solcLongVersion: string | null;
  /** The full standard-JSON input, as a JSON string. */
  stdJsonInput: string | null;
  metadata: string | null;
  /** ABI as a JSON string. */
  abi: string | null;
  storageLayout: string | null;
  deployedSourceMap: string | null;
  creationSourceMap: string | null;
  immutableReferences: string | null;
  constructorArgs: string | null;
  libraries: string | null;
  creationTxHash: string | null;
  deployer: string | null;
  sourceHash: string | null;
  legacyGuid: string | null;
  /** Source text of a record copied from the v1 store (no standard JSON). */
  legacySource: string | null;
  createdAt: string;
  /**
   * True for a record copied forward from the v1 store: not confirmed for the current code,
   * so it carries no match types and is never verified. Absent from older responses.
   */
  legacy?: boolean;
  /** True only for a non-legacy full match. */
  verified?: boolean;
  /**
   * Optional: solc's source unit ids (`output.sources[path].id`). Not a v2 column
   * today; requested so the page need not infer ids. When absent, ids are taken
   * as solc assigns them: source unit names in sorted order.
   */
  sourceIds?: Record<string, number> | null;
}

/** One `contract_proxies` row as JSON. */
export interface ContractProxyRecordV2 {
  id: string;
  chainId: number;
  genesisHash: string;
  address: string;
  implementation: string;
  proxyType: "eip1967" | "eip1967-beacon" | "eip1822" | "eip1167";
  createdAt: string;
}

/** The response a v2 read route is expected to return for one address. */
export interface VerifiedContractResponseV2 {
  /** Best match for the address's current runtime code, or null. */
  record: VerifiedContractRecordV2 | null;
  /** For a similar match: the original record. */
  original: VerifiedContractRecordV2 | null;
  proxy: ContractProxyRecordV2 | null;
  /** False when the store could not be read. */
  storeAvailable: boolean;
}
