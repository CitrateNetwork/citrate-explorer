/**
 * PBA-L3c-039: unit bounds for the raw eth_getLogs passthrough and the harness
 * range check. Each case isolates ONE rule (everything else valid) and asserts
 * the specific reason, so a mutant that drops any single check is caught.
 */
import { describe, it, expect } from "vitest";
import { assertLogRange, checkProxyGetLogs, MAX_PROXY_LOG_BLOCKS } from "./logBounds";
import { guardProxyCall } from "./allowlist";

const ADDR = "0x1111111111111111111111111111111111111111";
const W = `0x${"ab".repeat(32)}`;
const base = { address: ADDR, fromBlock: "0x0", toBlock: "0x1" };

function err(params: unknown): string {
  const r = checkProxyGetLogs(params);
  if (r.ok) throw new Error(`expected rejection, got ${JSON.stringify(r.params)}`);
  return r.error;
}

describe("assertLogRange", () => {
  it("accepts exactly maxBlocks blocks and rejects maxBlocks + 1", () => {
    expect(() => assertLogRange(0n, 9n, 10n)).not.toThrow();
    expect(() => assertLogRange(0n, 10n, 10n)).toThrow(/10 block limit/);
    expect(() => assertLogRange(5n, 14n, 10n)).not.toThrow();
    expect(() => assertLogRange(5n, 15n, 10n)).toThrow(/block limit/);
  });

  it("accepts a single-block range (from === to)", () => {
    expect(() => assertLogRange(7n, 7n, 1n)).not.toThrow();
  });

  it("rejects a non-bigint from or to on its own", () => {
    expect(() => assertLogRange(undefined, 5n)).toThrow(/valid non-negative block range/);
    expect(() => assertLogRange(0n, undefined)).toThrow(/valid non-negative block range/);
    expect(() => assertLogRange(0, 5n)).toThrow(/valid non-negative block range/);
  });

  it("rejects a negative start and an inverted range", () => {
    expect(() => assertLogRange(-1n, 5n)).toThrow(/valid non-negative block range/);
    expect(() => assertLogRange(6n, 5n)).toThrow(/valid non-negative block range/);
  });

  it("uses the span, not the sum, of the endpoints", () => {
    // from + to = 20_000 would trip a sum-based check; the span is 1 block.
    expect(() => assertLogRange(10_000n, 10_000n, 10n)).not.toThrow();
  });
});

