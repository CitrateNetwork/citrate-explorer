/**
 * Shared token-transfer decoder (RA-3 WP-3.2).
 *
 * One place that turns a raw event log into structured transfer record(s), used at
 * BOTH index time (ingest → token_transfers) and read time (explainTransaction). It
 * classifies ERC-20 / ERC-721 / ERC-1155 transfers from topic0 + topic arity:
 *
 *  - ERC-20  Transfer(from indexed, to indexed, value)        → 3 topics, value in data
 *  - ERC-721 Transfer(from indexed, to indexed, tokenId idx)  → 4 topics, id is topic[3]
 *  - ERC-1155 TransferSingle(op, from, to, id, value)         → 4 topics, id+value in data
 *  - ERC-1155 TransferBatch(op, from, to, ids[], values[])    → 4 topics, arrays in data
 *
 * Returns the raw on-chain facts only (Rule 11): amounts/ids as exact decimal
 * strings, never formatted (decimals are applied later from token metadata).
 */
import { decodeAbiParameters, type Hex } from "viem";

export type TokenStandard = "erc20" | "erc721" | "erc1155";

export interface TransferRecord {
  standard: TokenStandard;
  token: string; // contract address (lowercased)
  from: string; // lowercased
  to: string; // lowercased
  /** ERC-20 / ERC-1155 amount, raw integer string. Undefined for ERC-721. */
  value?: string;
  /** ERC-721 / ERC-1155 token id, decimal string. Undefined for ERC-20. */
  tokenId?: string;
  logIndex?: number;
}

export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex?: number;
}

// keccak256 event signatures.
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
export const TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

const addrFromTopic = (t?: string): string | null => (t ? `0x${t.slice(26)}`.toLowerCase() : null);

/**
 * Decode a single log into 0..n transfer records (TransferBatch yields several).
 * Returns [] for non-transfer logs or malformed data.
 */
export function decodeTransferLog(log: RawLog): TransferRecord[] {
  const t0 = log.topics[0];
  const token = log.address.toLowerCase();
  const li = log.logIndex;

  try {
    if (t0 === TRANSFER_TOPIC) {
      const from = addrFromTopic(log.topics[1]);
      const to = addrFromTopic(log.topics[2]);
      if (!from || !to) return [];
      if (log.topics.length === 4) {
        // ERC-721: tokenId is the indexed 4th topic.
        return [{ standard: "erc721", token, from, to, tokenId: BigInt(log.topics[3]).toString(), logIndex: li }];
      }
      // ERC-20: value in data.
      const value = log.data && log.data !== "0x" ? BigInt(log.data).toString() : "0";
      return [{ standard: "erc20", token, from, to, value, logIndex: li }];
    }

    if (t0 === TRANSFER_SINGLE_TOPIC) {
      const from = addrFromTopic(log.topics[2]); // topic[1] is the operator
      const to = addrFromTopic(log.topics[3]);
      if (!from || !to) return [];
      const [id, value] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], log.data as Hex) as [bigint, bigint];
      return [{ standard: "erc1155", token, from, to, tokenId: id.toString(), value: value.toString(), logIndex: li }];
    }

    if (t0 === TRANSFER_BATCH_TOPIC) {
      const from = addrFromTopic(log.topics[2]);
      const to = addrFromTopic(log.topics[3]);
      if (!from || !to) return [];
      const [ids, values] = decodeAbiParameters(
        [{ type: "uint256[]" }, { type: "uint256[]" }],
        log.data as Hex,
      ) as [readonly bigint[], readonly bigint[]];
      return ids.map((id, i) => ({
        standard: "erc1155" as const,
        token,
        from,
        to,
        tokenId: id.toString(),
        value: (values[i] ?? 0n).toString(),
        logIndex: li,
      }));
    }
  } catch {
    // Malformed data for a transfer-shaped topic → skip rather than crash ingest.
    return [];
  }
  return [];
}

/** True if a log's topic0 is one of the recognized transfer signatures. */
export function isTransferLog(log: RawLog): boolean {
  const t0 = log.topics[0];
  return t0 === TRANSFER_TOPIC || t0 === TRANSFER_SINGLE_TOPIC || t0 === TRANSFER_BATCH_TOPIC;
}
