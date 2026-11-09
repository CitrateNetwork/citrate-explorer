import { describe, it, expect, afterEach } from "vitest";
import { encodeEventTopics, encodeFunctionData, encodeAbiParameters, parseAbi, toFunctionSelector } from "viem";
import { createContractModule, coerceArg, pickFunction, PROXY_SLOTS, preparedWriteId } from "./contractModule";
import { fakeChain, ALICE, MALLORY, TOKEN, TOKEN_ABI, PROXY, IMPL, UNVERIFIED, EOA, CLONE } from "./tests/fakeChain";
import type { AbiItem } from "@/lib/contracts/types";

const mod = (o?: Parameters<typeof fakeChain>[0]) => {
  const f = fakeChain(o);
  return { ...f, m: createContractModule(f.deps) };
};

afterEach(() => {
  delete process.env.RELAY_TARGET_ALLOWLIST;
});

describe("proxy detection", () => {
  it("derives the EIP-1967 slots from their labels", () => {
    expect(PROXY_SLOTS.implementation).toBe("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
    expect(PROXY_SLOTS.admin).toBe("0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103");
    expect(PROXY_SLOTS.beacon).toBe("0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50");
  });

  it("reads an EIP-1967 implementation slot", async () => {
    const { m } = mod();
    const p = await m.detectProxy(PROXY);
    expect(p).toMatchObject({ isProxy: true, kind: "eip1967" });
    expect(p.implementation?.toLowerCase()).toBe(IMPL.toLowerCase());
    expect(p.evidence).toContain("EIP-1967 implementation slot");
  });

  it("recognises an EIP-1167 minimal proxy by its bytecode", async () => {
    const { m } = mod();
    const p = await m.detectProxy(CLONE);
    expect(p.kind).toBe("eip1167");
    expect(p.implementation?.toLowerCase()).toBe(IMPL.toLowerCase());
  });

  it("reports a plain contract as not a proxy", async () => {
    const { m } = mod();
    expect((await m.detectProxy(TOKEN)).isProxy).toBe(false);
  });
});

describe("ABI resolution", () => {
  it("uses the verified ABI", async () => {
    const r = await mod().m.resolveAbi(TOKEN);
    expect(r.source).toBe("verified");
    expect(r.abi?.some((x) => x.name === "transfer")).toBe(true);
  });

  it("uses the verified implementation ABI behind a proxy", async () => {
    const r = await mod().m.resolveAbi(PROXY);
    expect(r.source).toBe("implementation");
    expect(r.implementation?.toLowerCase()).toBe(IMPL.toLowerCase());
    expect(r.abi?.some((x) => x.name === "stake")).toBe(true);
  });

  it("returns no ABI for an unverified contract and says so", async () => {
    const r = await mod().m.resolveAbi(UNVERIFIED);
    expect(r.source).toBe("none");
    expect(r.abi).toBeNull();
    expect(r.note).toMatch(/Not verified/);
  });
});

describe("identify", () => {
  it("labels ERC-20 as a heuristic and reports no ERC-165", async () => {
    const id = await mod().m.identify(TOKEN);
    expect(id.isContract).toBe(true);
    expect(id.verification.status).toBe("verified");
    expect(id.interfaces.erc165).toBe(false);
    expect(id.interfaces.erc20Heuristic).toBe(true);
    expect(id.interfaces.method.join(" ")).toMatch(/heuristic/);
    expect(id.token).toMatchObject({ name: "Test Token", symbol: "TST", decimals: 18 });
  });

  it("reports an EOA without probing", async () => {
    const id = await mod().m.identify(EOA);
    expect(id.isContract).toBe(false);
    expect(id.note).toMatch(/EOA/);
  });
});

describe("read", () => {
  it("encodes, calls eth_call at the head and decodes", async () => {
    const { m, calls } = mod();
    const r = await m.read({ address: TOKEN, function: "balanceOf", args: [ALICE] });
    expect(r).toMatchObject({ function: "balanceOf", signature: "balanceOf(address)", abiSource: "verified", block: "1234" });
    expect(r.result[0]).toMatchObject({ type: "uint256", value: "1000" });
    expect(calls.some((c) => c.method === "eth_call")).toBe(true);
  });

  it("reads at a given block", async () => {
    const r = await mod().m.read({ address: TOKEN, function: "totalSupply", args: [], block: 99n });
    expect(r.block).toBe("99");
  });

  it("reads an unverified contract from a caller-supplied signature, labelled", async () => {
    const { m } = mod();
    const r = await m.read({ address: PROXY, function: "staked(address) returns (uint256)", args: [ALICE] });
    expect(r.result[0].value).toBe("7");
  });

  it("refuses an unknown function with a caller-facing message", async () => {
    await expect(mod().m.read({ address: TOKEN, function: "nope", args: [] })).rejects.toThrow(/no function "nope"/);
  });
});

describe("decode", () => {
  it("decodes calldata with the verified ABI", async () => {
    const data = encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [MALLORY, 5n] });
    const d = await mod().m.decodeCalldata({ data, address: TOKEN });
    expect(d).toMatchObject({ decodedWith: "verified-abi", function: "transfer", signature: "transfer(address,uint256)" });
    expect(d.args.map((a) => a.value)).toEqual([expect.stringMatching(/bad1$/i), "5"]);
  });

  it("falls back to a well-known signature, labelled as such", async () => {
    const data = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [MALLORY, 1n] });
    const d = await mod().m.decodeCalldata({ data, address: UNVERIFIED });
    expect(d.decodedWith).toBe("known-signature");
    expect(d.note).toMatch(/nothing verified/);
  });

  it("reports an unknown selector honestly", async () => {
    const d = await mod().m.decodeCalldata({ data: "0xdeadbeef" });
    expect(d).toMatchObject({ decodedWith: "unknown", function: null });
  });

  it("decodes a log with the emitter's verified ABI", async () => {
    const topics = encodeEventTopics({ abi: TOKEN_ABI, eventName: "Transfer", args: { from: ALICE, to: MALLORY } });
    const data = encodeAbiParameters([{ type: "uint256" }], [9n]);
    const l = await mod().m.decodeLog({ address: TOKEN, topics: topics as `0x${string}`[], data });
    expect(l).toMatchObject({ decodedWith: "verified-abi", event: "Transfer" });
    expect(l.args.find((a) => a.name === "value")?.value).toBe("9");
  });
});