describe("checkProxyGetLogs", () => {
  it("accepts a minimal bounded filter and returns a rebuilt copy", () => {
    const input = { ...base };
    const r = checkProxyGetLogs([input]);
    expect(r).toEqual({ ok: true, params: [base] });
    if (r.ok) expect(r.params[0]).not.toBe(input);
  });

  it("accepts the full passthrough span and rejects one more block", () => {
    const last = `0x${(MAX_PROXY_LOG_BLOCKS - 1n).toString(16)}`;
    const over = `0x${MAX_PROXY_LOG_BLOCKS.toString(16)}`;
    expect(checkProxyGetLogs([{ ...base, toBlock: last }]).ok).toBe(true);
    expect(err([{ ...base, toBlock: over }])).toMatch(/block limit/);
  });

  it("requires exactly one filter object", () => {
    expect(err([])).toMatch(/exactly one filter object/);
    expect(err([base, base])).toMatch(/exactly one filter object/);
    expect(err(base)).toMatch(/exactly one filter object/);
    expect(err([null])).toMatch(/exactly one filter object/);
    expect(err(["x"])).toMatch(/exactly one filter object/);
    expect(err([[base]])).toMatch(/exactly one filter object/);
  });

  it("refuses unknown keys", () => {
    expect(err([{ ...base, limit: 5 }])).toMatch(/unsupported filter key: limit/);
  });

  it("requires one well-formed address", () => {
    const { address: _a, ...noAddr } = base;
    void _a;
    expect(err([noAddr])).toMatch(/single contract address/);
    expect(err([{ ...base, address: [ADDR] }])).toMatch(/single contract address/);
    expect(err([{ ...base, address: `${ADDR}00` }])).toMatch(/single contract address/);
    expect(err([{ ...base, address: `zz${ADDR}` }])).toMatch(/single contract address/);
  });

  it("requires explicit hex quantities (no tags, no decimals, no padding)", () => {
    for (const bad of ["latest", "earliest", "pending", "12", "0x", "0x01", "0x0zz", "x0x1", 1]) {
      expect(err([{ ...base, fromBlock: bad }])).toMatch(/explicit hex fromBlock and toBlock/);
      expect(err([{ ...base, toBlock: bad }])).toMatch(/explicit hex fromBlock and toBlock/);
    }
    const { toBlock: _t, ...noTo } = base;
    void _t;
    expect(err([noTo])).toMatch(/explicit hex fromBlock and toBlock/);
    const { fromBlock: _f, ...noFrom } = base;
    void _f;
    expect(err([noFrom])).toMatch(/explicit hex fromBlock and toBlock/);
  });

  it("rejects an inverted range with the range reason", () => {
    expect(err([{ ...base, fromBlock: "0x2", toBlock: "0x1" }])).toMatch(/valid non-negative block range/);
  });

  describe("blockHash form", () => {
    it("accepts address + blockHash (+topics)", () => {
      expect(checkProxyGetLogs([{ address: ADDR, blockHash: W, topics: [W] }])).toEqual({
        ok: true,
        params: [{ address: ADDR, blockHash: W, topics: [W] }],
      });
    });
    it("refuses blockHash with either range endpoint", () => {
      expect(err([{ address: ADDR, blockHash: W, fromBlock: "0x0" }])).toMatch(/cannot be combined/);
      expect(err([{ address: ADDR, blockHash: W, toBlock: "0x0" }])).toMatch(/cannot be combined/);
    });
    it("refuses a malformed blockHash", () => {
      expect(err([{ address: ADDR, blockHash: 5 }])).toMatch(/blockHash must be a 32-byte/);
      expect(err([{ address: ADDR, blockHash: `${W}00` }])).toMatch(/blockHash must be a 32-byte/);
      expect(err([{ address: ADDR, blockHash: `00${W}` }])).toMatch(/blockHash must be a 32-byte/);
    });
  });

  describe("topics", () => {
    it("accepts 4 positions mixing null, a word, and 4 alternatives", () => {
      const topics = [W, null, [W, W, W, W], null];
      expect(checkProxyGetLogs([{ ...base, topics }])).toEqual({ ok: true, params: [{ ...base, topics }] });
    });
    it("refuses a non-array topics value", () => {
      expect(err([{ ...base, topics: W }])).toMatch(/topics must be an array/);
    });
    it("refuses a 5th position", () => {
      expect(err([{ ...base, topics: [null, null, null, null, null] }])).toMatch(/at most 4 topic positions/);
    });
    it("refuses a malformed single topic (short, long, prefixed)", () => {
      expect(err([{ ...base, topics: ["0x12"] }])).toMatch(/32-byte hex word/);
      expect(err([{ ...base, topics: [`${W}00`] }])).toMatch(/32-byte hex word/);
      expect(err([{ ...base, topics: [`00${W}`] }])).toMatch(/32-byte hex word/);
    });
    it("refuses 0 or 5 OR-alternatives, accepts 1", () => {
      expect(err([{ ...base, topics: [[]] }])).toMatch(/1 to 4 alternatives/);
      expect(err([{ ...base, topics: [[W, W, W, W, W]] }])).toMatch(/1 to 4 alternatives/);
      expect(checkProxyGetLogs([{ ...base, topics: [[W]] }]).ok).toBe(true);
    });
    it("refuses any bad word inside an OR-group (first or later, non-string)", () => {
      expect(err([{ ...base, topics: [["0x12", W]] }])).toMatch(/32-byte hex word/);
      expect(err([{ ...base, topics: [[W, "0x12"]] }])).toMatch(/32-byte hex word/);
      expect(err([{ ...base, topics: [[W, 5]] }])).toMatch(/32-byte hex word/);
    });
    it("refuses a non-null, non-string, non-array topic", () => {
      expect(err([{ ...base, topics: [5] }])).toMatch(/null, a 32-byte hex word, or an array/);
      expect(err([{ ...base, topics: [{}] }])).toMatch(/null, a 32-byte hex word, or an array/);
    });
  });
});

describe("guardProxyCall", () => {
  it("refuses a non-allowlisted method with -32601", () => {
    expect(guardProxyCall("eth_sendRawTransaction", ["0x"])).toEqual({
      ok: false,
      code: -32601,
      error: "method eth_sendRawTransaction not allowed",
    });
  });
  it("refuses non-array params with -32602", () => {
    expect(guardProxyCall("eth_blockNumber", {})).toEqual({ ok: false, code: -32602, error: "params must be an array" });
  });
  it("passes other allowlisted methods through unchanged", () => {
    const params = ["0x1", false];
    expect(guardProxyCall("eth_getBlockByNumber", params)).toEqual({ ok: true, params });
  });
  it("bounds eth_getLogs with -32602", () => {
    const r = guardProxyCall("eth_getLogs", [{ fromBlock: "earliest", toBlock: "latest" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(-32602);
    expect(guardProxyCall("eth_getLogs", [base])).toEqual({ ok: true, params: [base] });
  });
});

describe("type guards are not redundant with the regexes (verifier K1-K3)", () => {
  // RegExp.test coerces ["0x0"] to "0x0", so only the typeof checks reject array-wrapped fields.
  it("refuses array-wrapped fromBlock/toBlock", () => {
    expect(checkProxyGetLogs([{ address: ADDR, fromBlock: ["0x0"], toBlock: ["0x1"] }]).ok).toBe(false);
  });
  it("refuses a nested topic alternative", () => {
    expect(checkProxyGetLogs([{ ...base, topics: [[[W]]] }]).ok).toBe(false);
  });
  it("refuses an array-wrapped blockHash", () => {
    expect(checkProxyGetLogs([{ address: ADDR, blockHash: [W] }]).ok).toBe(false);
  });
});
