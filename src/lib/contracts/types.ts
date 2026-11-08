/**
 * Shared contract-module interfaces (r1007 explorer lanes, 2026-11-07).
 *
 * Three lanes meet here:
 *   - EXP-CONTRACT owns the contract module: ABI resolution, read
 *     encode/execute/decode, `PreparedWrite` with simulation and risk flags,
 *     proxy detection, and the contract page's own approval-gated write.
 *   - EXP-REDESIGN owns the direction-B shell and the page-context "Ask" slot,
 *     which hands the agent an `AgentContext`.
 *   - EXP-AGENT (this file's author) owns the agent: tools, prompts, MCP tools
 *     and the approval UX, built against these interfaces.
 *
 * Neither of the other lanes had pushed when this was written, so the types are
 * defined here exactly as the lane briefs describe them, and EXP-AGENT ships an
 * implementation (`src/lib/agent/contractModule.ts`) that satisfies
 * `ContractModule`. The integrator swaps in EXP-CONTRACT's implementation by
 * changing one factory (`defaultContractModule()`), not the agent.
 *
 * Types only: no runtime code, so importing this file has no side effects.
 */

/** Citrate is the only network the explorer writes to. */
export const CITRATE_WRITE_CHAIN_ID = 40204 as const;

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

// ---------------------------------------------------------------------------
// Page context (EXP-REDESIGN → agent)
// ---------------------------------------------------------------------------

export type AgentContextKind = "home" | "block" | "tx" | "address" | "contract" | "token" | "agent" | "dag" | "verify" | "other";

/** What the user is looking at when they ask. Untrusted input from the client. */
export interface AgentContext {
  kind: AgentContextKind;
  /** The entity id on that page: a block height or hash, tx hash, address, token id. */
  id?: string;
  network: { chainId: number; name?: string };
}

// ---------------------------------------------------------------------------
// Identification, ABI, proxies
// ---------------------------------------------------------------------------

export type VerificationStatus = "verified" | "partial-match" | "unverified" | "unavailable";

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

export type RiskSeverity = "info" | "warn" | "elevated";

export type RiskCode =
  | "token-approval"
  | "unlimited-approval"
  | "permit"
  | "approval-for-all"
  | "ownership-transfer"
  | "admin-transfer"
  | "proxy-upgrade"
  | "payable-above-threshold"
  | "value-transfer"
  | "unverified-target"
  | "partial-match-target"
  | "proxy-target"
  | "eoa-target"
  | "simulation-reverted"
  | "simulation-unavailable"
  | "no-sender";

export interface RiskFlag {
  code: RiskCode;
  severity: RiskSeverity;
  /** One plain sentence the approval dialog shows. */
  message: string;
}

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
  /** keccak256 of the canonical (chainId, from, to, data, value); stable across re-simulation. */
  id: Hex;
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
    /** True when any flag is elevated: the dialog then requires a typed confirmation. */
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
