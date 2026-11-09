/**
 * Server wiring for the r1007 reads: one batching read-only client, the shared
 * capability probe and the chain-change observer, one of each per instance.
 * SERVER-ONLY.
 *
 * The requester is deny-by-default: it issues only the fixed read methods in
 * LEDGER_RPC_METHODS (header reads, citrate_getDagStats and the five r1007 read
 * methods). No method name ever comes from a request. It is not the public
 * `/api/v1` proxy, whose allowlist (src/lib/harness/allowlist.ts) is unchanged.
 *
 * Data source (Rule 7): live Citrate JSON-RPC via the harness client (read-only,
 * no signer), batched at most 50 calls per POST (the node accepts 100).
 */
import type { PublicClient } from "viem";
import { buildHarnessClient } from "@/lib/harness/client";
import { citrateRequest } from "./rpc";
import { R1007_METHODS, probeR1007Capabilities, type Requester } from "./r1007";
import { makeCapabilityCache } from "./r1007Reads";
import { makeChainFeed } from "./ledger";

export const LEDGER_RPC_METHODS: ReadonlySet<string> = new Set([
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "citrate_getDagStats",
  ...Object.values(R1007_METHODS),
]);

/** Wraps a raw requester so it can issue only LEDGER_RPC_METHODS. */
export function fixedMethodRequester(raw: Requester): Requester {
  return (method, params) => {
    if (!LEDGER_RPC_METHODS.has(method)) return Promise.reject(new Error(`ledger requester: ${method} is not a ledger read`));
    return raw(method, params);
  };
}

let client: PublicClient | undefined;
const batched = () => (client ??= buildHarnessClient({ batchSize: 50 }));

/** Batched JSON-RPC requester for r1007 and header reads (fixed methods only). */
export const r1007Requester: Requester = fixedMethodRequester((method, params) => citrateRequest(batched(), method, params));

const TTL_MS = Math.max(5_000, Number(process.env.CITRATE_R1007_PROBE_TTL_MS ?? 60_000)) || 60_000;

/** Which r1007 methods the node serves, re-probed every minute so an upgrade lights the UI up. */
export const sharedR1007Capabilities = makeCapabilityCache(() => probeR1007Capabilities(r1007Requester), { ttlMs: TTL_MS });

/** Selected-chain changes observed by this instance. */
export const instanceChainFeed = makeChainFeed();
