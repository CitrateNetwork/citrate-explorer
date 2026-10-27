/**
 * The shared getLogs tool schema (in-app agent and MCP) requires a contract
 * address AND an explicit non-negative integer range. getlogs-entrypoints.test.ts
 * covers a missing range; this pins each remaining required field on its own.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/harness/client", () => ({
  HARNESS_TIMEOUT_MS: 9_000,
  harnessClient: () => ({ request: vi.fn(), getLogs: vi.fn(async () => []) }),
}));

import { citrateTools } from "@/lib/ai/tools";

const ADDR = "0x1111111111111111111111111111111111111111";
type Schema = { safeParse: (x: unknown) => { success: boolean } };
const schema = () => (citrateTools().getLogs as unknown as { inputSchema: Schema }).inputSchema;

describe("getLogs tool schema", () => {
  it("accepts one address with an explicit range", () => {
    expect(schema().safeParse({ address: ADDR, fromBlock: 0, toBlock: 10 }).success).toBe(true);
  });

  it("refuses a range without an address", () => {
    expect(schema().safeParse({ fromBlock: 0, toBlock: 10 }).success).toBe(false);
  });

  it("refuses a malformed address", () => {
    expect(schema().safeParse({ address: "0x1234", fromBlock: 0, toBlock: 10 }).success).toBe(false);
  });

  it("refuses a missing toBlock or fromBlock on its own", () => {
    expect(schema().safeParse({ address: ADDR, fromBlock: 0 }).success).toBe(false);
    expect(schema().safeParse({ address: ADDR, toBlock: 10 }).success).toBe(false);
  });

  it("refuses negative, fractional and tag-string blocks", () => {
    expect(schema().safeParse({ address: ADDR, fromBlock: -1, toBlock: 10 }).success).toBe(false);
    expect(schema().safeParse({ address: ADDR, fromBlock: 0.5, toBlock: 10 }).success).toBe(false);
    expect(schema().safeParse({ address: ADDR, fromBlock: "earliest", toBlock: "latest" }).success).toBe(false);
  });
});
