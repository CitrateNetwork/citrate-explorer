import { describe, expect, it } from "vitest";
import { assertLogRequest, MAX_LOG_SPAN } from "./rpcReader";

const A = "0x1111111111111111111111111111111111111111";

describe("rpcReader: eth_getLogs is bounded before the client is touched (PBA-L3c-039)", () => {
  it("accepts one address over at most the node's span", () => {
    expect(() => assertLogRequest({ address: A, fromBlock: 0n, toBlock: MAX_LOG_SPAN - 1n })).not.toThrow();
  });
  it("refuses a missing address, an inverted or oversized range, and too many topics", () => {
    expect(() => assertLogRequest({ address: "", fromBlock: 0n, toBlock: 1n })).toThrow(/address/);
    expect(() => assertLogRequest({ address: A, fromBlock: 5n, toBlock: 1n })).toThrow(/range/);
    expect(() => assertLogRequest({ address: A, fromBlock: 0n, toBlock: MAX_LOG_SPAN })).toThrow(/spans/);
    expect(() => assertLogRequest({ address: A, fromBlock: 0n, toBlock: 1n, topics: [null, null, null, null, null] })).toThrow(/topic/);
    expect(() => assertLogRequest({ address: A, fromBlock: 0n, toBlock: 1n, topics: [["0x1", "0x2", "0x3", "0x4", "0x5"]] })).toThrow(/alternatives/);
  });
});
