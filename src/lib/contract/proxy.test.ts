import { describe, expect, it } from "vitest";
import { pad, type Hex } from "viem";
import { memoryReader } from "./testReader.testutil";
import {
  EIP1822_PROXIABLE_SLOT,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  UPGRADED_TOPIC,
  detectProxy,
  implementationHistory,
  pageRanges,
  parseMinimalProxy,
} from "./proxy";

const PROXY = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const IMPL_OLD = "0x3333333333333333333333333333333333333333";
const BEACON = "0x4444444444444444444444444444444444444444";
const ADMIN = "0x5555555555555555555555555555555555555555";
const word = (a: string) => pad(a as Hex, { size: 32 });
const SOME_CODE = "0x6080604052" as Hex;

describe("proxy: slot constants", () => {
  it("are the EIP-1967 / EIP-1822 values", () => {
    expect(EIP1967_IMPLEMENTATION_SLOT).toBe("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
    expect(EIP1967_BEACON_SLOT).toBe("0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50");
    expect(EIP1967_ADMIN_SLOT).toBe("0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103");
    expect(EIP1822_PROXIABLE_SLOT).toBe("0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7");
    expect(UPGRADED_TOPIC).toBe("0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b");
  });
});

describe("proxy: EIP-1167 minimal proxies", () => {
  it("parses the standard clone and the PUSH0 variant, and rejects other code", () => {
    const std = `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3`;
    expect(parseMinimalProxy(std)).toBe("0x2222222222222222222222222222222222222222");
    const push0 = `0x365f5f375f5f365f73${IMPL.slice(2)}5af43d5f5f3e5f3d91602a57fd5bf3`;
    expect(parseMinimalProxy(push0)).toBe("0x2222222222222222222222222222222222222222");
    expect(parseMinimalProxy(SOME_CODE)).toBeNull();
  });

  it("is detected from code alone", async () => {
    const r = memoryReader({ code: { [PROXY]: `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex, [IMPL]: SOME_CODE } });
    expect(await detectProxy(r, PROXY)).toMatchObject({ kind: "eip1167", implementation: "0x2222222222222222222222222222222222222222" });
  });
});

describe("proxy: storage-slot proxies", () => {
  it("detects EIP-1967 with its admin", async () => {
    const r = memoryReader({
      code: { [PROXY]: SOME_CODE, [IMPL]: SOME_CODE },
      storage: { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL), [EIP1967_ADMIN_SLOT]: word(ADMIN) } },
    });
    expect(await detectProxy(r, PROXY)).toEqual({
      kind: "eip1967",
      implementation: "0x2222222222222222222222222222222222222222",
      slot: EIP1967_IMPLEMENTATION_SLOT,
      admin: "0x5555555555555555555555555555555555555555",
      beacon: null,
    });
  });

  it("detects a beacon proxy and asks the beacon for the implementation", async () => {
    const r = memoryReader({
      code: { [PROXY]: SOME_CODE, [BEACON]: SOME_CODE, [IMPL]: SOME_CODE },
      storage: { [PROXY]: { [EIP1967_BEACON_SLOT]: word(BEACON) } },
      calls: [{ to: BEACON, data: "0x5c60da1b", result: word(IMPL) }],
    });
    expect(await detectProxy(r, PROXY)).toMatchObject({
      kind: "eip1967-beacon",
      implementation: "0x2222222222222222222222222222222222222222",
      beacon: "0x4444444444444444444444444444444444444444",
    });
  });

  it("detects EIP-1822 (UUPS PROXIABLE slot)", async () => {
    const r = memoryReader({
      code: { [PROXY]: SOME_CODE, [IMPL]: SOME_CODE },
      storage: { [PROXY]: { [EIP1822_PROXIABLE_SLOT]: word(IMPL) } },
    });
    expect(await detectProxy(r, PROXY)).toMatchObject({ kind: "eip1822", implementation: "0x2222222222222222222222222222222222222222" });
  });

  it("ignores a slot that points at an address with no code", async () => {
    const r = memoryReader({ code: { [PROXY]: SOME_CODE }, storage: { [PROXY]: { [EIP1967_IMPLEMENTATION_SLOT]: word(IMPL) } } });
    expect(await detectProxy(r, PROXY)).toBeNull();
  });

  it("returns null for a plain contract", async () => {
    expect(await detectProxy(memoryReader({ code: { [PROXY]: SOME_CODE } }), PROXY)).toBeNull();
  });
});

describe("proxy: implementation history from Upgraded events", () => {
  it("splits a range into node-sized pages, newest first", () => {
    expect(pageRanges(0n, 2499n, 1000n)).toEqual([
      [1500n, 2499n],
      [500n, 1499n],
      [0n, 499n],
    ]);
    expect(pageRanges(10n, 5n, 1000n)).toEqual([]);
  });

  it("reads Upgraded logs page by page and returns newest first", async () => {
    const log = (impl: string, block: bigint) => ({
      address: PROXY,
      topics: [UPGRADED_TOPIC, word(impl)],
      data: "0x" as Hex,
      blockNumber: block,
      transactionHash: pad("0x1", { size: 32 }),
      logIndex: 0,
    });
    const r = memoryReader({ head: 4_200n, logs: [log(IMPL_OLD, 120n), log(IMPL, 3_900n)] });
    const h = await implementationHistory(r, PROXY, { fromBlock: 0n, toBlock: 4_200n });
    expect(h.entries.map((e) => [e.implementation, e.blockNumber])).toEqual([
      ["0x2222222222222222222222222222222222222222", 3_900n],
      ["0x3333333333333333333333333333333333333333", 120n],
    ]);
    expect(h.scanned).toEqual({ fromBlock: 0n, toBlock: 4_200n });
    expect(r.getLogsCalls.every(([a, b]) => b - a + 1n <= 1000n)).toBe(true);
  });
});
