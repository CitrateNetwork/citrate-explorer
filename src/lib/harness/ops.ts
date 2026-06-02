/**
 * Read-only harness operations. Each maps to one or more allowlisted RPC calls
 * (see allowlist.ts) and returns JSON-safe shapes (bigints → strings). These are
 * the single source of truth shared by the explorer API routes AND the AI agent's
 * tool-calls (src/lib/ai/tools.ts), so the UI and the model see identical data.
 *
 * Data source (Rule 11): live Citrate RPC via {@link harnessClient}.
 */
import { formatEther, type Abi, type Address, type Hex } from "viem";
import { harnessClient } from "./client";
import { getDagStats, isFinalized, type DagStats } from "@/lib/citrate/dag";

export interface ChainStatus {
  chainId: number;
  blockNumber: string;
  gasPriceWei: string;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const c = harnessClient();
  const [chainId, blockNumber, gasPrice] = await Promise.all([
    c.getChainId(),
    c.getBlockNumber(),
    c.getGasPrice(),
  ]);
  return {
    chainId,
    blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(),
  };
}

export interface BlockSummary {
  hash: string | null;
  number: string | null;
  timestamp: string;
  parentHash: string;
  miner: string | null;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
  txCount: number;
}

/** ref: "latest" | a block height (number/bigint) | a 0x block hash. */
export async function getBlock(
  ref: "latest" | number | bigint | Hex = "latest",
): Promise<BlockSummary> {
  const c = harnessClient();
  const block =
    typeof ref === "string" && ref.startsWith("0x")
      ? await c.getBlock({ blockHash: ref as Hex })
      : ref === "latest"
        ? await c.getBlock({ blockTag: "latest" })
        : await c.getBlock({ blockNumber: BigInt(ref) });
  return {
    hash: block.hash,
    number: block.number?.toString() ?? null,
    timestamp: block.timestamp.toString(),
    parentHash: block.parentHash,
    miner: block.miner ?? null,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
    baseFeePerGas: block.baseFeePerGas?.toString() ?? null,
    txCount: block.transactions.length,
  };
}

export interface TransactionDetail {
  hash: string;
  from: string;
  to: string | null;
  valueWei: string;
  valueSalt: string;
  nonce: number;
  blockNumber: string | null;
  status: "success" | "reverted" | "pending";
  gasUsed: string | null;
  contractAddress: string | null;
  input: string;
}

export async function getTransaction(hash: Hex): Promise<TransactionDetail> {
  const c = harnessClient();
  const tx = await c.getTransaction({ hash });
  let status: TransactionDetail["status"] = "pending";
  let gasUsed: string | null = null;
  let contractAddress: string | null = null;
  try {
    const receipt = await c.getTransactionReceipt({ hash });
    status = receipt.status === "success" ? "success" : "reverted";
    gasUsed = receipt.gasUsed.toString();
    contractAddress = receipt.contractAddress ?? null;
  } catch {
    // No receipt yet → still pending (Rule 11: report honestly, don't fabricate).
  }
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    valueWei: tx.value.toString(),
    valueSalt: formatEther(tx.value),
    nonce: tx.nonce,
    blockNumber: tx.blockNumber?.toString() ?? null,
    status,
    gasUsed,
    contractAddress,
    input: tx.input,
  };
}

export interface AddressInfo {
  address: string;
  balanceWei: string;
  balanceSalt: string;
  nonce: number;
  isContract: boolean;
  codeSize: number;
}

export async function getAddress(address: Address): Promise<AddressInfo> {
  const c = harnessClient();
  const [balance, nonce, code] = await Promise.all([
    c.getBalance({ address }),
    c.getTransactionCount({ address }),
    c.getCode({ address }),
  ]);
  const codeHex = code ?? "0x";
  return {
    address,
    balanceWei: balance.toString(),
    balanceSalt: formatEther(balance),
    nonce,
    isContract: codeHex !== "0x" && codeHex.length > 2,
    codeSize: codeHex === "0x" ? 0 : (codeHex.length - 2) / 2,
  };
}

export async function isContract(address: Address): Promise<boolean> {
  const code = (await harnessClient().getCode({ address })) ?? "0x";
  return code !== "0x" && code.length > 2;
}

export interface LogQuery {
  address?: Address;
  fromBlock?: bigint | "earliest";
  toBlock?: bigint | "latest";
}

export async function getLogs(query: LogQuery = {}) {
  const c = harnessClient();
  const logs = await c.getLogs({
    address: query.address,
    fromBlock: query.fromBlock ?? "earliest",
    toBlock: query.toBlock ?? "latest",
  });
  return logs.map((l) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: l.blockNumber?.toString() ?? null,
    txHash: l.transactionHash,
    logIndex: l.logIndex,
  }));
}

/**
 * Decoded read against a contract. Requires a verified ABI fragment — without
 * one we cannot honestly decode (Rule 11), so the caller must pass `abi`.
 */
export async function readContract(params: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<unknown> {
  const c = harnessClient();
  const result = await c.readContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args as never,
  });
  return jsonSafe(result);
}

export interface DagView extends DagStats {
  finalityNote: string;
}

export async function exploreDag(): Promise<DagView> {
  const stats = await getDagStats(harnessClient());
  const depth = stats.ghostdagParams.finalityDepth;
  return {
    ...stats,
    finalityNote:
      `A block is finalized once maxBlueScore − its blue_score ≥ ${depth}. ` +
      `There are ${stats.tipsCount} current tip(s); blue_score (not height) is the consensus order.`,
  };
}

/** Convenience: is a block (by blue score) finalized right now? */
export async function checkFinalized(blueScore: number): Promise<boolean> {
  const stats = await getDagStats(harnessClient());
  return isFinalized(blueScore, stats.maxBlueScore, stats.ghostdagParams.finalityDepth);
}

/** Recursively convert bigints to strings so results are JSON-serializable. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, jsonSafe(val)]),
    );
  }
  return v;
}
