import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { citrate } from "./chain";

/**
 * wagmi config for Citrate, created via @privy-io/wagmi so Privy's embedded
 * wallet is exposed through standard wagmi hooks (useAccount, useSignTypedData,
 * useBalance) — used by the Write-Contract flow (S-5). Single supported chain.
 */
export const wagmiConfig = createConfig({
  chains: [citrate],
  transports: { [citrate.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