describe("prepareWrite", () => {
  it("returns a non-executable PreparedWrite with a successful simulation from the sender", async () => {
    const p = await mod().m.prepareWrite({ address: TOKEN, function: "transfer", args: [MALLORY, "10"], from: ALICE, origin: "chat" });
    expect(p.executable).toBe(false);
    expect(p.chainId).toBe(40204);
    expect(p.call).toMatchObject({ function: "transfer", signature: "transfer(address,uint256)", selector: toFunctionSelector("transfer(address,uint256)") });
    expect(p.simulation).toMatchObject({ ok: true, gasEstimate: "50000", gasPriceWei: "1000000000", blockNumber: "1234" });
    expect(p.simulation.from?.toLowerCase()).toBe(ALICE.toLowerCase());
    expect(p.simulation.feeSalt).toBe("0.00005");
    expect(p.risk.elevated).toBe(false);
    // requestId is the canonical hash (stable across re-simulation); id is the kit
    // preparation's own id, unique per preparation, which an approval binds to.
    expect(p.requestId).toBe(preparedWriteId({ from: p.from, to: p.target.address, data: p.call.data, valueWei: 0n }));
    const again = await mod().m.prepareWrite({ address: TOKEN, function: "transfer", args: [MALLORY, "10"], from: ALICE, origin: "chat" });
    expect(again.requestId).toBe(p.requestId);
    expect(again.id).not.toBe(p.id);
  });

  it("decodes the custom-error revert reason and flags it elevated", async () => {
    const p = await mod().m.prepareWrite({ address: TOKEN, function: "transfer", args: [MALLORY, "5000"], from: ALICE, origin: "chat" });
    expect(p.simulation.ok).toBe(false);
    expect(p.simulation.revertReason).toBe("InsufficientBalance(have: 1000, want: 5000)");
    expect(p.risk.flags.map((f) => f.code)).toContain("simulation-reverted");
    expect(p.risk.elevated).toBe(true);
    expect(p.risk.confirmPhrase).toBe("transfer");
  });

  it("decodes an Error(string) revert", async () => {
    const p = await mod().m.prepareWrite({ address: UNVERIFIED, function: "revertMe(string)", args: ["nope"], from: ALICE, origin: "mcp" });
    expect(p.simulation.revertReason).toBe("nope");
    expect(p.target.abiSource).toBe("signature");
  });

  it("refuses a view function and points to contract_read", async () => {
    await expect(mod().m.prepareWrite({ address: TOKEN, function: "balanceOf", args: [ALICE], origin: "chat" })).rejects.toThrow(/contract_read/);
  });

  it("refuses value on a non-payable function", async () => {
    await expect(mod().m.prepareWrite({ address: TOKEN, function: "transfer", args: [MALLORY, "1"], value: "1", origin: "chat" })).rejects.toThrow(/not payable/);
  });

  it("refuses the wrong number of arguments", async () => {
    await expect(mod().m.prepareWrite({ address: TOKEN, function: "transfer", args: [MALLORY], origin: "chat" })).rejects.toThrow(/expected 2 argument/);
  });

  it("is not relay-eligible for a non-allowlisted target, and says why", async () => {
    const p = await mod().m.prepareWrite({ address: TOKEN, function: "approve", args: [MALLORY, "1"], from: ALICE, origin: "chat" });
    expect(p.relay).toEqual({ eligible: false, reason: "The gasless relay only sponsors calls to Citrate federation contracts.", gas: null });
  });

  it("is relay-eligible for an allowlisted zero-value call, within the gas cap", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const p = await mod().m.prepareWrite({ address: TOKEN, function: "approve", args: [MALLORY, "1"], from: ALICE, origin: "chat" });
    expect(p.relay.eligible).toBe(true);
    // The kit signs the relay request with its fixed sponsored gas (GASLESS_GAS), within the relay's cap.
    expect(p.relay.gas).toBe("300000");
  });

  it("is not relay-eligible when the target does not trust the Citrate forwarder (ERC-2771)", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const f = fakeChain({ forwarder: "0x7100000000000000000000000000000000000071" });
    const m = createContractModule({ ...f.deps, forwarder: () => "0x7000000000000000000000000000000000000007" });
    const p = await m.prepareWrite({ address: TOKEN, function: "approve", args: [MALLORY, "1"], from: ALICE, origin: "chat" });
    expect(p.relay.eligible).toBe(false);
    expect(p.relay.reason).toMatch(/forwarder/);
  });

  it("is not relay-eligible when no forwarder is provisioned", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const f = fakeChain();
    const m = createContractModule({ ...f.deps, forwarder: () => null });
    const p = await m.prepareWrite({ address: TOKEN, function: "approve", args: [MALLORY, "1"], from: ALICE, origin: "chat" });
    expect(p.relay).toMatchObject({ eligible: false, gas: null });
  });

  it("never relays value", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const p = await mod().m.prepareWrite({ address: TOKEN, function: "deposit", args: [], value: "0.5", from: ALICE, origin: "chat" });
    expect(p.relay.eligible).toBe(false);
    expect(p.relay.reason).toMatch(/value/);
  });

  it("has no path to a signer: the reader exposes no send or sign method", async () => {
    const { reader } = fakeChain();
    const methods = Object.keys(reader);
    for (const m of methods) expect(m).not.toMatch(/send|sign|write/i);
  });
});

