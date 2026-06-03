/**
 * AI SDK v6 tool definitions for "Ask CitrateScan". These wrap the read-only
 * harness ops (src/lib/harness/ops.ts), the indexer repository, and the
 * explainTransaction synthesis so the model works from on-chain ground truth
 * (Rule 11 — never fabricated). All tools are READ-ONLY; there is no write/sign
 * tool by construction.
 *
 * Every invocation is recorded to the audit_log (WP-1.6) for the transparency
 * panel, scoped to the authenticated user when present.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Address, Hex } from "viem";
import {
  getChainStatus,
  getBlock,
  getTransaction,
  getAddress,
  getBalance,
  getLogs,
  exploreDag,
  dagOverview,
  isContract,
} from "@/lib/harness/ops";
import { explainTransaction } from "@/lib/ai/synthesis/explainTransaction";
import {
  searchTransactions,
  addressActivity,
  topHolders,
} from "@/lib/indexer/repository";
import { logToolCall } from "./audit";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hash");

export interface ToolOptions {
  /** Authenticated wallet address, for per-user audit scoping. */
  userAddress?: string;
}

export function citrateTools(opts: ToolOptions = {}) {
  // Wraps a tool's execute fn to record the call before running it.
  const audited =
    <A>(name: string, run: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      await logToolCall(name, args, opts.userAddress);
      return run(args);
    };

  return {
    getChainStatus: tool({
      description:
        "Get live chain status: chain id, latest block number, and gas price.",
      inputSchema: z.object({}),
      execute: audited("getChainStatus", async () => getChainStatus()),
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
      execute: audited("getBlock", async ({ ref }: { ref: string }) => {
        const r =
          ref === "latest" ? "latest" : ref.startsWith("0x") ? (ref as Hex) : Number(ref);
        return getBlock(r);
      }),
    }),
    getTransaction: tool({
      description:
        "Fetch a transaction and its receipt by hash. Use before explaining a tx.",
      inputSchema: z.object({ hash: hashSchema }),
      execute: audited("getTransaction", async ({ hash }: { hash: string }) =>
        getTransaction(hash as Hex),
      ),
    }),
    explainTransaction: tool({
      description:
        "Fetch a tx plus its decoded events (ERC-20/721 transfers, approvals) as a " +
        "structured bundle to narrate a plain-English 'what happened'. Use facts " +
        "from the result only.",
      inputSchema: z.object({ hash: hashSchema }),
      execute: audited("explainTransaction", async ({ hash }: { hash: string }) =>
        explainTransaction(hash as Hex),
      ),
    }),
    getAddress: tool({
      description:
        "Get an address's SALT balance, nonce, and whether it is a contract.",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("getAddress", async ({ address }: { address: string }) =>
        getAddress(address as Address),
      ),
    }),
    getBalance: tool({
      description:
        "Get an address's SALT balance (dual-unit: SALT + raw grains/wei).",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("getBalance", async ({ address }: { address: string }) =>
        getBalance(address as Address),
      ),
    }),
    isContract: tool({
      description: "Check whether an address holds contract bytecode.",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("isContract", async ({ address }: { address: string }) => ({
        address,
        isContract: await isContract(address as Address),
      })),
    }),
    getLogs: tool({
      description:
        "Fetch event logs, optionally filtered by contract address and block range.",
      inputSchema: z.object({
        address: addressSchema.optional(),
        fromBlock: z.number().int().optional(),
        toBlock: z.number().int().optional(),
      }),
      execute: audited(
        "getLogs",
        async ({
          address,
          fromBlock,
          toBlock,
        }: {
          address?: string;
          fromBlock?: number;
          toBlock?: number;
        }) =>
          getLogs({
            address: address as Address | undefined,
            fromBlock: fromBlock !== undefined ? BigInt(fromBlock) : undefined,
            toBlock: toBlock !== undefined ? BigInt(toBlock) : undefined,
          }),
      ),
    }),
    exploreDag: tool({
      description:
        "Explore GHOSTDAG topology. With no blockHash: the overview (tips, blue/red, " +
        "max blue score, finality params). With a blockHash: that block's selected-parent " +
        "ancestor chain, its merge parents, and whether it is finalized.",
      inputSchema: z.object({
        blockHash: hashSchema.optional().describe("optional 0x block hash to walk"),
      }),
      execute: audited("exploreDag", async ({ blockHash }: { blockHash?: string }) =>
        blockHash ? exploreDag(blockHash as Hex, 10) : dagOverview(),
      ),
    }),
    searchTransactions: tool({
      description:
        "Search indexed transactions by address (from/to). Requires the indexer; returns a note if not provisioned.",
      inputSchema: z.object({
        address: addressSchema,
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: audited(
        "searchTransactions",
        async ({ address, limit }: { address: string; limit: number }) =>
          searchTransactions(address as Address, limit),
      ),
    }),
    addressActivity: tool({
      description:
        "Summarize an address's recent activity (tx counts, first/last seen) from the index.",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("addressActivity", async ({ address }: { address: string }) =>
        addressActivity(address as Address),
      ),
    }),
    topHolders: tool({
      description:
        "List top holders of a token from indexed transfers. Requires the indexer.",
      inputSchema: z.object({
        token: addressSchema,
        limit: z.number().int().min(1).max(100).default(10),
      }),
      execute: audited(
        "topHolders",
        async ({ token, limit }: { token: string; limit: number }) =>
          topHolders(token as Address, limit),
      ),
    }),
  };
}
