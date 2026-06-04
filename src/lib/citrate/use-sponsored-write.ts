"use client";

/**
 * Gasless contract writes (EIP-2771). The user signs an EIP-712 ForwardRequest
 * with their wallet (wagmi `useSignTypedData`) — no gas — and the Foundation
 * relayer submits it via `POST /api/relay`. Reads the user's forwarder nonce with
 * viem. Pairs with `useWriteContract` for the wallet-pays path.
 */
import { useCallback, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { citrate } from "./chain";
import { PROJECT_ADDRESSES } from "./addresses";
import { forwarderAbi, FORWARD_REQUEST_TYPES } from "./abi";

export type SponsorStatus = "idle" | "signing" | "relaying" | "done" | "error";

export function useSponsoredWrite() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState<SponsorStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sponsor = useCallback(
    async ({
      to,
      data,
      value = 0n,
      gas = 300_000n,
    }: {
      to: Address;
      data: Hex;
      value?: bigint;
      gas?: bigint;
    }) => {
      const forwarder = PROJECT_ADDRESSES.forwarder;
      setError(null);
      setTxHash(null);
      if (!forwarder) {
        setStatus("error");
        setError("The gasless forwarder is not deployed on this network yet.");
        return null;
      }
      if (!address) {
        setStatus("error");
        setError("Connect a wallet to sign.");
        return null;
      }
      try {
        setStatus("signing");
        const publicClient = createPublicClient({ chain: citrate, transport: http() });
        const nonce = (await publicClient.readContract({
          address: forwarder,
          abi: forwarderAbi,
          functionName: "nonces",
          args: [address],
        })) as bigint;

        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const message = { from: address, to, value, gas, nonce, deadline, data };

        const signature = await signTypedDataAsync({
          domain: {
            name: "CitrateForwarder",
            version: "1",
            chainId: citrate.id,
            verifyingContract: forwarder,
          },
          types: FORWARD_REQUEST_TYPES,
          primaryType: "ForwardRequest",
          message,
        });

        setStatus("relaying");
        const res = await fetch("/api/relay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request: {
              from: address,
              to,
              value: value.toString(),
              gas: gas.toString(),
              nonce: nonce.toString(),
              deadline,
              data,
            },
            signature,
          }),
        });
        const j = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(j.error || j.note || `Relay failed (${res.status})`);
          return null;
        }
        setTxHash(j.txHash);
        setStatus("done");
        return j.txHash as string;
      } catch (e) {
        setStatus("error");
        setError((e as Error).message);
        return null;
      }
    },
    [address, signTypedDataAsync],
  );

  return { sponsor, status, txHash, error, reset: () => { setStatus("idle"); setError(null); setTxHash(null); } };
}
