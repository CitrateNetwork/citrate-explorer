import { defineChain } from "viem";

/** Citrate Network chain id (hex 0x9D0C). Verified live 2026-05-30. Permanent. */
export const CITRATE_CHAIN_ID = 40204 as const;

const RPC_URL =
  process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
const WS_URL =
  process.env.NEXT_PUBLIC_CITRATE_WS_URL ?? "wss://rpc.citrate.ai";

/**
 * viem chain definition for Citrate. No prebuilt chain object ships in the
 * Citrate SDKs, so this is the canonical hand-rolled one for the explorer.
 *
 * Native token is SALT (18 decimals; wei are called "grains" on Citrate).
 * `blockExplorers` points at CitrateScan itself once it ships.
 */
export const citrate = defineChain({
  id: CITRATE_CHAIN_ID,
  name: "Citrate",
  nativeCurrency: { name: "SALT", symbol: "SALT", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL], webSocket: [WS_URL] },
  },
  testnet: true,
});
