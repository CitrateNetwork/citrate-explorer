/**
 * Citrate contract knowledge pack (RA-5).
 *
 * `knownLabel` (addresses.ts) tells the agent a contract's NAME; this layer tells it
 * what each one DOES — so the agent can explain Citrate's architecture, not just label
 * an address. Curated metadata is keyed by contract NAME and joined to the canonical
 * address map at read time (so a chain re-roll updates addresses with no edit here).
 *
 * This is documented knowledge about Citrate's OWN system contracts (not fabricated
 * chain data, Rule 11). Live deployment state is still confirmed via getAddress/eth_getCode.
 */
import type { Address } from "viem";
import { CONTRACT_ADDRESSES, AA_STACK, knownLabel } from "./addresses";

export type ContractCategory =
  | "AI / Inference"
  | "Compute / GPU-share"
  | "Learning / Education"
  | "Governance / Treasury"
  | "Staking / Economic security"
  | "Tokenization / Data"
  | "Payments"
  | "Account abstraction (ERC-4337)"
  | "Precompile"
  | "System";

interface CatalogEntry {
  category: ContractCategory;
  purpose: string;
}

/** Curated purpose by contract NAME. Names match the canonical address map. */
const CATALOG: Record<string, CatalogEntry> = {
  // AI / Inference
  ModelRegistry: { category: "AI / Inference", purpose: "Registry of AI models available for on-chain inference (model hash → metadata, owner, pricing, providers)." },
  InferenceRouter: { category: "AI / Inference", purpose: "Routes inference requests to registered GPU providers and settles payment; providers stake SALT and register an OpenAI-compatible endpoint." },
  ModelMarketplace: { category: "AI / Inference", purpose: "Marketplace for listing and discovering AI models and their access terms." },
  ModelAccessControl: { category: "AI / Inference", purpose: "Gates who may invoke a model (licensing / access policies)." },
  AIModelRegistryPortable: { category: "AI / Inference", purpose: "Portable (cross-deployment) variant of the AI model registry." },
  AIInferenceRouterPortable: { category: "AI / Inference", purpose: "Portable (cross-deployment) variant of the inference router." },
  AILearningCycleCorePortable: { category: "AI / Inference", purpose: "Portable core for the AI learning/training cycle." },
  // Compute / GPU-share
  ComputePool: { category: "Compute / GPU-share", purpose: "Pool of GPU compute providers; coordinates job assignment and staking for the compute-share marketplace." },
  ComputeVerifier: { category: "Compute / GPU-share", purpose: "Verifies that compute/inference work was actually performed before payout." },
  ComputeMarketplace: { category: "Compute / GPU-share", purpose: "Matches compute buyers with GPU providers." },
  ComputePoolTraining: { category: "Compute / GPU-share", purpose: "Compute pool specialized for model training / LoRA fine-tuning jobs." },
  ComputePricingOracle: { category: "Compute / GPU-share", purpose: "On-chain pricing oracle for compute (per-token / per-GPU-hour rates)." },
  BulkComputeGateway: { category: "Compute / GPU-share", purpose: "Batched dispatch gateway for large compute jobs." },
  // Learning / Education
  LearningPool: { category: "Learning / Education", purpose: "Pooled incentives for the learning/education stack." },
  LearningCycleManager: { category: "Learning / Education", purpose: "Orchestrates learning cycles (rounds of training/evaluation)." },
  ClassroomRegistry: { category: "Learning / Education", purpose: "Registry of classrooms in the education stack." },
  ClassroomClusterV1: { category: "Learning / Education", purpose: "Compute cluster backing a classroom." },
  MentorMatcher: { category: "Learning / Education", purpose: "Matches mentors with learners." },
  EduForwarder: { category: "Learning / Education", purpose: "EIP-2771 trusted forwarder for gasless education-stack transactions." },
  // Governance / Treasury
  TreasuryGovernor: { category: "Governance / Treasury", purpose: "Governs the treasury — proposals and execution." },
  InstitutionalVault: { category: "Governance / Treasury", purpose: "Vault holding institutional funds." },
  StablecoinTreasury: { category: "Governance / Treasury", purpose: "Manages stablecoin reserves." },
  ContributionAccounting: { category: "Governance / Treasury", purpose: "On-chain accounting of contributions." },
  TestnetFarmingAccounting: { category: "Governance / Treasury", purpose: "Accounting of testnet farming rewards." },
  BudgetAllocation: { category: "Governance / Treasury", purpose: "Allocates budget across programs." },
  CashoutRequest: { category: "Governance / Treasury", purpose: "Handles cashout / withdrawal requests." },
  // Staking / Economic security
  LiquidStakingPool: { category: "Staking / Economic security", purpose: "Liquid staking of SALT." },
  NematocystSlashing: { category: "Staking / Economic security", purpose: "Slashing module for misbehaving providers/validators." },
  MarketMakerAllocation: { category: "Staking / Economic security", purpose: "Allocates market-making incentives." },
  HeartbeatMonitor: { category: "Staking / Economic security", purpose: "Tracks provider liveness via heartbeats." },
  DisputeResolution: { category: "Staking / Economic security", purpose: "Resolves disputes over compute/inference results." },
  // Tokenization / Data
  WrappedSALT: { category: "Tokenization / Data", purpose: "ERC-20 wrapper of native SALT (wSALT) for contracts that need an ERC-20 interface." },
  AgentDecisionRegistry: { category: "Tokenization / Data", purpose: "Records agent decisions on-chain for auditability." },
  SpecRegistry: { category: "Tokenization / Data", purpose: "Registry of specifications / standards." },
  IPFSIncentives: { category: "Tokenization / Data", purpose: "Incentivizes IPFS pinning / decentralized storage." },
  LoRAFactory: { category: "Tokenization / Data", purpose: "On-chain registry/factory for LoRA fine-tune adapters — register, discover, and serve LoRAs that specialize the base models." },
  TEEAttestationRegistry: { category: "Tokenization / Data", purpose: "Registry of TEE (trusted-execution) attestations for verifiable compute." },
  // Payments
  X402Facilitator: { category: "Payments", purpose: "HTTP-402 micropayment facilitator for paid API/inference access." },
  X402Paywall: { category: "Payments", purpose: "HTTP-402 paywall gating access until payment." },
  // Account abstraction
  EntryPoint: { category: "Account abstraction (ERC-4337)", purpose: "ERC-4337 v0.7 EntryPoint — the account-abstraction user-op entry point." },
  CitrateWallet: { category: "Account abstraction (ERC-4337)", purpose: "Smart-contract wallet instance." },
  CitrateWalletFactory: { category: "Account abstraction (ERC-4337)", purpose: "Factory that deploys CitrateWallet accounts." },
  CitratePaymaster: { category: "Account abstraction (ERC-4337)", purpose: "Sponsors gas for AA user-ops (gasless UX)." },
  WebAuthnP256Validator: { category: "Account abstraction (ERC-4337)", purpose: "WebAuthn/passkey (P-256) signature validator for AA wallets." },
  CitrateECDSAValidator: { category: "Account abstraction (ERC-4337)", purpose: "ECDSA signature validator for AA wallets." },
  GuardianRecoveryModule: { category: "Account abstraction (ERC-4337)", purpose: "Social-recovery module for AA wallets." },
};

