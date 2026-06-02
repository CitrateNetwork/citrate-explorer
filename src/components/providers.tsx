"use client";

import { type ReactNode, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/citrate/config";
import { citrate } from "@/lib/citrate/chain";

/**
 * App providers: Privy (auth) → React Query → wagmi (via @privy-io/wagmi so the
 * embedded wallet drives wagmi hooks for the Write-Contract flow).
 *
 * Privy is only mounted when NEXT_PUBLIC_PRIVY_APP_ID is set, so the explorer
 * runs read-only in local dev before credentials are provisioned. Without it we
 * still mount plain wagmi so read hooks work; wallet/signing needs Privy.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: citrate,
        supportedChains: [citrate],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
