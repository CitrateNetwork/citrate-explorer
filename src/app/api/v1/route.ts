import type { Address, Hex } from "viem";
import { getChainStatus, getAddress, getBalance, getTransaction, getLogs, readContract } from "@/lib/harness/ops";
import { harnessClient } from "@/lib/harness/client";
import { citrateRequest } from "@/lib/citrate/rpc";
import { isReadMethodAllowed } from "@/lib/harness/allowlist";
import { erc20Abi } from "@/lib/citrate/abi";
import { searchTransactions } from "@/lib/indexer/repository";
import { validateApiKey, extractApiKey, clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";

/**
 * Etherscan-compatible REST surface: `/api/v1?module=&action=&...&apikey=`.
 * Envelope `{status, message, result}` (proxy module returns the raw JSON-RPC
 * envelope) so existing tooling works against CitrateScan. Key-gated + rate
 * limited (P-7). Index-dependent actions degrade honestly when the indexer/DB
 * isn't provisioned. (See EXPLORER_SPEC.md §3.)
 */
const ok = (result: unknown, message = "OK") => Response.json({ status: "1", message, result });
const noData = (message = "No records found") => Response.json({ status: "0", message, result: [] });
const fail = (message: string) => Response.json({ status: "0", message, result: null });
const rpcOk = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });
const rpcErr = (message: string) => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32600, message } });

export async function GET(req: Request) {
  // Key + rate limit.
  const check = await validateApiKey(extractApiKey(req), clientIp(req));
  if (check.id.startsWith("bad:")) return fail("Invalid API Key");
  const rl = await checkRateLimit(check.id, check.perSec || 2);
  if (!rl.ok) {
    return Response.json(
      { status: "0", message: "Max rate limit reached", result: null },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 1) } },
    );
  }

  const p = new URL(req.url).searchParams;
  const mod = (p.get("module") || "").toLowerCase();
  const action = p.get("action") || "";

  try {
    // ---- proxy: JSON-RPC passthrough (allowlisted read methods) ----
    if (mod === "proxy") {
      if (!isReadMethodAllowed(action)) return rpcErr(`method ${action} not allowed`);
      const params = buildProxyParams(action, p);
      const result = await citrateRequest(harnessClient(), action, params);
      return rpcOk(result);
    }

    // ---- account ----
    if (mod === "account") {
      if (action === "balance") {
        const a = p.get("address");
        if (!isAddr(a)) return fail("invalid address");
        return ok((await getAddress(a as Address)).balanceWei);
      }
      if (action === "balancemulti") {
        const addrs = (p.get("address") || "").split(",").filter(isAddr).slice(0, 20);
        const out = await Promise.all(addrs.map(async (a) => ({ account: a, balance: (await getBalance(a as Address)).balance.grains })));
        return ok(out);
      }
      if (action === "txlist") {
        const a = p.get("address");
        if (!isAddr(a)) return fail("invalid address");
        const res = await searchTransactions(a as Address, 100);
        if (!("provisioned" in res) || res.provisioned === false) return noData("No transactions found (indexer not provisioned)");
        return ((res as { results: unknown[] }).results.length ? ok((res as { results: unknown[] }).results) : noData("No transactions found"));
      }
      if (action === "txlistinternal") return noData("No internal transactions found (indexing in P-2+)");
      if (action === "tokentx" || action === "tokennfttx") return noData("No token transfers found (token indexing pending)");
      if (action === "getminedblocks") return noData("Not tracked");
    }

    // ---- transaction ----
    if (mod === "transaction") {
      const hash = p.get("txhash");
      if (!isHash(hash)) return fail("invalid txhash");
      const tx = await getTransaction(hash as Hex);
      if (action === "gettxreceiptstatus") return ok({ status: tx.status === "success" ? "1" : tx.status === "reverted" ? "0" : "" });
      if (action === "getstatus") return ok({ isError: tx.status === "reverted" ? "1" : "0", errDescription: tx.status === "reverted" ? "Reverted" : "" });
    }

    // ---- block ----
    if (mod === "block") {
      if (action === "getblockcountdown") return fail("Finality on Citrate is depth-based, not a countdown — use citrate_getDagStats");
      if (action === "getblocknobytime") return fail("Block-by-timestamp needs the indexer (pending)");
      if (action === "getblockreward") return fail("No block-reward model exposed by this network");
    }

    // ---- logs ----
    if (mod === "logs" && action === "getLogs") {
      const address = p.get("address");
      const fromBlock = p.get("fromBlock");
      const toBlock = p.get("toBlock");
      const logs = await getLogs({
        address: isAddr(address) ? (address as Address) : undefined,
        fromBlock: fromBlock && fromBlock !== "latest" ? BigInt(fromBlock) : undefined,
        toBlock: toBlock && toBlock !== "latest" ? BigInt(toBlock) : undefined,
      });
      return logs.length ? ok(logs) : noData("No logs found");
    }

    // ---- stats ----
    if (mod === "stats") {
      if (action === "tokensupply") {
        const c = p.get("contractaddress");
        if (!isAddr(c)) return fail("invalid contractaddress");
        const supply = await readContract({ address: c as Address, abi: erc20Abi as never, functionName: "totalSupply" });
        return ok(String(supply));
      }
      if (action === "ethsupply" || action === "saltsupply") return fail("Total SALT supply is not exposed via a single RPC call");
    }

    // ---- gastracker ----
    if (mod === "gastracker" && action === "gasoracle") {
      const s = await getChainStatus();
      const gwei = (Number(s.gasPriceWei) / 1e9).toString();
      return ok({ LastBlock: s.blockNumber, SafeGasPrice: gwei, ProposeGasPrice: gwei, FastGasPrice: gwei, suggestBaseFee: gwei });
    }

    return fail(`Unsupported or not-yet-implemented module/action: ${mod}/${action}`);
  } catch (err) {
    return fail((err as Error).message);
  }
}

function isAddr(a: string | null): a is string {
  return !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
}
function isHash(h: string | null): h is string {
  return !!h && /^0x[0-9a-fA-F]{64}$/.test(h);
}

/** Map Etherscan proxy query params to JSON-RPC positional params. */
function buildProxyParams(method: string, p: URLSearchParams): unknown[] {
  const raw = p.get("params");
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  const tag = p.get("tag") || "latest";
  switch (method) {
    case "eth_blockNumber":
    case "eth_gasPrice":
    case "eth_chainId":
      return [];
    case "eth_getBlockByNumber":
      return [p.get("tag") || "latest", p.get("boolean") === "true"];
    case "eth_getBlockByHash":
      return [p.get("blockhash"), p.get("boolean") === "true"];
    case "eth_getTransactionByHash":
    case "eth_getTransactionReceipt":
      return [p.get("txhash")];
    case "eth_getBalance":
    case "eth_getCode":
    case "eth_getTransactionCount":
      return [p.get("address"), tag];
    case "eth_getStorageAt":
      return [p.get("address"), p.get("position") || "0x0", tag];
    case "eth_call":
      return [{ to: p.get("to"), data: p.get("data") }, tag];
    case "eth_estimateGas":
      return [{ to: p.get("to"), data: p.get("data"), value: p.get("value") || undefined }];
    default:
      return [];
  }
}
