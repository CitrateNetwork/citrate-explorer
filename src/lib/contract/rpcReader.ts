/**
 * The ChainReader over the Citrate JSON-RPC (EXP-S3), used by the contract pages
 * in the browser and available to the agent on the server.
 *
 * Data source (Rule 7): rpc.citrate.ai (NEXT_PUBLIC_CITRATE_RPC_URL), read-only
 * methods only: eth_getCode, eth_getStorageAt, eth_call, eth_estimateGas,
 * eth_blockNumber, eth_getLogs.
 */
import { createPublicClient, http, numberToHex, type Address, type Hex, type PublicClient } from "viem";
import { citrate } from "@/lib/citrate/chain";
import type { BlockSelector, ChainReader, RawLog } from "./types";

/** The largest eth_getLogs span this reader sends (the 40204 node cap). */
export const MAX_LOG_SPAN = 1000n;

/** Refuse an unbounded eth_getLogs request (PBA-L3c-039 tripwire). */
export function assertLogRequest(req: { address: string; fromBlock: bigint; toBlock: bigint; topics?: unknown[] }): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.address)) throw new Error("eth_getLogs needs one contract address");
  if (req.fromBlock < 0n || req.toBlock < req.fromBlock) throw new Error("eth_getLogs needs a forward block range");
  if (req.toBlock - req.fromBlock + 1n > MAX_LOG_SPAN) throw new Error(`eth_getLogs spans at most ${MAX_LOG_SPAN} blocks`);
  if (req.topics && req.topics.length > 4) throw new Error("eth_getLogs takes at most 4 topic positions");
  for (const t of req.topics ?? []) if (Array.isArray(t) && t.length > 4) throw new Error("at most 4 alternatives per topic");
}

const blockTag = (b?: BlockSelector) => (b === undefined || b === "latest" ? "latest" : numberToHex(b));

interface RpcLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | null;
  transactionHash: Hex | null;
  logIndex: Hex | null;
}

export function createRpcReader(client?: PublicClient): ChainReader {
  const c = client ?? (createPublicClient({ chain: citrate, transport: http() }) as PublicClient);
  const request = c.request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
  return {
    chainId: citrate.id,
    async getCode(address: Address) {
      return ((await request({ method: "eth_getCode", params: [address, "latest"] })) as Hex) ?? "0x";
    },
    async getStorageAt(address: Address, slot: Hex, block?: BlockSelector) {
      return (await request({ method: "eth_getStorageAt", params: [address, slot, blockTag(block)] })) as Hex;
    },
    async call(req) {
      const tx: Record<string, string> = { to: req.to, data: req.data };
      if (req.from) tx.from = req.from;
      if (req.value && req.value > 0n) tx.value = numberToHex(req.value);
      return (await request({ method: "eth_call", params: [tx, blockTag(req.block)] })) as Hex;
    },
    async estimateGas(req) {
      const tx: Record<string, string> = { to: req.to, data: req.data };
      if (req.from) tx.from = req.from;
      if (req.value && req.value > 0n) tx.value = numberToHex(req.value);
      return BigInt((await request({ method: "eth_estimateGas", params: [tx] })) as Hex);
    },
    async blockNumber() {
      return BigInt((await request({ method: "eth_blockNumber", params: [] })) as Hex);
    },
    async getLogs(req): Promise<RawLog[]> {
      // PBA-L3c-039: bounded before the client is touched (one address, explicit range, capped span and topics).
      assertLogRequest(req);
      const filter: Record<string, unknown> = { address: req.address, fromBlock: numberToHex(req.fromBlock), toBlock: numberToHex(req.toBlock) };
      if (req.topics) filter.topics = req.topics;
      const logs = (await request({ method: "eth_getLogs", params: [filter] })) as RpcLog[];
      return logs.map((l) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: l.blockNumber ? BigInt(l.blockNumber) : null,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex ? Number(BigInt(l.logIndex)) : null,
      }));
    },
  };
}