describe("argument coercion", () => {
  const p = (type: string, extra: Partial<AbiItem["inputs"] extends (infer X)[] | undefined ? X : never> = {}) => ({ name: "x", type, ...extra });
  it("coerces integers from decimal, hex and numbers", () => {
    expect(coerceArg(p("uint256"), "10")).toBe(10n);
    expect(coerceArg(p("uint256"), "0x10")).toBe(16n);
    expect(coerceArg(p("int8"), -3)).toBe(-3n);
  });
  it("rejects malformed values with the argument name", () => {
    expect(() => coerceArg(p("address"), "0x12")).toThrow(/argument x \(address\)/);
    expect(() => coerceArg(p("uint256"), "1.5")).toThrow(/integer/);
    expect(() => coerceArg(p("bytes32"), "0x1234")).toThrow(/exactly 32 bytes/);
  });
  it("coerces arrays and tuples, including JSON strings", () => {
    expect(coerceArg(p("uint256[]"), "[1,2]")).toEqual([1n, 2n]);
    expect(coerceArg(p("tuple", { components: [{ name: "a", type: "uint8" }, { name: "b", type: "bool" }] }), { a: "1", b: "true" })).toEqual({ a: 1n, b: true });
  });
  it("disambiguates overloaded functions by signature", () => {
    const abi = parseAbi(["function f(uint256)", "function f(address)"]) as unknown as AbiItem[];
    expect(() => pickFunction(abi, "f")).toThrow(/overloaded/);
    expect(pickFunction(abi, "f(address)")?.inputs?.[0].type).toBe("address");
  });
});
