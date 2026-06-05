/**
 * explainTransaction synthesis (S-1 WP-1.6, WS-3 forensic). Composes a
 * transaction's detail + its receipt logs + decoded standard events into a
 * STRUCTURED bundle the agent narrates into a plain-English "what happened". Only
 * facts read from live RPC are surfaced (Rule 11). Events are decoded with
 * known-address labels and correct ERC-20 vs ERC-721 distinction so the agent can
 * do real forensic analysis.
 *
 * Data source: live `eth_getTransactionByHash` + `eth_getTransactionReceipt`.
 */
import { formatEther, type Hex } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { getTransaction } from "@/lib/harness/ops";
import { knownLabel } from "@/lib/citrate/addresses";

// keccak256 topic0 of the standard ERC-20/721 events.
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

const addrFromTopic = (t?: string): string | null =>
  t ? `0x${t.slice(26)}` : null;

export interface DecodedEvent {
  type: "ERC-20 Transfer" | "ERC-721 Transfer" | "ERC-20 Approval" | "unknown";
  contract: string;
  contractLabel: string | null;
  from?: string | null;
  fromLabel?: string | null;
  to?: string | null;
  toLabel?: string | null;
  owner?: string | null;
  spender?: string | null;
  /** ERC-20 amount (raw grains + formatted). */
  valueRaw?: string;
  value?: string;
  /** ERC-721 token id (when the Transfer indexes a 4th topic). */
  tokenId?: string;
  /** topic0 for events we don't recognize, so the agent can look them up. */
  topic0?: string;
}

interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
}

/** Decode one log into a labeled standard event (or 'unknown' with its topic0). */
export function decodeLog(log: RawLog): DecodedEvent {
  const t0 = log.topics[0];
  const contractLabel = knownLabel(log.address);
  if (t0 === TRANSFER_TOPIC) {
    const from = addrFromTopic(log.topics[1]);
    const to = addrFromTopic(log.topics[2]);
    const isNft = log.topics.length === 4; // tokenId is the indexed 4th topic
    const base: DecodedEvent = {
      type: isNft ? "ERC-721 Transfer" : "ERC-20 Transfer",
      contract: log.address,
      contractLabel,
      from,
      fromLabel: from ? knownLabel(from) : null,
      to,
      toLabel: to ? knownLabel(to) : null,
    };
    if (isNft) {
      base.tokenId = log.topics[3] ? BigInt(log.topics[3]).toString() : undefined;
    } else if (log.data && log.data !== "0x") {
      base.valueRaw = BigInt(log.data).toString();
      base.value = formatEther(BigInt(log.data)); // assumes 18 decimals; raw is authoritative
    }
    return base;
  }
  if (t0 === APPROVAL_TOPIC) {
    const owner = addrFromTopic(log.topics[1]);
    const spender = addrFromTopic(log.topics[2]);
    return {
      type: "ERC-20 Approval",
      contract: log.address,
      contractLabel,
      owner,
      spender,
      valueRaw: log.data && log.data !== "0x" ? BigInt(log.data).toString() : undefined,
    };
  }
  return { type: "unknown", contract: log.address, contractLabel, topic0: t0 ?? undefined };
}

export interface TxExplanation {
  hash: string;
  from: string;
  fromLabel: string | null;
  to: string | null;
  toLabel: string | null;
  value: { salt: string; grains: string };
  status: "success" | "reverted" | "pending";
  gasUsed: string | null;
  fee: { salt: string; grains: string } | null;
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
    for (const log of receipt.logs) decoded.push(decodeLog(log));
  } catch {
    // No receipt yet → pending; report honestly without inventing logs.
  }

  const transfers = decoded.filter(
    (e) => e.type === "ERC-20 Transfer" || e.type === "ERC-721 Transfer",
  ).length;
  return {
    hash: tx.hash,
    from: tx.from,
    fromLabel: tx.fromLabel,
    to: tx.to,
    toLabel: tx.toLabel,
    value: { salt: tx.valueSalt, grains: tx.valueWei },
    status: tx.status,
    gasUsed: tx.gasUsed,
    fee: tx.fee,
    contractCreated: tx.contractAddress,
    decodedEvents: decoded,
    rawLogCount,
    note:
      `${tx.status} ${tx.type} tx from ${tx.fromLabel ?? tx.from} ` +
      `${tx.to ? `to ${tx.toLabel ?? tx.to}` : "(contract creation)"} moving ${tx.valueSalt} SALT; ` +
      `${transfers} token transfer(s) + ${decoded.length - transfers} other event(s) of ${rawLogCount} log(s)` +
      `${tx.fee ? `; fee ${tx.fee.salt} SALT` : ""}.`,
  };
}
