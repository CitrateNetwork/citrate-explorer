import type { Address } from "viem";

/**
 * Well-known on-chain addresses CitrateScan decodes by default. Network-level
 * system contracts are constants; app/deployment-specific ones come from env so
 * the same build works across environments. Always confirm with `eth_getCode`
 * before treating an address as a contract (Rule 11).
 */
export const CITRATE_ADDRESSES = {
  /** AI ModelRegistry (verified 2026-05-30). */
  modelRegistry: (process.env.NEXT_PUBLIC_MODEL_REGISTRY ??
    "0x077fbc3338a9e6bad90a3a041e6b7425689754ef") as Address,
  /** InferenceRouter (verified 2026-05-30). */
  inferenceRouter: (process.env.NEXT_PUBLIC_INFERENCE_ROUTER ??
    "0xad7c3135c1b9b3189208fd617b6b058c1c0469f3") as Address,
} as const;

/** Deployment-specific addresses (set per environment; may be undefined). */
export const PROJECT_ADDRESSES: {
  /** EIP-2771 forwarder used for gasless writes (S-5). */
  forwarder?: Address;
} = {
  forwarder: process.env.NEXT_PUBLIC_FORWARDER_ADDRESS as Address | undefined,
};

/**
 * Genesis SALT allocations (from citrate-chain `DEPLOYED_ADDRESSES.md`). SALT is
 * the NATIVE token — there are no ERC-20 Transfer events to index — so a full
 * "top holders" leaderboard needs a balance indexer. These known genesis holders
 * are the honest answer to "who holds the most SALT"; the agent reads their live
 * balances and says so. Verify with `eth_getBalance`.
 */
export const GENESIS_ALLOCATIONS: ReadonlyArray<{
  address: Address;
  label: string;
  genesisSalt: string;
}> = [
  { address: "0xaceaa7d00c024d32e6e0a07094ceb1a7706786d1", label: "Genesis treasury / mint authority", genesisSalt: "500000000" },
  { address: "0xf4adb1734f7bd9f8979bd53b2bf6d7690d562b6d", label: "Reserve", genesisSalt: "50000000" },
  { address: "0x4250675f9015e65fc866f3a373f82bb9dfc000c6", label: "Deployer EOA / coinbase", genesisSalt: "10000000" },
  { address: "0xb6e9a558a4f9dc9e3f667a3b446a48bddf671126", label: "Reserve", genesisSalt: "10000000" },
  { address: "0x6680b43af09d9b351332bf5378eb580e3b390182", label: "Testnet faucet", genesisSalt: "10000000" },
  { address: "0x04abae08ac643b2c518f22e212a27f7b6e14b4c3", label: "Reserve", genesisSalt: "5000000" },
];

/**
 * Known Citrate system / AI-native contracts (from `DEPLOYED_ADDRESSES.md`), for
 * labeling addresses in forensic reads. Keys are lowercased. Always confirm code
 * with `eth_getCode` before relying on a label.
 */
export const KNOWN_CONTRACTS: Readonly<Record<string, string>> = {
  "0x077fbc3338a9e6bad90a3a041e6b7425689754ef": "ModelRegistry",
  "0xad7c3135c1b9b3189208fd617b6b058c1c0469f3": "InferenceRouter",
  "0xac6bfb1709bcba5a005fe2823b4d8bc55db2b7d9": "LoRAFactory",
  "0xf1eae5dd4a1639922ea610142f7ce51330065b57": "ComputePoolTraining",
  "0xf3f9f72ea2bb3f763b07390b7257da643b8ee9b6": "ComputeMarketplace",
  "0x46773aeca885be65cd313b7d9bce9625767d40b5": "HeartbeatMonitor",
  "0x11399989175783cdca8ecb095835c8cd4720c6fc": "X402Paywall",
  "0xc0fde3a8a42f6479cf12b4a5489e7a988c918e23": "X402Facilitator",
  "0x1f73bb479f397a34b5e3145e51d25bc5007273bf": "WrappedSALT",
  "0x2a3a7fe1619e10f9dda80ced394ebdffb90d9cbe": "CitrateForwarder (edu)",
};

/** Label a known address (genesis holder or system contract), else null. */
export function knownLabel(address: string): string | null {
  const a = address.toLowerCase();
  if (KNOWN_CONTRACTS[a]) return KNOWN_CONTRACTS[a];
  const g = GENESIS_ALLOCATIONS.find((x) => x.address.toLowerCase() === a);
  return g ? g.label : null;
}
