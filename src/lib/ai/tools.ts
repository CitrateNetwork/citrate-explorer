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
  getContractCode,
  getToken,
  getGasOracle,
  saltDistribution,
  callView,
  addressActivityLive,
} from "@/lib/harness/ops";
import { explainTransaction } from "@/lib/ai/synthesis/explainTransaction";
import {
  searchTransactions,
  addressActivity,
  topHolders,
  findNativeTransfers,
  findTokenTransfers,
  type NativeTransferQuery,
  type TokenTransferQuery,
} from "@/lib/indexer/repository";
import { resolveAmount, resolveTimeRange, amountRange } from "@/lib/research/resolvers";
import { logToolCall } from "./audit";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hash");

export interface ToolOptions {
  /** Authenticated owner (stable OIDC `subject`), for per-user audit scoping. */
  subject?: string;
}

export function citrateTools(opts: ToolOptions = {}) {
  // Wraps a tool's execute fn to record the call before running it.
  const audited =
    <A>(name: string, run: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      await logToolCall(name, args, opts.subject);
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
        "Fetch a tx + its decoded transfers/approvals as a structured bundle to narrate " +
        "'what happened'. Use its facts only.",
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
        "GHOSTDAG topology. No blockHash → overview (tips, blue/red, finality params); " +
        "with a blockHash → its selected-parent chain, merge parents, and finalized?.",
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
        limit: z.number().int().min(1).max(100).default(10),
      }),
      execute: audited(
        "searchTransactions",
        async ({ address, limit }: { address: string; limit: number }) =>
          searchTransactions(address as Address, limit),
      ),
    }),
    addressActivity: tool({
      description:
        "Summarize an address's activity (sent/received). Indexed when available, else a live recent-block scan.",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("addressActivity", async ({ address }: { address: string }) => {
        const indexed = await addressActivity(address as Address);
        if (indexed && (indexed as { provisioned?: boolean }).provisioned === false) {
          return addressActivityLive(address as Address);
        }
        return indexed;
      }),
    }),
    recentActivity: tool({
      description:
        "Forensic: scan the last N blocks for txs involving an address (direction + labeled counterparties). " +
        "Index-free, recent-window only. Use to trace recent movement around an address.",
      inputSchema: z.object({
        address: addressSchema,
        blocks: z.number().int().min(1).max(300).default(60),
      }),
      execute: audited(
        "recentActivity",
        async ({ address, blocks }: { address: string; blocks: number }) =>
          addressActivityLive(address as Address, blocks),
      ),
    }),
    topHolders: tool({
      description:
        "Top holders of an ERC-20/721 TOKEN from the index (NOT for SALT — use saltDistribution).",
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
    getContractCode: tool({
      description:
        "A contract's bytecode: size, code hash, raw bytecode; confirms contract vs EOA. Source needs verification.",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("getContractCode", async ({ address }: { address: string }) =>
        getContractCode(address as Address),
      ),
    }),
    getToken: tool({
      description:
        "Token metadata (ERC-20/721): name, symbol, decimals, supply, + optional holder balance.",
      inputSchema: z.object({
        address: addressSchema,
        holder: addressSchema.optional().describe("optional address to also read the balance of"),
      }),
      execute: audited("getToken", async ({ address, holder }: { address: string; holder?: string }) =>
        getToken(address as Address, holder as Address | undefined),
      ),
    }),
    callView: tool({
      description:
        "Read ANY view/pure function by Solidity signature, e.g. \"function getModel(bytes32) view returns " +
        "(address,string,uint256)\", plus args. The forensic contract-state read. Read-only.",
      inputSchema: z.object({
        address: addressSchema,
        signature: z.string().describe("full Solidity function signature"),
        args: z.array(z.union([z.string(), z.number(), z.boolean()])).default([]),
      }),
      execute: audited(
        "callView",
        async ({ address, signature, args }: { address: string; signature: string; args: unknown[] }) =>
          callView(address as Address, signature, args),
      ),
    }),
    getGasOracle: tool({
      description:
        "Current gas price + reference cost estimates for common ops. Use for 'how much does X cost'.",
      inputSchema: z.object({}),
      execute: audited("getGasOracle", async () => getGasOracle()),
    }),
    findTransfers: tool({
      description:
        "Find transfers by AMOUNT/TIME/counterparty WITHOUT a tx hash ('when was 30k SALT sent', " +
        "'biggest transfers last week', 'did 0x… send >10k'). amount is a phrase ('30k SALT'); comparator " +
        "about(±1%,default)|atleast|atmost|exact; since is a time phrase. Native SALT by default — pass a " +
        "token address for a token (amounts in its units). Say WHICH asset; honor the coverage window.",
      inputSchema: z.object({
        amount: z.string().optional().describe("human amount, e.g. '30k SALT' or '0.5 SALT'"),
        comparator: z.enum(["about", "atleast", "atmost", "exact"]).optional().default("about"),
        since: z.string().optional().describe("time phrase, e.g. 'last week', 'last 24 hours', '2026-06-01'"),
        address: addressSchema.optional().describe("a counterparty to filter by"),
        direction: z.enum(["sent", "received", "either"]).optional().default("either"),
        order: z.enum(["biggest", "smallest", "recent"]).optional().default("biggest"),
        limit: z.number().int().min(1).max(100).optional().default(10),
        token: addressSchema.optional().describe("an ERC-20/721/1155 token address; omit for native SALT"),
      }),
      execute: audited(
        "findTransfers",
        async (args: {
          amount?: string;
          comparator: "about" | "atleast" | "atmost" | "exact";
          since?: string;
          address?: string;
          direction: "sent" | "received" | "either";
          order: "biggest" | "smallest" | "recent";
          limit: number;
          token?: string;
        }) => {
          const order: NativeTransferQuery["order"] =
            args.order === "smallest" ? "value_asc" : args.order === "recent" ? "time_desc" : "value_desc";

          // Token transfers (RA-3): convert the human amount with the token's own
          // decimals, query token_transfers, and label with the token's identity (X-3).
          if (args.token) {
            const meta = await getToken(args.token as Address);
            const tq: TokenTransferQuery = { token: args.token, limit: args.limit, order };
            if (args.amount) {
              const a = resolveAmount(args.amount, meta.decimals ?? 18);
              if (!a.ok) return { error: `I couldn't read the amount "${args.amount}": ${a.error}` };
              const range = amountRange(a.grains, args.comparator);
              tq.minRaw = range.minGrains;
              tq.maxRaw = range.maxGrains;
            }
            if (args.since) {
              const tr = resolveTimeRange(args.since, Math.floor(Date.now() / 1000));
              if (!tr.ok) return { error: `I couldn't read the time range "${args.since}": ${tr.error}` };
              tq.fromTs = tr.fromTs;
              tq.toTs = tr.toTs;
            }
            if (args.address) {
              tq.counterparty = args.address;
              tq.direction = args.direction;
            }
            const res = await findTokenTransfers(tq);
            return {
              token: { address: args.token, symbol: meta.symbol, decimals: meta.decimals, standard: meta.standard, label: meta.label },
              decimalsNote: meta.decimals == null ? "token decimals unknown — amounts are raw base units" : undefined,
              ...res,
            };
          }

          const q: NativeTransferQuery = { limit: args.limit, order };
          if (args.amount) {
            const a = resolveAmount(args.amount);
            if (!a.ok) return { error: `I couldn't read the amount "${args.amount}": ${a.error}` };
            Object.assign(q, amountRange(a.grains, args.comparator));
          }
          if (args.since) {
            const tr = resolveTimeRange(args.since, Math.floor(Date.now() / 1000));
            if (!tr.ok) return { error: `I couldn't read the time range "${args.since}": ${tr.error}` };
            q.fromTs = tr.fromTs;
            q.toTs = tr.toTs;
          }
          if (args.address) {
            q.counterparty = args.address;
            q.direction = args.direction;
          }
          return findNativeTransfers(q);
        },
      ),
    }),
    saltDistribution: tool({
      description:
        "Top SALT holders — known genesis allocations with LIVE balances, biggest first. SALT is native " +
        "(no Transfer events); a full all-address leaderboard needs a balance indexer. Use for 'richest / " +
        "top SALT holders'.",
      inputSchema: z.object({}),
      execute: audited("saltDistribution", async () => saltDistribution()),
    }),
    ledger: tool({
      description:
        "Exact accounting calculator. Pass line items (label + salt or grains, negative for debits) → exact " +
        "totals. Use instead of doing math yourself; re-send items to keep a running tab.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              label: z.string(),
              salt: z.string().optional().describe("amount in SALT, e.g. '1.5' or '-0.2'"),
              grains: z.string().optional().describe("amount in raw grains/wei (exact integer)"),
            }),
          )
          .describe("the line items to total"),
      }),
      execute: audited("ledger", async ({ items }: { items: { label: string; salt?: string; grains?: string }[] }) =>
        runLedger(items),
      ),
    }),
  };
}

/** Pure, exact accounting in grains (wei) so the agent never fat-fingers math. */
export function runLedger(items: { label: string; salt?: string; grains?: string }[]) {
  const toGrains = (it: { salt?: string; grains?: string }): bigint => {
    if (it.grains != null && it.grains !== "") return BigInt(it.grains);
    if (it.salt != null && it.salt !== "") {
      const neg = it.salt.trim().startsWith("-");
      const [w, f = ""] = it.salt.replace("-", "").split(".");
      const frac = (f + "0".repeat(18)).slice(0, 18);
      const g = BigInt(w || "0") * 10n ** 18n + BigInt(frac || "0");
      return neg ? -g : g;
    }
    return 0n;
  };
  const lines = items.map((it) => {
    const grains = toGrains(it);
    return { label: it.label, salt: formatSaltStr(grains), grains: grains.toString() };
  });
  const total = lines.reduce((a, l) => a + BigInt(l.grains), 0n);
  return { lines, totalSalt: formatSaltStr(total), totalGrains: total.toString() };
}

function formatSaltStr(grains: bigint): string {
  const neg = grains < 0n;
  const g = neg ? -grains : grains;
  const whole = g / 10n ** 18n;
  const frac = (g % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
