/**
 * Paged eth_getLogs reads (stub API; behaviour lands in the next commit).
 */
import { PublicError } from "@/lib/api/errors";

export const RPC_RESOURCE_UNAVAILABLE = -32002;
export const RPC_LIMIT_EXCEEDED = -32005;

export interface RpcErrorInfo {
  code: number;
  data: unknown;
}

export function rpcErrorInfo(_err: unknown): RpcErrorInfo | null {
  return null;
}

export type LogsErrorClass = "retryable" | "range-too-large" | "fatal";

export function classifyLogsError(_err: unknown): LogsErrorClass {
  return "fatal";
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const logRetryRuntime = {
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

export const DEFAULT_LOG_RETRY: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

export function backoffDelayMs(_attempt: number, _policy: RetryPolicy, _random: () => number = Math.random): number {
  return 0;
}

export class LogsUnavailableError extends PublicError {
  constructor(
    readonly fromBlock: bigint,
    readonly toBlock: bigint,
    readonly attempts: number,
  ) {
    super("event logs are temporarily unavailable");
    this.name = "LogsUnavailableError";
  }
}

export async function withLogsRetry<T>(call: () => Promise<T>, _fromBlock: bigint, _toBlock: bigint, _policy: RetryPolicy = DEFAULT_LOG_RETRY): Promise<T> {
  return call();
}

export type FetchLogPage<T> = (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>;

export interface LogPage<T> {
  fromBlock: bigint;
  toBlock: bigint;
  logs: readonly T[];
}

export async function* pageLogs<T>(
  fetchPage: FetchLogPage<T>,
  fromBlock: bigint,
  toBlock: bigint,
  opts: { chunk: bigint; retry?: RetryPolicy },
): AsyncGenerator<LogPage<T>> {
  let from = fromBlock;
  while (from <= toBlock) {
    const end = from + opts.chunk - 1n;
    const to = end < toBlock ? end : toBlock;
    yield { fromBlock: from, toBlock: to, logs: await fetchPage(from, to) };
    from = to + 1n;
  }
}
