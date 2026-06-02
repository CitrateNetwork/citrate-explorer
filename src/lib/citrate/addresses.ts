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
