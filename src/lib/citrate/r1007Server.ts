/**
 * Server wiring for the r1007 reads: one batching read-only client, the shared
 * capability probe and the chain-change observer, one of each per instance.
 * SERVER-ONLY.
 *
 * Data source (Rule 7): live Citrate JSON-RPC via the harness client (read-only,
 * no signer), batched at most 50 calls per POST (the node accepts 100).
 */
import { buildHarnessClient } from "@/lib/harness/client";
import { citrateRequest } from "./rpc";
import { probeR1007Capabilities, type Requester } from "./r1007";
import { makeCapabilityCache } from "./r1007Reads";
import { makeChainFeed } from "./ledger";

const client = buildHarnessClient({ batchSize: 50 });

/** Batched JSON-RPC requester for r1007 and header reads. */
export const r1007Requester: Requester = (method, params) => citrateRequest(client, method, params);

const TTL_MS = Math.max(5_000, Number(process.env.CITRATE_R1007_PROBE_TTL_MS ?? 60_000)) || 60_000;

/** Which r1007 methods the node serves, re-probed every minute so an upgrade lights the UI up. */
export const sharedR1007Capabilities = makeCapabilityCache(() => probeR1007Capabilities(r1007Requester), { ttlMs: TTL_MS });

/** Selected-chain changes observed by this instance. */
export const instanceChainFeed = makeChainFeed();
