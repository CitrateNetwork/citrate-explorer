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
import { decodeTransferLog } from "@/lib/indexer/transferDecode";

// keccak256 topic0 of the ERC-20 Approval event (transfers use the shared decoder).
const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

const addrFromTopic = (t?: string): string | null =>
  t ? `0x${t.slice(26)}` : null;

export interface DecodedEvent {
  type: "ERC-20 Transfer" | "ERC-721 Transfer" | "ERC-1155 Transfer" | "ERC-20 Approval" | "unknown";
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
  // Transfers (ERC-20/721/1155) go through the shared index-time decoder so read
  // time and index time classify identically. Batch logs surface as their first leg.
  const [tr] = decodeTransferLog(log);
  if (tr) {
    const typeByStd = {
      erc20: "ERC-20 Transfer",
      erc721: "ERC-721 Transfer",
      erc1155: "ERC-1155 Transfer",
    } as const;
    const base: DecodedEvent = {
      type: typeByStd[tr.standard],
      contract: log.address,
      contractLabel,
      from: tr.from,
      fromLabel: tr.from ? knownLabel(tr.from) : null,
      to: tr.to,
      toLabel: tr.to ? knownLabel(tr.to) : null,
    };
    if (tr.tokenId !== undefined) base.tokenId = tr.tokenId;
    if (tr.value !== undefined && tr.standard !== "erc721") {
      base.valueRaw = tr.value;
      base.value = formatEther(BigInt(tr.value)); // assumes 18 decimals; raw is authoritative
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
