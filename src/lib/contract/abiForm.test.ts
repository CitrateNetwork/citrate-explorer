import { describe, expect, it } from "vitest";
import type { AbiParameter } from "viem";
import { arrayInfo, emptyValue, formatValue, parseArg, parseArgs, typeLabel } from "./abiForm";
import fixture from "./__fixtures__/registry.json";

const entryTuple: AbiParameter = {
  name: "batch",
  type: "tuple[]",
  components: [
    { name: "owner", type: "address" },
    { name: "since", type: "uint64" },
    { name: "tags", type: "bytes32[]" },
  ],
};

const B32 = "0x" + "ab".repeat(32);

describe("abiForm: field model", () => {
  it("parses the outer array dimension, fixed and dynamic, including nested", () => {
    expect(arrayInfo({ name: "", type: "uint256[]" })).toEqual({ inner: { name: "", type: "uint256" }, length: null });
    expect(arrayInfo({ name: "", type: "address[3]" })).toEqual({ inner: { name: "", type: "address" }, length: 3 });
    expect(arrayInfo({ name: "", type: "uint8[2][]" })?.inner.type).toBe("uint8[2]");
    expect(arrayInfo({ name: "", type: "uint8[2][]" })?.length).toBeNull();
    expect(arrayInfo({ name: "", type: "uint256" })).toBeNull();
  });

  it("builds empty values: scalars, tuples, fixed arrays sized, dynamic arrays empty", () => {
    expect(emptyValue({ name: "", type: "string" })).toBe("");
    expect(emptyValue({ name: "", type: "address[2]" })).toEqual(["", ""]);
    expect(emptyValue({ name: "", type: "bytes32[]" })).toEqual([]);
    expect(emptyValue(entryTuple.components ? { name: "e", type: "tuple", components: entryTuple.components } : entryTuple)).toEqual(["", "", []]);
  });

  it("labels canonical types, expanding tuples", () => {
    expect(typeLabel(entryTuple)).toBe("(address,uint64,bytes32[])[]");
    expect(typeLabel({ name: "", type: "uint256" })).toBe("uint256");
  });
});

describe("abiForm: parsing user input", () => {
  it("parses integers in decimal and hex, with range checks", () => {
    expect(parseArg({ name: "x", type: "uint8" }, "255")).toEqual({ ok: true, value: 255n });
    expect(parseArg({ name: "x", type: "uint256" }, "0x10")).toEqual({ ok: true, value: 16n });
    expect(parseArg({ name: "x", type: "uint8" }, "256").ok).toBe(false);
    expect(parseArg({ name: "x", type: "uint8" }, "-1").ok).toBe(false);
    expect(parseArg({ name: "x", type: "int8" }, "-128")).toEqual({ ok: true, value: -128n });
    expect(parseArg({ name: "x", type: "int8" }, "128").ok).toBe(false);
    expect(parseArg({ name: "x", type: "uint256" }, "1.5").ok).toBe(false);
    expect(parseArg({ name: "x", type: "uint256" }, "").ok).toBe(false);
  });

  it("parses bools strictly", () => {
    expect(parseArg({ name: "b", type: "bool" }, "true")).toEqual({ ok: true, value: true });
    expect(parseArg({ name: "b", type: "bool" }, "0")).toEqual({ ok: true, value: false });
    expect(parseArg({ name: "b", type: "bool" }, "yes").ok).toBe(false);
  });

  it("checks addresses, including a wrong mixed-case checksum", () => {
    const ok = parseArg({ name: "a", type: "address" }, "0xaa918302b94a4b0e75e01e019cc6b819b4f7c906");
    expect(ok).toEqual({ ok: true, value: "0xAa918302B94a4B0E75E01e019cc6b819B4F7c906" });
    expect(parseArg({ name: "a", type: "address" }, "0xAA918302b94a4b0e75e01e019cc6b819b4f7c906").ok).toBe(false);
    expect(parseArg({ name: "a", type: "address" }, "0x1234").ok).toBe(false);
  });

  it("checks bytes and bytesN lengths", () => {
    expect(parseArg({ name: "d", type: "bytes" }, "0xdeadbeef")).toEqual({ ok: true, value: "0xdeadbeef" });
    expect(parseArg({ name: "d", type: "bytes" }, "0xabc").ok).toBe(false);
    expect(parseArg({ name: "n", type: "bytes32" }, B32)).toEqual({ ok: true, value: B32 });
    expect(parseArg({ name: "n", type: "bytes32" }, "0xabcd").ok).toBe(false);
    expect(parseArg({ name: "n", type: "bytes4" }, "0x12345678")).toEqual({ ok: true, value: "0x12345678" });
  });

  it("parses nested tuple arrays into viem-shaped values and reports the failing path", () => {
    const ok = parseArg(entryTuple, [["0x000000000000000000000000000000000000dEaD", "7", [B32]]]);
    expect(ok).toEqual({
      ok: true,
      value: [{ owner: "0x000000000000000000000000000000000000dEaD", since: 7n, tags: [B32] }],
    });
    const bad = parseArg(entryTuple, [["0x000000000000000000000000000000000000dEaD", "x", []]]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.path).toBe("batch[0].since");
  });

  it("requires a fixed array to have exactly its length", () => {
    expect(parseArg({ name: "p", type: "uint256[2]" }, ["1"]).ok).toBe(false);
    expect(parseArg({ name: "p", type: "uint256[2]" }, ["1", "2"])).toEqual({ ok: true, value: [1n, 2n] });
  });

  it("parses a whole input list and collects every error", () => {
    const fn = fixture.abi.find((x) => x.type === "function" && x.name === "importEntries")!;
    const inputs = (fn as { inputs: AbiParameter[] }).inputs;
    const r = parseArgs(inputs, [["bad"], [["0x1", "1", []]]]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(["nodes[0]", "batch[0].owner"]);
  });
});

describe("abiForm: formatting outputs", () => {
  it("formats nested structs and arrays readably", () => {
    const out: AbiParameter = { name: "", type: "tuple", components: entryTuple.components! as AbiParameter[] };
    const text = formatValue(out, { owner: "0x000000000000000000000000000000000000dEaD", since: 7n, tags: [B32] });
    expect(text).toBe(`{ owner: 0x000000000000000000000000000000000000dEaD, since: 7, tags: [${B32}] }`);
    expect(formatValue({ name: "", type: "bool" }, true)).toBe("true");
    expect(formatValue({ name: "", type: "uint256[]" }, [1n, 2n])).toBe("[1, 2]");
  });
});
