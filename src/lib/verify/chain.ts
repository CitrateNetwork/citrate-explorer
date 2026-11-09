/**
 * The chain reads verification needs (EXP-S2), behind one interface so the worker,
 * the web routes and the tests share the same code path.
 *
 * Data source (Rule 7): the Citrate JSON-RPC at NEXT_PUBLIC_CITRATE_RPC_URL
 * (eth_getCode, eth_getTransactionByHash, eth_getTransactionReceipt,
 * eth_getStorageAt, eth_call, eth_getBlockByNumber(0) for the genesis hash).
 * Tests construct a reader over recorded anvil state (see __fixtures__/tools).
 */
import type { PublicClient } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { citrateRequest } from "@/lib/citrate/rpc";
import { CITRATE_CHAIN_ID } from "@/lib/citrate/chain";

export interface ChainTx {
  hash: string;
  from: string;
  /** null for a contract-creation transaction. */
  to: string | null;
  input: string;
  blockNumber: string | null;
}

export interface ChainReceipt {
  contractAddress: string | null;
  status: string | null;
  blockNumber: string | null;
}

export interface ChainReader {
  readonly chainId: number;
  /** Block 0's hash; tells a rerolled chain from the one before it (same chain id). */
  genesisHash(): Promise<string>;
  /** Runtime code, "0x" when the address has none. */
  getCode(address: string): Promise<string>;
  getTransaction(hash: string): Promise<ChainTx | null>;
  getReceipt(hash: string): Promise<ChainReceipt | null>;
  getStorageAt(address: string, slot: string): Promise<string>;
  call(to: string, data: string): Promise<string>;
}

const GENESIS_TTL_MS = 60_000;

/** The live Citrate RPC. The genesis hash is cached per instance for a minute. */
export function liveChainReader(client: PublicClient = harnessClient()): ChainReader {
  let genesis: { hash: string; at: number } | null = null;
  return {
    chainId: CITRATE_CHAIN_ID,
    async genesisHash() {
      if (genesis && Date.now() - genesis.at < GENESIS_TTL_MS) return genesis.hash;
      const b = await citrateRequest<{ hash?: string } | null>(client, "eth_getBlockByNumber", ["0x0", false]);
      if (!b?.hash) throw new Error("the RPC returned no block 0");
      genesis = { hash: b.hash.toLowerCase(), at: Date.now() };
      return genesis.hash;
    },
    async getCode(address) {
      const code = await citrateRequest<string | null>(client, "eth_getCode", [address, "latest"]);
      return (code ?? "0x").toLowerCase();
    },
    async getTransaction(hash) {
      const tx = await citrateRequest<ChainTx | null>(client, "eth_getTransactionByHash", [hash]);
      if (!tx) return null;
      return {
        hash: tx.hash.toLowerCase(),
        from: tx.from.toLowerCase(),
        to: tx.to ? tx.to.toLowerCase() : null,
        input: (tx.input ?? "0x").toLowerCase(),
        blockNumber: tx.blockNumber ?? null,
      };
    },
    async getReceipt(hash) {
      const r = await citrateRequest<ChainReceipt | null>(client, "eth_getTransactionReceipt", [hash]);
      if (!r) return null;
      return {
        contractAddress: r.contractAddress ? r.contractAddress.toLowerCase() : null,
        status: r.status ?? null,
        blockNumber: r.blockNumber ?? null,
      };
    },
    async getStorageAt(address, slot) {
      return (await citrateRequest<string>(client, "eth_getStorageAt", [address, slot, "latest"])).toLowerCase();
    },
    async call(to, data) {
      return (await citrateRequest<string>(client, "eth_call", [{ to, data }, "latest"])).toLowerCase();
    },
  };
}
