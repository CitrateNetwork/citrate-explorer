import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { citrate } from "./chain";

/**
 * Provider-agnostic wagmi config for Citrate — the chain layer used by every
 * viem/wagmi hook (useAccount, useBalance, useReadContract, useWriteContract,
 * useSignTypedData). Deliberately NOT tied to any auth provider: identity lives
 * behind the auth seam (`src/lib/auth`), the chain layer is plain wagmi. Reads go
 * over http; writes use the injected browser wallet (and later the authority's
 * embedded wallet, wired inside the seam).
 */
export const wagmiConfig = createConfig({
  chains: [citrate],
  connectors: [injected()],
  transports: { [citrate.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
