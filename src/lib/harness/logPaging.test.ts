/**
 * Paged eth_getLogs against the chain's error contract (citrate-chain core/api
 * README, "Log scanner protocol"):
 *   -32002 with data.retryable: retry the same window with back-off;
 *   -32005 with data.maxBlockRange: the range is over the node's limit, page it;
 *   anything else: stop, do not advance, do not answer "no logs".
 * Classification is by JSON-RPC error code (and structured data), never by the
 * message text.
 *
 * The node is a scripted JSON-RPC server on loopback, so viem's real HTTP
 * transport builds the errors exactly as it does against a live node.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createPublicClient, http as httpTransport, pad, type Address, type Hex, type PublicClient } from "viem";
import { TRANSFER_TOPIC, tokenIdTopic } from "@/lib/citrate/agentSbt";
import {
  backoffDelayMs,
  classifyLogsError,
  DEFAULT_LOG_RETRY,
  logRetryRuntime,
  LogsUnavailableError,
  pageLogs,
  rpcErrorInfo,
  withLogsRetry,
  type RetryPolicy,
} from "./logPaging";

const fake = vi.hoisted(() => ({ client: null as unknown as PublicClient }));
vi.mock("@/lib/harness/client", () => ({
  HARNESS_TIMEOUT_MS: 9_000,
  harnessClient: () => fake.client,
}));

import { getLogs } from "./ops";
import { agentTransferLogs } from "./agentSbt";
import { GET as v1 } from "@/app/api/v1/route";

const ADDR = "0x1111111111111111111111111111111111111111" as Address;
const hex = (n: bigint) => `0x${n.toString(16)}`;

// ---------------------------------------------------------------------------
// Scripted node
// ---------------------------------------------------------------------------
type RpcError = { code: number; message: string; data?: unknown };
type Filter = { fromBlock: string; toBlock: string; topics?: (string | null)[] };
type Script = (f: Filter, n: number) => RpcError | unknown[];

const node = {
  head: 5_000n,
  script: (() => []) as Script,
  calls: [] as Array<{ from: bigint; to: bigint }>,
};

const retryable = (blockNumber?: bigint): RpcError => ({
  code: -32002,
  message: "eth_getLogs: log index warming; retry the same request",
  data: blockNumber === undefined ? { retryable: true } : { retryable: true, blockNumber: hex(blockNumber) },
});
const overLimit = (f: Filter, max: number): RpcError => ({
  code: -32005,
  message: `eth_getLogs range too large: fromBlock ${f.fromBlock} to toBlock ${f.toBlock} spans more than ${max} blocks; request it in pages`,
  data: { maxBlockRange: max, fromBlock: f.fromBlock, toBlock: f.toBlock },
});

function logAt(block: bigint, tokenId = 7n) {
  return {
    address: ADDR,
    topics: [TRANSFER_TOPIC, pad("0x0"), pad("0x70997970c51812dc3a010c7d01b50e0d17dc79c8"), tokenIdTopic(tokenId)],
    data: "0x",
    blockNumber: hex(block),
    blockHash: pad(hex(block) as Hex),
    transactionHash: pad(hex(block + 1_000_000n) as Hex),
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  };
}

let server: http.Server;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        if (r.method === "eth_blockNumber") return { jsonrpc: "2.0", id: r.id, result: hex(node.head) };
        if (r.method === "eth_chainId") return { jsonrpc: "2.0", id: r.id, result: hex(40204n) };
        if (r.method !== "eth_getLogs") return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: "unscripted" } };
        const f = (r.params ?? [])[0] as Filter;
        node.calls.push({ from: BigInt(f.fromBlock), to: BigInt(f.toBlock) });
        const out = node.script(f, node.calls.length);
        return Array.isArray(out) ? { jsonrpc: "2.0", id: r.id, result: out } : { jsonrpc: "2.0", id: r.id, error: out };
      };
      const parsed = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  // retryCount 0: the retries under test are the explorer's, not viem's.
  fake.client = createPublicClient({ transport: httpTransport(`http://127.0.0.1:${port}`, { retryCount: 0 }) }) as PublicClient;
});
afterAll(() => server.close());

beforeEach(() => {
  node.calls = [];
  node.head = 5_000n;
  node.script = () => [];
});

/** A policy whose sleeps are recorded, not waited. */
function recordingPolicy(maxAttempts = 4): RetryPolicy & { slept: number[] } {
  const slept: number[] = [];
  return { maxAttempts, baseDelayMs: 100, maxDelayMs: 1_000, sleep: async (ms) => void slept.push(ms), random: () => 0.5, slept };
}

