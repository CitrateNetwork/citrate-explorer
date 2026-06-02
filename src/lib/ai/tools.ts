/**
 * AI SDK v6 tool definitions for "Ask CitrateScan". These wrap the read-only
 * harness ops (src/lib/harness/ops.ts) and the indexer repository so the model
 * works from on-chain ground truth (Rule 11 — never fabricated). All tools are
 * READ-ONLY; there is no write/sign tool by construction.
 *
 * Optionally records each call to the audit_log for the transparency panel.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Address, Hex } from "viem";
import {
  getChainStatus,
  getBlock,
  getTransaction,
  getAddress,
  getLogs,
  exploreDag,
  isContract,
} from "@/lib/harness/ops";
import {
  searchTransactions,
  addressActivity,
  topHolders,
} from "@/lib/indexer/repository";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hash");

export function citrateTools() {
  return {
    getChainStatus: tool({
      description:
        "Get live chain status: chain id, latest block number, and gas price.",
      inputSchema: z.object({}),
      execute: async () => getChainStatus(),
    }),
    getBlock: tool({
      description:
        "Fetch a block by height (number) or hash, or 'latest'. Returns a summary.",
      inputSchema: z.object({
        ref: z
          .string()
          .describe("a block height, a 0x block hash, or 'latest'")
          .default("latest"),
      }),
      execute: async ({ ref }) => {
        const r =
          ref === "latest"
            ? "latest"
            : ref.startsWith("0x")
              ? (ref as Hex)
              : Number(ref);
        return getBlock(r);
      },
    }),
    getTransaction: tool({
      description:
        "Fetch a transaction and its receipt by hash. Use this before explaining a tx.",
      inputSchema: z.object({ hash: hashSchema }),
      execute: async ({ hash }) => getTransaction(hash as Hex),
    }),
    getAddress: tool({
      description:
        "Get an address's SALT balance, nonce, and whether it is a contract.",
      inputSchema: z.object({ address: addressSchema }),
      execute: async ({ address }) => getAddress(address as Address),
    }),
    isContract: tool({
      description: "Check whether an address holds contract bytecode.",
      inputSchema: z.object({ address: addressSchema }),
      execute: async ({ address }) => ({
        address,
        isContract: await isContract(address as Address),
      }),
    }),
    getLogs: tool({
      description:
        "Fetch event logs, optionally filtered by contract address and block range.",
      inputSchema: z.object({
        address: addressSchema.optional(),
        fromBlock: z.number().int().optional(),
        toBlock: z.number().int().optional(),
      }),
      execute: async ({ address, fromBlock, toBlock }) =>
        getLogs({
          address: address as Address | undefined,
          fromBlock: fromBlock !== undefined ? BigInt(fromBlock) : undefined,
          toBlock: toBlock !== undefined ? BigInt(toBlock) : undefined,
        }),
    }),
    exploreDag: tool({
      description:
        "Get GHOSTDAG topology: current tips, blue/red counts, max blue score, and finality params.",
      inputSchema: z.object({}),
      execute: async () => exploreDag(),
    }),
    searchTransactions: tool({
      description:
        "Search indexed transactions by address (from/to). Requires the indexer; returns a note if not provisioned.",
      inputSchema: z.object({
        address: addressSchema,
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: async ({ address, limit }) =>
        searchTransactions(address as Address, limit),
    }),
    addressActivity: tool({
      description:
        "Summarize an address's recent activity (tx counts, first/last seen) from the index.",
      inputSchema: z.object({ address: addressSchema }),
      execute: async ({ address }) => addressActivity(address as Address),
    }),
    topHolders: tool({
      description:
        "List top holders of a token from indexed transfers. Requires the indexer.",
      inputSchema: z.object({
        token: addressSchema,
        limit: z.number().int().min(1).max(100).default(10),
      }),
      execute: async ({ token, limit }) => topHolders(token as Address, limit),
    }),
  };
}
