/**
 * The agent's contract interfaces (r1007 explorer lanes, integrated 2026-11-07).
 *
 *   - The contract kit (src/lib/contract/, EXP-CONTRACT) is the one
 *     implementation: ABI resolution, proxy detection, reads, write preparation
 *     with simulation and risk flags, and the approval-gated send.
 *   - The direction-B shell (EXP-REDESIGN) owns the page context the Ask slot
 *     hands the agent (`AgentContext`, src/explorer/agentContext.ts).
 *   - The agent (EXP-AGENT) consumes the kit through `ContractModule`
 *     (src/lib/agent/contractModule.ts is an adapter over the kit, not a second
 *     implementation). The types below are the JSON-safe shapes its tools return
 *     to chat and MCP; `PreparedWrite` here is the wire form of the kit's
 *     PreparedWrite (bigints as decimal strings, `executable: false`).
 *
 * Types only: no runtime code, so importing this file has no side effects.
 */

/** Citrate is the only network the explorer writes to. */
export const CITRATE_WRITE_CHAIN_ID = 40204 as const;

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

// ---------------------------------------------------------------------------
// Page context (EXP-REDESIGN → agent): one definition, the shell's.
// ---------------------------------------------------------------------------

export type { AgentContext, AgentContextKind } from "@/explorer/agentContext";

// ---------------------------------------------------------------------------
// Identification, ABI, proxies
// ---------------------------------------------------------------------------

export type VerificationStatus = "verified" | "partial-match" | "similar-match" | "unverified" | "unavailable";

export type ProxyKind = "eip1967" | "eip1967-beacon" | "eip1822" | "eip1167" | null;

export interface ProxyInfo {
  isProxy: boolean;
  kind: ProxyKind;
  /** The logic contract the proxy delegates to, when it could be read. */
  implementation: Address | null;
  /** EIP-1967 admin slot, when set. */
  admin: Address | null;
  /** EIP-1967 beacon slot, when set. */
  beacon: Address | null;
  /** Where each fact came from (storage slot or bytecode pattern). */
  evidence: string[];
}

export interface AbiParam {
  name?: string;
  type: string;
  internalType?: string;
  indexed?: boolean;
  components?: AbiParam[];
}

export interface AbiItem {
  type: "function" | "event" | "error" | "constructor" | "fallback" | "receive";
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
  anonymous?: boolean;
}

export type AbiSource =
  /** the target's own verified (full-match) ABI */
  | "verified"
  /** the target's partial-match ABI (not verified) */
  | "partial-match"
  /** the target is a proxy; the ABI is its implementation's */
  | "implementation"
  /** built from a function signature the caller supplied; nothing verified it */
  | "signature"
  | "none";

export interface ResolvedAbi {
  address: Address;
  source: AbiSource;
  /** Verification status of the contract the ABI came from. */
  status: VerificationStatus;
  abi: AbiItem[] | null;
  contractName: string | null;
  /** Set when `source` is "implementation". */
  implementation: Address | null;
  proxy: ProxyInfo;
  note: string;
}

export interface InterfaceSupport {
  erc165: boolean;
  /** ERC-165 `supportsInterface` answers; exact. */
  erc721: boolean;
  erc1155: boolean;
  /** Heuristic: ERC-20 has no ERC-165 id, so this is "the ERC-20 reads answered". */
  erc20Heuristic: boolean;
  /** Plain words on how each answer was reached. */
  method: string[];
}

export interface ContractIdentity {
  address: Address;
  isContract: boolean;
  codeSize: number;
  codeHash: string | null;
  label: string | null;
  verification: { status: VerificationStatus; contractName: string | null; compilerVersion: string | null };
  proxy: ProxyInfo;
  interfaces: InterfaceSupport;
  /** Token metadata when it answered. Name and symbol are attacker-authored text. */
  token: { name: string | null; symbol: string | null; decimals: number | null } | null;
  note: string;
}

// ---------------------------------------------------------------------------
// Reads and decoding
// ---------------------------------------------------------------------------

/** One decoded argument or return value. Values are JSON-safe (bigints as decimal strings). */
export interface DecodedValue {
  name: string;
  type: string;
  value: unknown;
}