const fetchVia = (c: () => PublicClient) => async (from: bigint, to: bigint) =>
  c().getLogs({ address: ADDR, fromBlock: from, toBlock: to });

async function collect<T>(it: AsyncGenerator<{ fromBlock: bigint; toBlock: bigint; logs: readonly T[] }>) {
  const pages: Array<{ fromBlock: bigint; toBlock: bigint; logs: readonly T[] }> = [];
  for await (const p of it) pages.push(p);
  return pages;
}

/** Settle `p` (the ops/route paths use the default policy; its sleeps are stubbed below). */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

// ---------------------------------------------------------------------------
// Classification (by code)
// ---------------------------------------------------------------------------
describe("classifyLogsError (by JSON-RPC code, never by message)", () => {
  async function errorFor(e: RpcError): Promise<unknown> {
    node.script = () => e;
    return fake.client.getLogs({ address: ADDR, fromBlock: 1n, toBlock: 2n }).then(
      () => {
        throw new Error("expected the node error");
      },
      (err: unknown) => err,
    );
  }

  it("reads code and data from the viem error chain", async () => {
    const err = await errorFor(retryable(42n));
    expect(rpcErrorInfo(err)).toEqual({ code: -32002, data: { retryable: true, blockNumber: "0x2a" } });
  });

  it("-32002 is retryable", async () => {
    expect(classifyLogsError(await errorFor(retryable()))).toBe("retryable");
  });

  it("-32002 without the word retry in its message is still retryable", async () => {
    expect(classifyLogsError(await errorFor({ code: -32002, message: "resource unavailable", data: { retryable: true } }))).toBe("retryable");
  });

  it("-32002 that says data.retryable=false is not retried", async () => {
    expect(classifyLogsError(await errorFor({ code: -32002, message: "x", data: { retryable: false } }))).toBe("fatal");
  });

  it("-32005 with data.maxBlockRange is a range to split", async () => {
    expect(classifyLogsError(await errorFor(overLimit({ fromBlock: "0x0", toBlock: "0x7d0" }, 1_000)))).toBe("range-too-large");
  });

  it("-32005 without maxBlockRange (method budget) is neither retried nor split", async () => {
    expect(classifyLogsError(await errorFor({ code: -32005, message: "Method budget exceeded. Reduce call frequency for expensive methods." }))).toBe("fatal");
  });

  it("a different code whose message says retry is NOT retryable", async () => {
    const err = await errorFor({ code: -32000, message: "header read failed; retry the same request (retryable)", data: { note: "retry" } });
    expect(classifyLogsError(err)).toBe("fatal");
  });

  it("-32603 (executed chain cannot be followed) is fatal", async () => {
    expect(classifyLogsError(await errorFor({ code: -32603, message: "eth_getLogs: missing ancestor" }))).toBe("fatal");
  });

  it("non-RPC errors are fatal", () => {
    expect(classifyLogsError(new Error("retry"))).toBe("fatal");
    expect(classifyLogsError({ message: "retryable -32002" })).toBe("fatal");
  });
});

