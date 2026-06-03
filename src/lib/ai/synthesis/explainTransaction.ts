/**
 * explainTransaction synthesis (S-1 WP-1.6). Composes a transaction's detail +
 * its receipt logs + decoded standard events into a STRUCTURED bundle the agent
 * narrates into a plain-English "what happened". The synthesis only surfaces
 * facts read from live RPC — the model must not add fields absent here (Rule 11).
 *
 * Data source: live `eth_getTransactionByHash` + `eth_getTransactionReceipt`.
 */
import { formatEther, type Hex } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { getTransaction } from "@/lib/harness/ops";

// keccak256 topic0 of the standard ERC-20/721 events.
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

const addrFromTopic = (t?: string): string | null =>
  t ? `0x${t.slice(26)}` : null;

export interface DecodedEvent {
  type: "ERC20/721 Transfer" | "ERC20 Approval" | "unknown";
  contract: string;
  from?: string | null;
  to?: string | null;
  owner?: string | null;
  spender?: string | null;
  /** Raw amount/tokenId (grains for fungible; tokenId for NFTs — ambiguous w/o ABI). */
  valueRaw?: string;
  valueSalt?: string;
}

export interface TxExplanation {
  hash: string;
  from: string;
  to: string | null;
  value: { salt: string; grains: string };
  status: "success" | "reverted" | "pending";
  gasUsed: string | null;
  contractCreated: string | null;
  decodedEvents: DecodedEvent[];
  rawLogCount: number;
  /** Facts only — the agent composes the narrative from these. */
  note: string;
}

export async function explainTransaction(hash: Hex): Promise<TxExplanation> {
  const tx = await getTransaction(hash);
  const decoded: DecodedEvent[] = [];
  let rawLogCount = 0;

  try {
    const receipt = await harnessClient().getTransactionReceipt({ hash });
    rawLogCount = receipt.logs.length;
    for (const log of receipt.logs) {
      const t0 = log.topics[0];
      if (t0 === TRANSFER_TOPIC) {
        decoded.push({
          type: "ERC20/721 Transfer",
          contract: log.address,
          from: addrFromTopic(log.topics[1]),
          to: addrFromTopic(log.topics[2]),
          valueRaw: log.data && log.data !== "0x" ? BigInt(log.data).toString() : undefined,
          valueSalt:
            log.data && log.data !== "0x" ? formatEther(BigInt(log.data)) : undefined,
        });
      } else if (t0 === APPROVAL_TOPIC) {
        decoded.push({
          type: "ERC20 Approval",
          contract: log.address,
          owner: addrFromTopic(log.topics[1]),
          spender: addrFromTopic(log.topics[2]),
          valueRaw: log.data && log.data !== "0x" ? BigInt(log.data).toString() : undefined,
        });
      } else {
        decoded.push({ type: "unknown", contract: log.address });
      }
    }
  } catch {
    // No receipt yet → pending; report honestly without inventing logs.
  }

  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: { salt: tx.valueSalt, grains: tx.valueWei },
    status: tx.status,
    gasUsed: tx.gasUsed,
    contractCreated: tx.contractAddress,
    decodedEvents: decoded,
    rawLogCount,
    note:
      `${tx.status} tx from ${tx.from} ${tx.to ? `to ${tx.to}` : "(contract creation)"} ` +
      `moving ${tx.valueSalt} SALT; ${decoded.length} event(s) decoded of ${rawLogCount} log(s).`,
  };
}
