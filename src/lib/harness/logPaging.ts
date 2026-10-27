/**
 * Paged `eth_getLogs` reads that follow the node's error contract
 * (citrate-chain `core/api/README.md`, "Log scanner protocol";
 * `core/api/src/canonical_logs.rs`):
 *
 *   -32002, `data.retryable`   the node cannot answer this window yet (a cold
 *                              log index deep below the tip). Retry the SAME
 *                              window with bounded exponential back-off.
 *   -32005, `data.maxBlockRange` the range is over the node's limit (the node
 *                              no longer clamps it silently). Page it smaller.
 *   anything else              stop. Do not advance, do not answer "no logs".
 *
 * -32005 without `maxBlockRange` is the node's per-method budget (rate limit),
 * not a range error, so it is neither split nor retried here.
 *
 * Errors are classified by the JSON-RPC error CODE and its structured `data`,
 * never by message text (a message is for humans and changes freely).
 *
 * `citrate_getLogs` (`{logs, through}`, `afterBlockHash`, -32001 on a replaced
 * cursor) is not used yet: it ships with citrate-chain#337. Moving the paged
 * callers onto it is a follow-up; until then -32001 is treated as any other
 * non-retryable error.
 *
 * Data source (Rule 11): live Citrate RPC; this module only shapes the calls.
 */
import { PublicError } from "@/lib/api/errors";

/** EIP-1474 "resource unavailable": the node's retryable log-index / receipt error. */
export const RPC_RESOURCE_UNAVAILABLE = -32002;
/** EIP-1474 "limit exceeded": over-limit range (with `maxBlockRange`) or method budget. */
export const RPC_LIMIT_EXCEEDED = -32005;

export interface RpcErrorInfo {
  code: number;
  data: unknown;
}

/**
 * The JSON-RPC `{code, data}` behind `err`. viem wraps the node's error (for
 * example `ResourceUnavailableRpcError` → `RpcRequestError`, or
 * `UnknownRpcError` (code -1) → the raw error), so the deepest numeric code on
 * the `cause` chain is the node's own.
 */
export function rpcErrorInfo(err: unknown): RpcErrorInfo | null {
  let found: RpcErrorInfo | null = null;
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur !== null && typeof cur === "object"; depth++) {
    const o = cur as { code?: unknown; data?: unknown; cause?: unknown };
    if (typeof o.code === "number" && Number.isInteger(o.code) && o.code !== -1) {
      found = { code: o.code, data: o.data };
    }
    cur = o.cause;
  }
  return found;
}

export type LogsErrorClass = "retryable" | "range-too-large" | "fatal";

function dataField(data: unknown, key: string): unknown {
  return data !== null && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
}

/** How a failed eth_getLogs call is handled. By code and structured data only. */
export function classifyLogsError(err: unknown): LogsErrorClass {
  const info = rpcErrorInfo(err);
  if (!info) return "fatal";
  if (info.code === RPC_RESOURCE_UNAVAILABLE) {
    // The node marks this retryable; an explicit `retryable: false` is honoured.
    return dataField(info.data, "retryable") === false ? "fatal" : "retryable";
  }
  if (info.code === RPC_LIMIT_EXCEEDED) {
    const max = dataField(info.data, "maxBlockRange");
    return typeof max === "number" && Number.isInteger(max) && max >= 0 ? "range-too-large" : "fatal";
  }
  return "fatal";
}

export interface RetryPolicy {
  /** Total attempts per window, including the first. */
  maxAttempts: number;
  /** Back-off before the 2nd attempt; doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound on any single back-off. */
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** The real-time sleep the default policy uses (a seam so tests don't wait). */
export const logRetryRuntime = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Worst case per window: 150 + 300 + 600 + 1,200 ms of back-off over 5 attempts
 * (~2.3 s plus the calls), inside a serverless request budget.
 */
export const DEFAULT_LOG_RETRY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 150, maxDelayMs: 2_000 };

/**
 * Back-off before attempt `attempt + 1`: exponential (`base * 2^(attempt-1)`),
 * capped at `maxDelayMs`, with "equal jitter" (uniform in [cap/2, cap]) so
 * concurrent readers spread out without ever retrying immediately.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const cap = Math.min(policy.maxDelayMs, exp);
  const r = Math.min(Math.max(random(), 0), 1);
  return cap / 2 + r * (cap / 2);
}

/**
 * The node could not serve a window within the retry budget. A PublicError: the
 * caller is told the read failed and to retry, never handed "no logs".
 */
export class LogsUnavailableError extends PublicError {
  readonly code = RPC_RESOURCE_UNAVAILABLE;
  constructor(
    readonly fromBlock: bigint | null,
    readonly toBlock: bigint | null,
    readonly attempts: number,
  ) {
    const range = fromBlock !== null && toBlock !== null ? ` for blocks ${fromBlock}-${toBlock}` : "";
    super(`event logs${range} are temporarily unavailable (the node is still indexing them); retry shortly`);
    this.name = "LogsUnavailableError";
  }
}

/** Run one eth_getLogs call, retrying only a retryable -32002, at most `maxAttempts` times. */
export async function withLogsRetry<T>(
  call: () => Promise<T>,
  fromBlock: bigint | null,
  toBlock: bigint | null,
  policy: RetryPolicy = DEFAULT_LOG_RETRY,
): Promise<T> {
  const sleep = policy.sleep ?? logRetryRuntime.sleep;
  const random = policy.random ?? Math.random;
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (classifyLogsError(err) !== "retryable") throw err;
      if (attempt >= maxAttempts) throw new LogsUnavailableError(fromBlock, toBlock, attempt);
      await sleep(backoffDelayMs(attempt, policy, random));
    }
  }
}

export type FetchLogPage<T> = (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>;

export interface LogPage<T> {
  fromBlock: bigint;
  toBlock: bigint;
  logs: readonly T[];
}

/**
 * Pages `[fromBlock, toBlock]` in ascending, contiguous windows of at most
 * `chunk` blocks. Yields a window only once it is fully served, so a consumer
 * that stops on an error never holds a window it believes complete but isn't.
 * A retryable -32002 retries the same window ({@link withLogsRetry}); an
 * over-limit -32005 shrinks the window (to the node's `maxBlockRange` or half,
 * whichever is smaller) and continues from the same block. Any other error
 * propagates.
 */
export async function* pageLogs<T>(
  fetchPage: FetchLogPage<T>,
  fromBlock: bigint,
  toBlock: bigint,
  opts: { chunk: bigint; retry?: RetryPolicy },
): AsyncGenerator<LogPage<T>> {
  let span = opts.chunk > 0n ? opts.chunk : 1n;
  let from = fromBlock;
  while (from <= toBlock) {
    const end = from + span - 1n;
    const to = end < toBlock ? end : toBlock;
    let logs: readonly T[];
    try {
      logs = await withLogsRetry(() => fetchPage(from, to), from, to, opts.retry);
    } catch (err) {
      const width = to - from + 1n;
      if (classifyLogsError(err) !== "range-too-large" || width <= 1n) throw err;
      // The node serves `toBlock - fromBlock <= maxBlockRange`, i.e. maxBlockRange+1 heights.
      const max = BigInt(dataField(rpcErrorInfo(err)?.data, "maxBlockRange") as number) + 1n;
      const half = width / 2n;
      span = max >= 1n && max < half ? max : half; // strictly smaller: always terminates
      continue;
    }
    yield { fromBlock: from, toBlock: to, logs };
    from = to + 1n;
  }
}