// ---------------------------------------------------------------------------
// Back-off
// ---------------------------------------------------------------------------
describe("backoffDelayMs", () => {
  const p: RetryPolicy = { maxAttempts: 8, baseDelayMs: 100, maxDelayMs: 1_000 };
  it("grows exponentially, is capped, and is jittered within [cap/2, cap]", () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const cap = Math.min(1_000, 100 * 2 ** (attempt - 1));
      expect(backoffDelayMs(attempt, p, () => 0)).toBe(cap / 2);
      expect(backoffDelayMs(attempt, p, () => 0.999999)).toBeLessThanOrEqual(cap);
      expect(backoffDelayMs(attempt, p, () => 0.999999)).toBeGreaterThan(cap * 0.99);
    }
    // jitter: different random draws give different delays
    expect(backoffDelayMs(3, p, () => 0.1)).not.toBe(backoffDelayMs(3, p, () => 0.9));
  });
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------
describe("retry on -32002", () => {
  it("-32002 x3 then success returns the page; the delays back off", async () => {
    node.script = (_f, n) => (n <= 3 ? retryable(10n) : [logAt(10n)]);
    const policy = recordingPolicy(5);
    const pages = await collect(pageLogs(fetchVia(() => fake.client), 0n, 99n, { chunk: 1_000n, retry: policy }));
    expect(node.calls).toHaveLength(4);
    expect(node.calls.every((c) => c.from === 0n && c.to === 99n)).toBe(true); // the SAME window each time
    expect(pages).toHaveLength(1);
    expect(pages[0].logs).toHaveLength(1);
    expect(policy.slept).toEqual([75, 150, 300]); // equal jitter at random()=0.5: 3/4 of 100, 200, 400
  });

  it("-32002 past the attempt limit fails visibly with LogsUnavailableError", async () => {
    node.script = () => retryable(10n);
    const policy = recordingPolicy(4);
    const r = await collect(pageLogs(fetchVia(() => fake.client), 0n, 99n, { chunk: 1_000n, retry: policy })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(r).toBeInstanceOf(LogsUnavailableError);
    expect((r as LogsUnavailableError).attempts).toBe(4);
    expect((r as LogsUnavailableError).fromBlock).toBe(0n);
    expect((r as LogsUnavailableError).toBlock).toBe(99n);
    expect((r as Error).message).toMatch(/temporarily unavailable/);
    expect(node.calls).toHaveLength(4);
    expect(policy.slept).toHaveLength(3); // no sleep after the last attempt
  });

  it("a non-retryable code is tried once and rethrown", async () => {
    node.script = () => ({ code: -32603, message: "eth_getLogs: missing ancestor" });
    const policy = recordingPolicy(5);
    const r = await collect(pageLogs(fetchVia(() => fake.client), 0n, 99n, { chunk: 1_000n, retry: policy })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(r).not.toBeNull();
    expect(r).not.toBeInstanceOf(LogsUnavailableError);
    expect(rpcErrorInfo(r)?.code).toBe(-32603);
    expect(node.calls).toHaveLength(1);
    expect(policy.slept).toEqual([]);
  });

  it("a message containing 'retry' with a different code is not retried", async () => {
    node.script = () => ({ code: -32000, message: "temporarily failed, please retry (retryable)" });
    const policy = recordingPolicy(5);
    await expect(collect(pageLogs(fetchVia(() => fake.client), 0n, 99n, { chunk: 1_000n, retry: policy }))).rejects.toThrow();
    expect(node.calls).toHaveLength(1);
    expect(policy.slept).toEqual([]);
  });

  it("withLogsRetry retries a single call the same way", async () => {
    node.script = (_f, n) => (n <= 2 ? retryable() : [logAt(3n)]);
    const policy = recordingPolicy(3);
    const logs = await withLogsRetry(() => fake.client.getLogs({ address: ADDR, fromBlock: 1n, toBlock: 5n }), 1n, 5n, policy);
    expect(logs).toHaveLength(1);
    expect(node.calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Over-limit split
// ---------------------------------------------------------------------------
describe("over-limit range is split and paged", () => {
  it("a node with a smaller limit gets pages that cover the range exactly once, in order", async () => {
    const MAX = 300; // toBlock - fromBlock <= 300
    node.script = (f) => (BigInt(f.toBlock) - BigInt(f.fromBlock) > BigInt(MAX) ? overLimit(f, MAX) : [logAt(BigInt(f.fromBlock))]);
    const policy = recordingPolicy(3);
    const pages = await collect(pageLogs(fetchVia(() => fake.client), 0n, 1_999n, { chunk: 1_000n, retry: policy }));
    // contiguous, ascending, no overlap, no gap
    expect(pages[0].fromBlock).toBe(0n);
    expect(pages.at(-1)!.toBlock).toBe(1_999n);
    for (let i = 1; i < pages.length; i++) expect(pages[i].fromBlock).toBe(pages[i - 1].toBlock + 1n);
    for (const p of pages) expect(p.toBlock - p.fromBlock).toBeLessThanOrEqual(BigInt(MAX));
    // every served page's logs are present
    expect(pages.flatMap((p) => p.logs)).toHaveLength(pages.length);
    // splitting is not a retry: no sleeps
    expect(policy.slept).toEqual([]);
  });

  it("a -32005 budget error (no maxBlockRange) is not split", async () => {
    node.script = () => ({ code: -32005, message: "Method budget exceeded. Reduce call frequency for expensive methods." });
    await expect(collect(pageLogs(fetchVia(() => fake.client), 0n, 999n, { chunk: 1_000n, retry: recordingPolicy(3) }))).rejects.toThrow();
    expect(node.calls).toHaveLength(1);
  });

  it("a -32005 range error on a single block is not split forever", async () => {
    node.script = (f) => overLimit(f, 0);
    const r = await collect(pageLogs(fetchVia(() => fake.client), 0n, 7n, { chunk: 1_000n, retry: recordingPolicy(3) })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(r).not.toBeNull();
    expect(node.calls.length).toBeLessThanOrEqual(5); // 0..7 -> 0..3 -> 0..1 -> 0..0, then stop
  });
});

// ---------------------------------------------------------------------------
// Callers: never a partial page shown as complete, never "no logs" on failure
// ---------------------------------------------------------------------------
describe("callers surface 'temporarily unavailable', never a partial or empty answer", () => {
  let sleeps: number[];
  beforeEach(() => {
    sleeps = [];
    vi.spyOn(logRetryRuntime, "sleep").mockImplementation(async (ms: number) => void sleeps.push(ms));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the default policy is bounded: a few attempts, sub-second base, capped delay", () => {
    expect(DEFAULT_LOG_RETRY.maxAttempts).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_LOG_RETRY.maxAttempts).toBeLessThanOrEqual(8);
    expect(DEFAULT_LOG_RETRY.baseDelayMs).toBeGreaterThan(0);
    expect(DEFAULT_LOG_RETRY.maxDelayMs).toBeLessThanOrEqual(5_000);
  });

  it("ops.getLogs retries -32002 and returns the full result", async () => {
    node.script = (f, n) => (n <= 2 ? retryable() : [logAt(BigInt(f.fromBlock))]);
    const r = await settle(getLogs({ address: ADDR, fromBlock: 0n, toBlock: 1_999n }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.logs).toHaveLength(2);
  });

  it("ops.getLogs: first chunk served, second chunk exhausts retries -> rejects (no partial result)", async () => {
    node.script = (f) => (BigInt(f.fromBlock) === 0n ? [logAt(5n)] : retryable(1_000n));
    const r = await settle(getLogs({ address: ADDR, fromBlock: 0n, toBlock: 1_999n }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(LogsUnavailableError);
    expect(node.calls.filter((c) => c.from === 1_000n)).toHaveLength(DEFAULT_LOG_RETRY.maxAttempts);
    expect(sleeps).toHaveLength(DEFAULT_LOG_RETRY.maxAttempts - 1);
    for (const ms of sleeps) expect(ms).toBeLessThanOrEqual(DEFAULT_LOG_RETRY.maxDelayMs);
  });

  it("ops.getLogs pages an over-limit chunk instead of failing", async () => {
    node.script = (f) => (BigInt(f.toBlock) - BigInt(f.fromBlock) > 400n ? overLimit(f, 400) : [logAt(BigInt(f.fromBlock))]);
    const r = await settle(getLogs({ address: ADDR, fromBlock: 0n, toBlock: 999n }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.logs.length).toBeGreaterThan(1);
      expect(r.value.truncated).toBe(false);
    }
  });

  it("agentTransferLogs: an exhausted -32002 rejects instead of returning an empty history", async () => {
    node.head = 1_500n;
    node.script = (f) => (BigInt(f.fromBlock) === 0n ? [] : retryable());
    const r = await settle(agentTransferLogs({ client: fake.client, address: ADDR }, 7n, 2_000n));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(LogsUnavailableError);
  });

  it("agentTransferLogs retries -32002 and returns the transfer", async () => {
    node.head = 900n;
    node.script = (f, n) => (n === 1 ? retryable() : [logAt(BigInt(f.fromBlock) + 3n, 7n)]);
    const r = await settle(agentTransferLogs({ client: fake.client, address: ADDR }, 7n, 1_000n));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.transfers).toHaveLength(1);
  });

  async function v1Get(q: Record<string, string>) {
    const qs = new URLSearchParams(q);
    const p = v1(new Request(`http://x/api/v1?${qs}`, { headers: { "x-forwarded-for": `10.88.0.${Math.floor(Math.random() * 250)}` } }));
    const r = await settle(p);
    if (!r.ok) throw r.error;
    return { status: r.value.status, retryAfter: r.value.headers.get("retry-after"), body: await r.value.json() };
  }

  it("/api/v1 logs: exhausted -32002 is 503 'temporarily unavailable', not 'No logs found'", async () => {
    node.script = () => retryable();
    const res = await v1Get({ module: "logs", action: "getLogs", address: ADDR, fromBlock: "0", toBlock: "10" });
    expect(res.status).toBe(503);
    expect(res.retryAfter).not.toBeNull();
    expect(res.body.status).toBe("0");
    expect(res.body.message).toMatch(/temporarily unavailable/);
    expect(res.body.message).not.toMatch(/No logs found/);
    expect(res.body.result).toBeNull();
  });

  it("/api/v1 logs: a genuinely empty range is still 'No logs found'", async () => {
    node.script = () => [];
    const res = await v1Get({ module: "logs", action: "getLogs", address: ADDR, fromBlock: "0", toBlock: "10" });
    expect(res.body.message).toBe("No logs found");
  });

  it("/api/v1 proxy eth_getLogs: -32002 is retried, then served", async () => {
    node.script = (_f, n) => (n === 1 ? retryable() : [logAt(2n)]);
    const res = await v1Get({ module: "proxy", action: "eth_getLogs", params: JSON.stringify([{ address: ADDR, fromBlock: "0x0", toBlock: "0xa" }]) });
    expect(res.body.result).toHaveLength(1);
    expect(node.calls).toHaveLength(2);
  });

  it("/api/v1 proxy eth_getLogs: exhausted -32002 is a JSON-RPC -32002, not an empty result", async () => {
    node.script = () => retryable();
    const res = await v1Get({ module: "proxy", action: "eth_getLogs", params: JSON.stringify([{ address: ADDR, fromBlock: "0x0", toBlock: "0xa" }]) });
    expect(res.status).toBe(503);
    expect(res.body.result).toBeUndefined();
    expect(res.body.error.code).toBe(-32002);
    expect(res.body.error.message).toMatch(/temporarily unavailable/);
  });
});

// ---------------------------------------------------------------------------
// Tripwires
// ---------------------------------------------------------------------------
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const GETLOGS_CALL = /\.getLogs\(\s*\{/;
const USES_PAGER = /\b(pageLogs|withLogsRetry)\(/;
const MESSAGE_READ = /\.(message|shortMessage|details)\b/;

describe("tripwires", () => {
  const files = walk(SRC).map((f) => ({ rel: relative(SRC, f).replaceAll("\\", "/"), text: readFileSync(f, "utf8") }));

  it("every eth_getLogs call site goes through pageLogs/withLogsRetry", () => {
    const offenders = files.filter(({ text }) => GETLOGS_CALL.test(text) && !USES_PAGER.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
    // negative control: the rule does fire on a bare call
    expect(GETLOGS_CALL.test("await c.getLogs({ address })") && !USES_PAGER.test("await c.getLogs({ address })")).toBe(true);
  });

  it("the error classifier never reads error message text", () => {
    const src = files.find((f) => f.rel === "lib/harness/logPaging.ts")!.text;
    const body = src.slice(src.indexOf("export function rpcErrorInfo"), src.indexOf("export function backoffDelayMs"));
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(MESSAGE_READ);
    // negative control
    expect("if (/retry/.test(err.message))").toMatch(MESSAGE_READ);
  });
});
