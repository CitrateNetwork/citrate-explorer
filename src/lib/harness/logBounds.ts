/**
 * Bounds for every path that can reach `eth_getLogs` (EX-B-004, PBA-L3c-039).
 *
 * An unbounded `eth_getLogs` (no address, earliest..latest, wide topic ORs) makes
 * the node scan and serialize the whole chain for one cheap anonymous request.
 * Two shapes are allowed:
 *   - the harness op (`ops.getLogs`): one contract, explicit range of at most
 *     {@link MAX_LOG_BLOCK_RANGE} blocks, fetched in {@link MAX_LOG_CHUNK}-block
 *     chunks and truncated at {@link MAX_LOG_RESULTS} results;
 *   - the raw `/api/v1?module=proxy&action=eth_getLogs` passthrough: ONE RPC call,
 *     so it gets the chunk size as its whole budget, one contract, and capped topics.
 */
import { PublicError } from "@/lib/api/errors";

export const MAX_LOG_BLOCK_RANGE = 10_000n;
export const MAX_LOG_CHUNK = 1_000n;
export const MAX_LOG_RESULTS = 1_000;
/** Largest span (inclusive block count) one raw proxy eth_getLogs may cover. */
export const MAX_PROXY_LOG_BLOCKS = MAX_LOG_CHUNK;
/** eth_getLogs topic positions (the EVM has at most 4 indexed topics). */
export const MAX_LOG_TOPIC_POSITIONS = 4;
/** OR-alternatives allowed per topic position. */
export const MAX_LOG_TOPIC_ALTERNATIVES = 4;


const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
/** Canonical hex quantity only — no block tags (latest/earliest/pending/safe/finalized). */
const QUANTITY_RE = /^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/;

/** Throws unless `[fromBlock, toBlock]` is a valid range within `maxBlocks` (inclusive). */
export function assertLogRange(fromBlock: unknown, toBlock: unknown, maxBlocks: bigint = MAX_LOG_BLOCK_RANGE): void {
  if (typeof fromBlock !== "bigint" || typeof toBlock !== "bigint" || fromBlock < 0n || toBlock < fromBlock) {
    throw new PublicError("getLogs requires a valid non-negative block range");
  }
  if (toBlock - fromBlock + 1n > maxBlocks) {
    throw new PublicError(`getLogs block range exceeds the ${maxBlocks.toLocaleString("en-US")} block limit`);
  }
}

export type LogFilter =
  | { address: string; fromBlock: string; toBlock: string; topics?: Array<string | null | string[]> }
  | { address: string; blockHash: string; topics?: Array<string | null | string[]> };

export type ProxyLogsCheck = { ok: true; params: [LogFilter] } | { ok: false; error: string };

const ALLOWED_KEYS = new Set(["address", "fromBlock", "toBlock", "topics", "blockHash"]);

function checkTopics(topics: unknown): { ok: true; topics: Array<string | null | string[]> } | { ok: false; error: string } {
  if (!Array.isArray(topics)) return { ok: false, error: "topics must be an array" };
  if (topics.length > MAX_LOG_TOPIC_POSITIONS) {
    return { ok: false, error: `at most ${MAX_LOG_TOPIC_POSITIONS} topic positions` };
  }
  const out: Array<string | null | string[]> = [];
  for (const t of topics) {
    if (t === null) {
      out.push(null);
    } else if (typeof t === "string") {
      if (!WORD_RE.test(t)) return { ok: false, error: "each topic must be a 32-byte hex word" };
      out.push(t);
    } else if (Array.isArray(t)) {
      if (t.length === 0 || t.length > MAX_LOG_TOPIC_ALTERNATIVES) {
        return { ok: false, error: `1 to ${MAX_LOG_TOPIC_ALTERNATIVES} alternatives per topic position` };
      }
      if (!t.every((w) => typeof w === "string" && WORD_RE.test(w))) {
        return { ok: false, error: "each topic must be a 32-byte hex word" };
      }
      out.push([...(t as string[])]);
    } else {
      return { ok: false, error: "each topic must be null, a 32-byte hex word, or an array of them" };
    }
  }
  return { ok: true, topics: out };
}

/**
 * Validate and rebuild the params of a raw `eth_getLogs` passthrough. Returns a
 * fresh filter containing ONLY the validated keys (never the caller's object).
 */
export function checkProxyGetLogs(params: unknown): ProxyLogsCheck {
  if (!Array.isArray(params) || params.length !== 1) {
    return { ok: false, error: "eth_getLogs takes exactly one filter object" };
  }
  const f = params[0];
  if (!f || typeof f !== "object" || Array.isArray(f)) {
    return { ok: false, error: "eth_getLogs takes exactly one filter object" };
  }
  const filter = f as Record<string, unknown>;
  for (const k of Object.keys(filter)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, error: `unsupported filter key: ${k}` };
  }
  if (typeof filter.address !== "string" || !ADDRESS_RE.test(filter.address)) {
    return { ok: false, error: "eth_getLogs requires a single contract address" };
  }
  let topics: Array<string | null | string[]> | undefined;
  if (filter.topics !== undefined) {
    const t = checkTopics(filter.topics);
    if (!t.ok) return t;
    topics = t.topics;
  }
  const withTopics = <T extends object>(o: T) => (topics ? { ...o, topics } : o);

  if (filter.blockHash !== undefined) {
    if (filter.fromBlock !== undefined || filter.toBlock !== undefined) {
      return { ok: false, error: "blockHash cannot be combined with fromBlock/toBlock" };
    }
    if (typeof filter.blockHash !== "string" || !WORD_RE.test(filter.blockHash)) {
      return { ok: false, error: "blockHash must be a 32-byte hex hash" };
    }
    return { ok: true, params: [withTopics({ address: filter.address, blockHash: filter.blockHash })] };
  }

  const { fromBlock, toBlock } = filter;
  if (typeof fromBlock !== "string" || typeof toBlock !== "string" || !QUANTITY_RE.test(fromBlock) || !QUANTITY_RE.test(toBlock)) {
    return { ok: false, error: "eth_getLogs requires explicit hex fromBlock and toBlock (no block tags)" };
  }
  try {
    assertLogRange(BigInt(fromBlock), BigInt(toBlock), MAX_PROXY_LOG_BLOCKS);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, params: [withTopics({ address: filter.address, fromBlock, toBlock })] };
}
