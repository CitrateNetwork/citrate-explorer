/**
 * PBA-L3c-039 (EX-B-003 / EX-B-004) tripwire: EVERY entry point that can reach
 * `eth_getLogs` must be bounded (explicit address + block range, capped span,
 * capped topics) BEFORE the RPC client is touched.
 *
 * Entry points covered here, at the real route handlers:
 *   1. GET /api/v1?module=proxy&action=eth_getLogs&params=[...]  (raw passthrough)
 *   2. GET /api/v1?module=logs&action=getLogs                    (ops.getLogs)
 *   3. POST /api/mcp tools/call getLogs                           (citrateTools → ops.getLogs)
 *   4. citrateTools().getLogs (in-app agent / chat)               (same registry)
 *   5. POST /api/mcp batch                                        (one limiter token per call)
 * plus a source scan so a NEW call site of `getLogs` / `eth_getLogs` / a
 * dynamic-method `citrateRequest` fails CI until it is reviewed and bounded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const rpc = vi.hoisted(() => ({
  request: vi.fn(async () => []),
  getLogs: vi.fn(async () => []),
}));

vi.mock("@/lib/harness/client", () => ({
  HARNESS_TIMEOUT_MS: 9_000,
  harnessClient: () => rpc,
}));

import { GET as v1 } from "@/app/api/v1/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { citrateTools } from "@/lib/ai/tools";

const ADDR = "0x1111111111111111111111111111111111111111";
const TOPIC = `0x${"ab".repeat(32)}`;

let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `10.77.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
}

async function proxyGetLogs(params: unknown) {
  const q = new URLSearchParams({ module: "proxy", action: "eth_getLogs", params: JSON.stringify(params) });
  const res = await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }));
  return res.json();
}

async function logsModule(q: Record<string, string>) {
  const qs = new URLSearchParams({ module: "logs", action: "getLogs", ...q });
  const res = await v1(new Request(`http://x/api/v1?${qs}`, { headers: { "x-forwarded-for": nextIp() } }));
  return res.json();
}

async function mcpCall(body: unknown) {
  return mcp(
    new Request("http://x/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  rpc.request.mockClear();
  rpc.getLogs.mockClear();
});

describe("/api/v1 module=proxy action=eth_getLogs (PBA-L3c-039 new bypass)", () => {
  const rejected: Array<[string, unknown]> = [
    ["genesis-to-tip scan (no address, earliest..latest)", [{ fromBlock: "earliest", toBlock: "latest" }]],
    ["empty filter", [{}]],
    ["no params at all", []],
    ["missing address", [{ fromBlock: "0x0", toBlock: "0x10" }]],
    ["address array (multi-contract fan-out)", [{ address: [ADDR, ADDR], fromBlock: "0x0", toBlock: "0x10" }]],
    ["open-ended toBlock=latest", [{ address: ADDR, fromBlock: "0x0", toBlock: "latest" }]],
    ["missing toBlock", [{ address: ADDR, fromBlock: "0x0" }]],
    ["span over the passthrough cap", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x3e8" }]],
    ["inverted range", [{ address: ADDR, fromBlock: "0x10", toBlock: "0x1" }]],
    ["non-hex block", [{ address: ADDR, fromBlock: "12", toBlock: "0x10" }]],
    ["too many topic positions", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x1", topics: [null, null, null, null, TOPIC] }]],
    ["too many OR alternatives", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x1", topics: [[TOPIC, TOPIC, TOPIC, TOPIC, TOPIC]] }]],
    ["malformed topic", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x1", topics: ["0x1234"] }]],
    ["unknown filter key", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x1", limit: 1e9 }]],
    ["blockHash combined with a range", [{ address: ADDR, blockHash: TOPIC, fromBlock: "0x0", toBlock: "0x1" }]],
    ["two filter objects", [{ address: ADDR, fromBlock: "0x0", toBlock: "0x1" }, {}]],
  ];

  for (const [name, params] of rejected) {
    it(`rejects ${name} without touching the RPC`, async () => {
      const json = await proxyGetLogs(params);
      expect(json.error?.code).toBe(-32602);
      expect(rpc.request).not.toHaveBeenCalled();
    });
  }

  it("forwards a bounded filter (1,000 blocks, 4 topic positions) with only validated keys", async () => {
    const json = await proxyGetLogs([
      { address: ADDR, fromBlock: "0x0", toBlock: "0x3e7", topics: [TOPIC, null, [TOPIC, TOPIC], null] },
    ]);
    expect(json.error).toBeUndefined();
    expect(rpc.request).toHaveBeenCalledTimes(1);
    expect(rpc.request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [{ address: ADDR, fromBlock: "0x0", toBlock: "0x3e7", topics: [TOPIC, null, [TOPIC, TOPIC], null] }],
    });
  });

  it("forwards a single-block blockHash filter", async () => {
    const json = await proxyGetLogs([{ address: ADDR, blockHash: TOPIC }]);
    expect(json.error).toBeUndefined();
    expect(rpc.request).toHaveBeenCalledWith({ method: "eth_getLogs", params: [{ address: ADDR, blockHash: TOPIC }] });
  });

  it("rejects unparseable params instead of falling through to an empty filter", async () => {
    const q = new URLSearchParams({ module: "proxy", action: "eth_getLogs", params: "{not json" });
    const res = await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }));
    const json = await res.json();
    expect(json.error?.code).toBe(-32602);
    expect(rpc.request).not.toHaveBeenCalled();
  });
});

describe("/api/v1 module=logs action=getLogs (EX-B-004)", () => {
  it("rejects a request with no address or range", async () => {
    const json = await logsModule({});
    expect(json.status).toBe("0");
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("rejects toBlock=latest", async () => {
    const json = await logsModule({ address: ADDR, fromBlock: "0", toBlock: "latest" });
    expect(json.status).toBe("0");
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("rejects a span over 10,000 blocks", async () => {
    const json = await logsModule({ address: ADDR, fromBlock: "0", toBlock: "10000" });
    expect(json.status).toBe("0");
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("chunks a bounded request into <=1,000-block RPC calls", async () => {
    const json = await logsModule({ address: ADDR, fromBlock: "0", toBlock: "2499" });
    expect(json).toMatchObject({ status: "0", message: "No logs found" }); // fake returns no logs
    expect(rpc.getLogs).toHaveBeenCalledTimes(3);
    for (const [arg] of rpc.getLogs.mock.calls as unknown as Array<[{ fromBlock: bigint; toBlock: bigint; address: string }]>) {
      expect(arg.address).toBe(ADDR);
      expect(arg.toBlock - arg.fromBlock).toBeLessThan(1_000n);
    }
  });
});

describe("/api/v1 module=logs parameter rules", () => {
  const fakeLog = (n: number) => ({
    address: ADDR,
    topics: [TOPIC],
    data: "0x",
    blockNumber: BigInt(n),
    transactionHash: TOPIC,
    logIndex: 0,
  });

  it.each([
    ["missing address", { fromBlock: "0", toBlock: "1" }],
    ["malformed address", { address: `${ADDR}00`, fromBlock: "0", toBlock: "1" }],
    ["address with a prefix", { address: `zz${ADDR}`, fromBlock: "0", toBlock: "1" }],
    ["missing fromBlock", { address: ADDR, toBlock: "1" }],
    ["missing toBlock", { address: ADDR, fromBlock: "0" }],
    ["trailing junk in a block", { address: ADDR, fromBlock: "0", toBlock: "12abc" }],
    ["leading junk in a block", { address: ADDR, fromBlock: "abc12", toBlock: "20" }],
    ["earliest tag", { address: ADDR, fromBlock: "earliest", toBlock: "1" }],
    ["0x with no digits", { address: ADDR, fromBlock: "0x", toBlock: "1" }],
    ["non-hex after 0x", { address: ADDR, fromBlock: "0xzz", toBlock: "1" }],
  ])("refuses %s before any RPC", async (_n, q) => {
    const json = await logsModule(q as Record<string, string>);
    expect(json.status).toBe("0");
    expect(json.message).toMatch(/requires a contract address and explicit numeric/);
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("accepts hex block numbers and returns an Etherscan array", async () => {
    rpc.getLogs.mockResolvedValueOnce([fakeLog(16)] as never);
    const json = await logsModule({ address: ADDR, fromBlock: "0x10", toBlock: "0x10" });
    expect(json).toMatchObject({ status: "1", message: "OK" });
    expect(Array.isArray(json.result)).toBe(true);
    expect(json.result[0]).toMatchObject({ address: ADDR, blockNumber: "16", txHash: TOPIC, logIndex: 0 });
    expect(rpc.getLogs).toHaveBeenCalledWith({ address: ADDR, fromBlock: 16n, toBlock: 16n });
  });

  it("reports truncation at 1,000 logs and stops fetching chunks", async () => {
    rpc.getLogs.mockResolvedValue(Array.from({ length: 600 }, (_, i) => fakeLog(i)) as never);
    const json = await logsModule({ address: ADDR, fromBlock: "0", toBlock: "4999" });
    rpc.getLogs.mockResolvedValue([] as never);
    expect(json.status).toBe("1");
    expect(json.message).toMatch(/truncated at 1000 logs/);
    expect(json.result).toHaveLength(1_000);
    expect(rpc.getLogs).toHaveBeenCalledTimes(2);
  });
});

describe("ops.getLogs chunking and truncation", () => {
  const fakeLog = { address: ADDR, topics: [], data: "0x", blockNumber: null, transactionHash: null, logIndex: null };

  it("walks exact 1,000-block chunk boundaries and clamps the last chunk", async () => {
    const { getLogs } = await import("./ops");
    await getLogs({ address: ADDR, fromBlock: 0n, toBlock: 2_499n });
    expect(rpc.getLogs.mock.calls.map((c) => [(c as unknown as [{ fromBlock: bigint }])[0].fromBlock, (c as unknown as [{ toBlock: bigint }])[0].toBlock])).toEqual([
      [0n, 999n],
      [1_000n, 1_999n],
      [2_000n, 2_499n],
    ]);
  });

  it("makes exactly one call for a single-block range and a range ending on a chunk edge", async () => {
    const { getLogs } = await import("./ops");
    await getLogs({ address: ADDR, fromBlock: 5n, toBlock: 5n });
    expect(rpc.getLogs).toHaveBeenCalledTimes(1);
    rpc.getLogs.mockClear();
    await getLogs({ address: ADDR, fromBlock: 0n, toBlock: 999n });
    expect(rpc.getLogs).toHaveBeenCalledTimes(1);
    expect(rpc.getLogs).toHaveBeenCalledWith({ address: ADDR, fromBlock: 0n, toBlock: 999n });
  });

  it("is not truncated when exactly 1,000 logs arrive in the final chunk", async () => {
    const { getLogs } = await import("./ops");
    rpc.getLogs.mockResolvedValueOnce(Array.from({ length: 1_000 }, () => fakeLog) as never);
    const r = await getLogs({ address: ADDR, fromBlock: 0n, toBlock: 999n });
    expect(r.logs).toHaveLength(1_000);
    expect(r.truncated).toBe(false);
    expect(r.logs[0]).toEqual({ address: ADDR, topics: [], data: "0x", blockNumber: null, txHash: null, logIndex: null });
  });

  it("is truncated when 1,000 logs fill up before the range ends", async () => {
    const { getLogs } = await import("./ops");
    rpc.getLogs.mockResolvedValueOnce(Array.from({ length: 1_000 }, () => fakeLog) as never);
    const r = await getLogs({ address: ADDR, fromBlock: 0n, toBlock: 1_500n });
    expect(r.logs).toHaveLength(1_000);
    expect(r.truncated).toBe(true);
    expect(rpc.getLogs).toHaveBeenCalledTimes(1);
  });

  it("is truncated when one chunk overflows 1,000", async () => {
    const { getLogs } = await import("./ops");
    rpc.getLogs.mockResolvedValueOnce(Array.from({ length: 1_001 }, () => fakeLog) as never);
    const r = await getLogs({ address: ADDR, fromBlock: 0n, toBlock: 10n });
    expect(r.logs).toHaveLength(1_000);
    expect(r.truncated).toBe(true);
  });

  it("refuses a missing query object with the range reason (not a TypeError)", async () => {
    const { getLogs } = await import("./ops");
    await expect(getLogs(undefined as never)).rejects.toThrow(/valid non-negative block range/);
  });

  it("refuses a malformed address before any RPC", async () => {
    const { getLogs } = await import("./ops");
    for (const address of [`${ADDR}00`, `zz${ADDR}`, 5]) {
      await expect(getLogs({ address, fromBlock: 0n, toBlock: 1n } as never)).rejects.toThrow(/contract address/);
    }
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });
});

describe("/api/v1 proxy — other methods through the same chokepoint", () => {
  it("unknown method → -32600 and no RPC", async () => {
    const q = new URLSearchParams({ module: "proxy", action: "eth_sendRawTransaction", params: "[\"0x\"]" });
    const json = await (await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }))).json();
    expect(json.error).toEqual({ code: -32600, message: "method eth_sendRawTransaction not allowed" });
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("unparseable params on any method → -32602 and no RPC", async () => {
    const q = new URLSearchParams({ module: "proxy", action: "eth_blockNumber", params: "[" });
    const json = await (await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }))).json();
    expect(json.error).toEqual({ code: -32602, message: "params is not valid JSON" });
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("no params → the Etherscan-style defaults are built for the method", async () => {
    const q = new URLSearchParams({ module: "proxy", action: "eth_blockNumber" });
    const json = await (await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }))).json();
    expect(json.error).toBeUndefined();
    expect(rpc.request).toHaveBeenCalledWith({ method: "eth_blockNumber", params: [] });
  });

  it("default params: tag falls back to latest, explicit tag is kept", async () => {
    const call = async (q: Record<string, string>) =>
      v1(new Request(`http://x/api/v1?${new URLSearchParams({ module: "proxy", ...q })}`, { headers: { "x-forwarded-for": nextIp() } }));
    await call({ action: "eth_getBalance", address: ADDR });
    expect(rpc.request).toHaveBeenLastCalledWith({ method: "eth_getBalance", params: [ADDR, "latest"] });
    await call({ action: "eth_getBalance", address: ADDR, tag: "0x5" });
    expect(rpc.request).toHaveBeenLastCalledWith({ method: "eth_getBalance", params: [ADDR, "0x5"] });
  });

  it("explicit JSON params are used verbatim for a non-getLogs method", async () => {
    const q = new URLSearchParams({ module: "proxy", action: "eth_getBlockByNumber", params: "[\"0x5\",true]" });
    await v1(new Request(`http://x/api/v1?${q}`, { headers: { "x-forwarded-for": nextIp() } }));
    expect(rpc.request).toHaveBeenCalledWith({ method: "eth_getBlockByNumber", params: ["0x5", true] });
  });
});

describe("MCP transport edges", () => {
  it("empty batch → 400 -32600", async () => {
    const res = await mcpCall([]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: -32600, message: "Empty batch" });
  });

  it("unparseable body → 400 -32700", async () => {
    const res = await mcp(new Request("http://x/api/mcp", { method: "POST", headers: { "x-forwarded-for": nextIp() }, body: "{" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: -32700, message: "Parse error" });
  });

  it("a 429 carries -32000 and a retry-after header", async () => {
    const res = await mcpCall(Array.from({ length: 20 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" })));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toEqual({ code: -32000, message: "Rate limit exceeded" });
    // memory bucket: cost 20 - 5 tokens = 15 short at 2/s → ceil(7.5) = 8 s.
    expect(res.headers.get("retry-after")).toBe("8");
  });

  it("a batch of only notifications → 204", async () => {
    const res = await mcpCall([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(res.status).toBe(204);
  });

  it("a batch within the anonymous budget (5) is served", async () => {
    const res = await mcpCall(Array.from({ length: 5 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(5);
  });
});

describe("agent + MCP getLogs tool (EX-B-004)", () => {
  it("the shared tool schema requires address + explicit range", () => {
    const t = citrateTools().getLogs as unknown as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } };
    expect(t.inputSchema.safeParse({}).success).toBe(false);
    expect(t.inputSchema.safeParse({ address: ADDR }).success).toBe(false);
    expect(t.inputSchema.safeParse({ address: ADDR, fromBlock: 0, toBlock: 10 }).success).toBe(true);
  });

  it("MCP tools/call getLogs with no range is refused before any RPC", async () => {
    const res = await mcpCall({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getLogs", arguments: {} } });
    const json = await res.json();
    expect(json.error?.code).toBe(-32602);
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("MCP tools/call getLogs over the span cap errors before any RPC", async () => {
    const res = await mcpCall({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "getLogs", arguments: { address: ADDR, fromBlock: 0, toBlock: 50_000 } },
    });
    const json = await res.json();
    expect(json.result?.isError).toBe(true);
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });
});

describe("MCP batch (EX-B-003)", () => {
  it("rejects an oversized batch before dispatching any tool call", async () => {
    const call = { jsonrpc: "2.0", method: "tools/call", params: { name: "getLogs", arguments: { address: ADDR, fromBlock: 0, toBlock: 10 } } };
    const res = await mcpCall(Array.from({ length: 21 }, (_, id) => ({ ...call, id })));
    expect(res.status).toBe(400);
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("charges the limiter per message: a 20-message batch exhausts an anonymous bucket", async () => {
    // Anonymous MCP = 2/s, burst 5. A batch of 20 costs 20 tokens > 5 → 429.
    const res = await mcpCall(Array.from({ length: 20 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" })));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Source tripwire: any new call site that can reach eth_getLogs must be added
// here deliberately (and bounded). Dynamic-method raw RPC calls must go through
// the proxy guard.
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

describe("getLogs source tripwire", () => {
  const files = walk(SRC).map((f) => ({ rel: relative(SRC, f).replaceAll("\\", "/"), text: readFileSync(f, "utf8") }));

  it("only reviewed files reach the RPC getLogs", () => {
    // `.getLogs(` on a viem client, or a raw `eth_getLogs` request.
    const REVIEWED = new Set([
      "lib/harness/ops.ts", // bounded + chunked (assertLogRange)
    ]);
    const hits = files
      .filter(({ text }) => /\bc(lient)?\.getLogs\(|harnessClient\(\)\.getLogs\(|request\(\s*\{\s*method:\s*["']eth_getLogs/.test(text))
      .map(({ rel }) => rel);
    expect(hits.filter((h) => !REVIEWED.has(h))).toEqual([]);
  });

  it("every dynamic-method citrateRequest goes through the proxy guard", () => {
    // Reviewed call sites whose method variable is NOT caller-controlled.
    const REVIEWED_DYNAMIC = new Set([
      "lib/citrate/rpc.ts", // getDagBlock: method is one of two eth_getBlockBy* literals
    ]);
    const offenders = files
      .filter(({ text }) => /citrateRequest(<[^>]*>)?\(\s*[^,]+,\s*[A-Za-z_$][\w$]*\s*[,)]/.test(text))
      .filter(({ rel, text }) => !/guardProxyCall\(/.test(text) && !REVIEWED_DYNAMIC.has(rel))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the ops getLogs signature has no optional range (no earliest..latest default)", () => {
    const ops = files.find((f) => f.rel === "lib/harness/ops.ts")!.text;
    expect(ops).not.toMatch(/fromBlock\s*\?\?\s*["']earliest["']/);
    expect(ops).not.toMatch(/toBlock\s*\?\?\s*["']latest["']/);
  });
});
