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
        "Summarize an address's activity. Uses the indexer when provisioned; otherwise FALLS BACK to a " +
        "live scan of recent blocks (forensic, recent-window) so you can investigate any address even " +
        "without the index.",
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
        "Forensic: scan the last N blocks of live RPC for transactions directly involving an address " +
        "(sender/recipient), with direction + labeled counterparties. Index-free; recent-window only " +
        "(no internal transfers or old history). Use to trace recent on-chain movement around an address.",
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
        "List top holders of an ERC-20/721 TOKEN from indexed transfers. Requires the indexer. " +
        "NOTE: SALT is the native coin, not a token — for 'who holds the most SALT' use saltDistribution.",
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
        "Get a contract's deployed bytecode: size, keccak code hash, and the raw bytecode. " +
        "Confirms whether an address is a contract or an EOA. Source code needs verification (not yet wired).",
      inputSchema: z.object({ address: addressSchema }),
      execute: audited("getContractCode", async ({ address }: { address: string }) =>
        getContractCode(address as Address),
      ),
    }),
    getToken: tool({
      description:
        "Read token metadata (auto-detects ERC-20 vs ERC-721): name, symbol, decimals, total supply, " +
        "and optionally a holder's balance. Use for any token contract.",
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
        "Read ANY view/pure function on a contract by its Solidity signature — the forensic read tool. " +
        "Provide the full signature, e.g. \"function getModel(bytes32) view returns (address,string,uint256)\" " +
        "or \"balanceOf(address)\", plus args. Read-only; the node rejects non-view calls.",
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
        "Current gas price (wei + gwei) and reference cost estimates for common operations (transfer, " +
        "ERC-20, contract call, deploy), dual-unit. Use to answer 'how much does X cost'.",
      inputSchema: z.object({}),
      execute: audited("getGasOracle", async () => getGasOracle()),
    }),
    findTransfers: tool({
      description:
        "Find native SALT transfers by AMOUNT, TIME, and counterparty — WITHOUT a tx hash. Use for " +
        "'when was 30k SALT sent', 'biggest SALT transfers last week', 'did 0x… send more than 10k SALT'. " +
        "`amount` is a human phrase ('30k SALT', '0.5 SALT'); `comparator` says how to match it " +
        "(about = ±1%, the default; atleast; atmost; exact). `since` is a time phrase ('last week', " +
        "'last 24 hours', or a YYYY-MM-DD). `address`+`direction` filter by sender/recipient. Results are " +
        "NATIVE SALT — always say so. The result includes the index `coverage` window; if the answer might " +
        "be outside it, say so rather than implying 'none exist'. Pass `token` (a 0x address) to search that " +
        "ERC-20/721/1155 token's transfers instead — amounts are then in that token's units and the result is " +
        "labeled with the token's symbol (say WHICH token, never conflate it with native SALT).",
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
        "Who holds the most SALT: SALT is the NATIVE coin (no Transfer events), so this returns the known " +
        "genesis allocations with their LIVE balances, biggest first, and explains that a full all-address " +
        "leaderboard needs a balance indexer. Use this for any 'top SALT holders' / 'richest address' question.",
      inputSchema: z.object({}),
      execute: audited("saltDistribution", async () => saltDistribution()),
    }),
    ledger: tool({
      description:
        "A precise running tab / accounting calculator. Pass the line items you've gathered (label + a SALT or " +
        "grains amount, negative for debits) and it returns the exact totals in dual units — use this instead of " +
        "doing arithmetic yourself, and re-send the accumulated items to keep a running total across the chat.",
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