export interface ContractReadResult {
  address: Address;
  function: string;
  signature: string;
  abiSource: AbiSource;
  block: string;
  result: DecodedValue[];
}

export interface DecodedCall {
  selector: Hex;
  /** "verified-abi" | "implementation-abi" | "partial-abi" | "known-signature" | "unknown" */
  decodedWith: string;
  function: string | null;
  signature: string | null;
  args: DecodedValue[];
  note: string;
}

export interface DecodedLog {
  address: Address;
  decodedWith: string;
  event: string | null;
  signature: string | null;
  args: DecodedValue[];
  topics: Hex[];
  data: Hex;
}

// ---------------------------------------------------------------------------
// Prepared writes
// ---------------------------------------------------------------------------

/** The kit's risk vocabulary (src/lib/contract/risk.ts): one set of codes for the page and the agent. */
export type { RiskCode, RiskFlag, RiskSeverity } from "@/lib/contract/risk";
import type { RiskFlag } from "@/lib/contract/risk";

export interface Simulation {
  /** True when eth_call succeeded from `from`. */
  ok: boolean;
  /** The sender the call was simulated from (null: no sender known). */
  from: Address | null;
  /** Decoded revert reason, when it reverted. */
  revertReason: string | null;
  gasEstimate: string | null;
  gasPriceWei: string | null;
  /** gasEstimate × gasPrice, in SALT. */
  feeSalt: string | null;
  /** The head the simulation ran against. */
  blockNumber: string | null;
  simulatedAt: string;
}

export interface RelayEligibility {
  eligible: boolean;
  /** Why not, in the relay policy's own words; null when eligible. */
  reason: string | null;
  /** The gas limit the relay request is signed with (within the relay's cap), when eligible. */
  gas: string | null;
}

export interface PreparedWrite {
  /** The kit preparation's id: unique per preparation; an approval is bound to it and used once. */
  id: Hex;
  /** keccak256 of the canonical (chainId, from, to, data, value); stable across re-simulation. */
  requestId: Hex;
  chainId: typeof CITRATE_WRITE_CHAIN_ID;
  network: "citrate";
  from: Address | null;
  target: {
    address: Address;
    label: string | null;
    isContract: boolean;
    verification: VerificationStatus;
    contractName: string | null;
    abiSource: AbiSource;
    proxy: ProxyInfo;
  };
  call: {
    function: string;
    signature: string;
    selector: Hex;
    stateMutability: "nonpayable" | "payable";
    args: DecodedValue[];
    data: Hex;
  };
  value: { wei: string; salt: string };
  simulation: Simulation;
  risk: {
    flags: RiskFlag[];
    /** True when any flag is high: the dialog then requires a typed confirmation. */
    elevated: boolean;
    /** What the user must type to confirm an elevated write. */
    confirmPhrase: string | null;
  };
  relay: RelayEligibility;
  /** Where the preparation was asked for. */
  origin: "chat" | "mcp" | "ui";
  /** Always false: a PreparedWrite is a proposal. Only a human approval in the UI executes it. */
  executable: false;
  createdAt: string;
}

export interface PrepareWriteRequest {
  address: Address;
  /** A function name, or a full signature such as "transfer(address,uint256)". */
  function: string;
  args: unknown[];
  /** Native value in SALT, decimal ("0.5"). */
  value?: string;
  from?: Address | null;
  origin: PreparedWrite["origin"];
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export interface ContractModule {
  identify(address: Address): Promise<ContractIdentity>;
  resolveAbi(address: Address): Promise<ResolvedAbi>;
  detectProxy(address: Address): Promise<ProxyInfo>;
  read(req: { address: Address; function: string; args: unknown[]; block?: bigint | "latest" }): Promise<ContractReadResult>;
  decodeCalldata(req: { data: Hex; address?: Address }): Promise<DecodedCall>;
  decodeLog(req: { address: Address; topics: Hex[]; data: Hex }): Promise<DecodedLog>;
  prepareWrite(req: PrepareWriteRequest): Promise<PreparedWrite>;
}
