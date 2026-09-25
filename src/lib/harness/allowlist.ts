/**
 * Read-only RPC method allowlist (deny-by-default). The harness can ONLY perform
 * these; any write/sign/account method is explicitly forbidden and unreachable.
 * See DESIGN_HARNESS_AND_SETTINGS.md §A2.
 */
import { checkProxyGetLogs } from "./logBounds";

export const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_estimateGas",
  "eth_getLogs",
  "eth_getTransactionCount",
  "net_version",
  "web3_clientVersion",
  // Citrate DAG + AI read methods:
  "citrate_getDagStats",
  "citrate_semanticSearch",
  "citrate_getTextEmbedding",
]);

/** Never reachable — write, signing, account, or node-admin methods. */
export const FORBIDDEN_RPC_METHODS: ReadonlySet<string> = new Set([
  "eth_sendRawTransaction",
  "eth_sendTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "personal_sign",
  "personal_unlockAccount",
  "eth_accounts",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
]);

export function isReadMethodAllowed(method: string): boolean {
  if (FORBIDDEN_RPC_METHODS.has(method)) return false;
  return ALLOWED_RPC_METHODS.has(method);
}

export type ProxyCallCheck = { ok: true; params: unknown[] } | { ok: false; code: number; error: string };

/**
 * Single chokepoint for a raw JSON-RPC passthrough (`/api/v1?module=proxy`).
 * Deny-by-default on the method, then per-method parameter bounds: an allowlisted
 * READ method can still be an amplification vector (PBA-L3c-039: `eth_getLogs`
 * with earliest..latest and no address scans the whole chain). Every
 * dynamic-method `citrateRequest` call site must go through here (source tripwire
 * in getlogs-entrypoints.test.ts).
 */
export function guardProxyCall(method: string, params: unknown): ProxyCallCheck {
  if (!isReadMethodAllowed(method)) return { ok: false, code: -32601, error: `method ${method} not allowed` };
  if (!Array.isArray(params)) return { ok: false, code: -32602, error: "params must be an array" };
  if (method === "eth_getLogs") {
    const checked = checkProxyGetLogs(params);
    return checked.ok ? { ok: true, params: checked.params } : { ok: false, code: -32602, error: checked.error };
  }
  return { ok: true, params };
}
