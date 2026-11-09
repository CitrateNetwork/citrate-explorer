/**
 * Shared types for the contract pages and the contract kit (EXP-S3).
 *
 * The UI (src/scan/screens/contract.tsx) and the explorer agent (EXP-AGENT) use the
 * same functions in this directory, so there is one code path for ABI resolution,
 * reads, write preparation and proxy detection.
 */
import type { Abi, Address, Hex } from "viem";

/** Block selector for reads. A number is a block height. */
export type BlockSelector = "latest" | bigint;

/** A raw log as returned by eth_getLogs (only the fields the kit reads). */
export interface RawLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
}

/**
 * The read-only chain access the kit needs. The browser implementation is
 * `createRpcReader()` (viem over the Citrate RPC); tests and the agent can pass
 * any implementation. Data source (Rule 7): the Citrate JSON-RPC.
 */
export interface ChainReader {
  chainId: number;
  getCode(address: Address): Promise<Hex>;
  /** eth_getStorageAt. A past block needs historical state, which 40204 nodes do not serve yet (CNV-RPC). */
  getStorageAt(address: Address, slot: Hex, block?: BlockSelector): Promise<Hex>;
  /** eth_call. Rejects on revert; the rejection carries the revert data (see codec.revertDataOf). */
  call(req: { to: Address; data: Hex; from?: Address; value?: bigint; block?: BlockSelector }): Promise<Hex>;
  estimateGas(req: { to: Address; data: Hex; from?: Address; value?: bigint }): Promise<bigint>;
  blockNumber(): Promise<bigint>;
  /** eth_getLogs over an inclusive range. The node caps the span (1000 blocks on 40204). */
  getLogs(req: { address: Address; fromBlock: bigint; toBlock: bigint; topics?: (Hex | Hex[] | null)[] }): Promise<RawLog[]>;
}

/** One verified source file. */
export interface SourceFile {
  /** Source unit name as given to solc (e.g. `src/Registry.sol`). */
  path: string;
  content: string;
}

/**
 * How far the contract's source can be trusted, from the verification store.
 * Only `verified` earns the green badge (FWA-C12-05).
 */
/**
 * "legacy-unconfirmed": a record copied forward from the pre-v2 store, which never
 * recorded the chain or the code it matched. Its source is shown, but it is not
 * confirmed for the code at the address now, so it is never verified.
 */
export type VerificationStatus = "verified" | "partial-match" | "similar-match" | "legacy-unconfirmed" | "unverified" | "unavailable";

/**
 * Everything the contract page knows about an address's verified source. Produced
 * by a `ContractInfoSource` adapter; never by guessing.
 */
export interface ContractInfo {
  address: string;
  status: VerificationStatus;
  /** True only for a full match. */
  verified: boolean;
  matchType: "full" | "partial" | "similar" | null;
  contractName: string | null;
  compilerVersion: string | null;
  abi: Abi | null;
  /** Verified sources, multi-file when the store has the standard-JSON input. */
  sources: SourceFile[];
  /**
   * Source unit id -> index in `sources`. Needed to map a source-map file index to
   * a file. Null when unknown (legacy single-file records).
   */
  sourceIndexById: Record<number, number> | null;
  /** solc `evm.deployedBytecode.sourceMap`, when the store has it (v2). */
  deployedSourceMap: string | null;
  /** Compiler settings from the standard-JSON input (optimizer, evmVersion, ...). */
  settings: Record<string, unknown> | null;
  runtimeMatch: "full" | "partial" | null;
  creationMatch: "full" | "partial" | null;
  constructorArgs: Hex | null;
  verifiedAt: string | null;
  /** One plain sentence the page shows next to the status. */
  note: string;
  /** Which adapter produced this (for the page footer and the agent). */
  origin: "api-source-v1" | "verified-contracts-v2";
}

/** Loads ContractInfo for an address. The page and the agent depend only on this. */
export interface ContractInfoSource {
  readonly origin: ContractInfo["origin"];
  load(address: string): Promise<ContractInfo>;
}