/** Citrate precompiles (fixed system addresses, not in the contracts map). */
export const PRECOMPILES: Record<string, { name: string; purpose: string }> = {
  "0x0000000000000000000000000000000000001000": { name: "StateModel", purpose: "Precompile: read model state." },
  "0x0000000000000000000000000000000000001001": { name: "StateArtifact", purpose: "Precompile: read artifact state." },
  "0x0000000000000000000000000000000000001003": { name: "StateGovernance", purpose: "Precompile: read governance state." },
  "0x0000000000000000000000000000000000000100": { name: "InferenceDeploy", purpose: "Precompile: deploy an inference job." },
  "0x0000000000000000000000000000000000000101": { name: "InferenceRun", purpose: "Precompile: run inference." },
  "0x0000000000000000000000000000000000000108": { name: "InferenceVerify", purpose: "Precompile: verify an inference result." },
};

/** One-paragraph orientation for the agent / an MCP resource. */
export const CITRATE_OVERVIEW =
  "Citrate (chain 40204) is an AI-native Layer-1 BlockDAG (GHOSTDAG). Native token SALT " +
  "(18 decimals; wei = grains). Its system contracts implement an AI inference marketplace " +
  "(ModelRegistry + InferenceRouter), a GPU compute-share marketplace (ComputePool family), " +
  "an on-chain LoRA fine-tune registry (LoRAFactory), an education stack, ERC-4337 account " +
  "abstraction, HTTP-402 micropayments, and treasury/staking. Inference precompiles live at " +
  "0x…0100/0101/0108; state precompiles at 0x…1000/1001/1003.";

export interface ContractDescription {
  address: string;
  name: string | null;
  category: ContractCategory | null;
  purpose: string | null;
  isPrecompile: boolean;
  known: boolean;
  note: string;
}

/** Describe a Citrate system contract / precompile by address (catalog knowledge). */
export function describeContract(address: string): ContractDescription {
  const a = address.toLowerCase();
  const pre = PRECOMPILES[a];
  if (pre) {
    return { address: a, name: pre.name, category: "Precompile", purpose: pre.purpose, isPrecompile: true, known: true, note: "Citrate precompile (documented system address)." };
  }
  const name = knownLabel(address);
  const entry = name ? CATALOG[name] : undefined;
  return {
    address: a,
    name: name ?? null,
    category: entry?.category ?? (name ? "System" : null),
    purpose: entry?.purpose ?? null,
    isPrecompile: false,
    known: !!name,
    note: name
      ? "From Citrate's documented contract catalog. Confirm live code with getAddress/getContractCode."
      : "Not a known Citrate system contract. Use getAddress to inspect it, or callView to read its functions.",
  };
}

export interface CatalogListing {
  name: string;
  address: Address;
  category: ContractCategory;
  purpose: string;
}

/** List Citrate's documented system contracts, optionally by category. */
export function listContracts(category?: ContractCategory): CatalogListing[] {
  const all: Record<string, Address> = { ...CONTRACT_ADDRESSES, ...AA_STACK };
  const out: CatalogListing[] = [];
  for (const [name, addr] of Object.entries(all)) {
    const entry = CATALOG[name];
    if (!entry) continue;
    if (category && entry.category !== category) continue;
    out.push({ name, address: addr, category: entry.category, purpose: entry.purpose });
  }
  return out.sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
}

export const CONTRACT_CATEGORIES: ContractCategory[] = [
  "AI / Inference",
  "Compute / GPU-share",
  "Learning / Education",
  "Governance / Treasury",
  "Staking / Economic security",
  "Tokenization / Data",
  "Payments",
  "Account abstraction (ERC-4337)",
  "Precompile",
];
