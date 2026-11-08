/**
 * An in-memory ChainReader for the contract-kit tests. Test-only: imported from
 * *.test.ts files and never from production code.
 */
import { pad, type Address, type Hex } from "viem";
import type { BlockSelector, ChainReader, RawLog } from "./types";

export interface MemoryChain {
  code?: Record<string, Hex>;
  storage?: Record<string, Record<string, Hex>>;
  /** (to, calldata prefix) -> return data, or an Error to throw. */
  calls?: Array<{ to: string; data: string; from?: string; result: Hex | Error }>;
  logs?: RawLog[];
  head?: bigint;
  gas?: bigint | Error;
  historical?: boolean;
}

const lc = (a: string) => a.toLowerCase();

export function memoryReader(chain: MemoryChain): ChainReader & { getLogsCalls: Array<[bigint, bigint]> } {
  const getLogsCalls: Array<[bigint, bigint]> = [];
  const checkBlock = (block?: BlockSelector) => {
    if (block !== undefined && block !== "latest" && !chain.historical) {
      throw new Error(`historical state not available on this node: block ${block} is below the executed head`);
    }
  };
  return {
    chainId: 40204,
    getLogsCalls,
    async getCode(address: Address) {
      return chain.code?.[lc(address)] ?? "0x";
    },
    async getStorageAt(address: Address, slot: Hex, block?: BlockSelector) {
      checkBlock(block);
      return chain.storage?.[lc(address)]?.[lc(slot)] ?? pad("0x0", { size: 32 });
    },
    async call(req) {
      checkBlock(req.block);
      const hit = chain.calls?.find(
        (c) => lc(c.to) === lc(req.to) && lc(req.data).startsWith(lc(c.data)) && (!c.from || lc(c.from) === lc(req.from ?? "")),
      );
      if (!hit) {
        const e = new Error("execution reverted");
        (e as { data?: Hex }).data = "0x";
        throw e;
      }
      if (hit.result instanceof Error) throw hit.result;
      return hit.result;
    },
    async estimateGas() {
      if (chain.gas instanceof Error) throw chain.gas;
      return chain.gas ?? 50_000n;
    },
    async blockNumber() {
      return chain.head ?? 5_000n;
    },
    async getLogs(req) {
      if (req.toBlock - req.fromBlock + 1n > 1000n) throw new Error("eth_getLogs range too large");
      getLogsCalls.push([req.fromBlock, req.toBlock]);
      return (chain.logs ?? []).filter(
        (l) =>
          lc(l.address) === lc(req.address) &&
          l.blockNumber !== null &&
          l.blockNumber >= req.fromBlock &&
          l.blockNumber <= req.toBlock &&
          (!req.topics || req.topics.every((t, i) => t === null || lc(l.topics[i] ?? "") === lc(t))),
      );
    },
  };
}
