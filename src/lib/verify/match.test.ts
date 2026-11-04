import { describe, it, expect } from "vitest";
import { linkFrom, maskedRuntimeHash, matchCreation, matchRuntime } from "./match";

/**
 * EXP-S2 matching, on hand-built bytecode so each rule is visible:
 * library link placeholders, immutables, CBOR metadata, library call protection,
 * creation input = init code + constructor args.
 */

/** solc's standard metadata blob: 0x33 bytes of CBOR + the 2-byte length 0x0033. */
function cbor(hashByte: string): string {
  return "a2646970667358221220" + hashByte.repeat(32) + "64736f6c6343" + "00081a" + "0033";
}

const LIB = "1111111111111111111111111111111111111111";
const PLACEHOLDER = "__$0123456789abcdef0123456789abcdef01$__"; // 40 chars, solc's shape
const IMM_VALUE = "00000000000000000000000000000000000000000000000000000000000000ff";
const IMM_ZERO = "0".repeat(64);

// runtime: 6080 6040 | 73 <lib 20 bytes> | 7f <immutable 32 bytes> | 00 | cbor
// byte offsets: lib at 5..25, immutable at 26..58
const RUNTIME_PREFIX = "60806040" + "73";
const compiledRuntime = (meta = "aa") => RUNTIME_PREFIX + PLACEHOLDER + "7f" + IMM_ZERO + "00" + cbor(meta);
const onchainRuntime = (meta = "aa", lib = LIB, imm = IMM_VALUE) => "0x" + RUNTIME_PREFIX + lib + "7f" + imm + "00" + cbor(meta);
const LINKS = { "src/L.sol": { L: [{ start: 5, length: 20 }] } };
const IMMUTABLES = { "7": [{ start: 26, length: 32 }] };

describe("matchRuntime (EXP-S2)", () => {
  it("full match: library placeholder linked from chain, immutable masked, metadata identical", () => {
    const m = matchRuntime(
      { object: compiledRuntime(), linkReferences: LINKS, immutableReferences: IMMUTABLES },
      onchainRuntime(),
    );
    expect(m.match).toBe("full");
    expect(m.libraries).toEqual({ "src/L.sol:L": `0x${LIB}` });
    expect(m.isLibrary).toBe(false);
  });

  it("partial match: only the CBOR metadata hash differs", () => {
    const m = matchRuntime(
      { object: compiledRuntime("aa"), linkReferences: LINKS, immutableReferences: IMMUTABLES },
      onchainRuntime("bb"),
    );
    expect(m.match).toBe("partial");
  });

  it("no match when the code differs outside immutables and metadata", () => {
    const other = "0x" + "60806041" + "73" + LIB + "7f" + IMM_VALUE + "00" + cbor("aa");
    expect(matchRuntime({ object: compiledRuntime(), linkReferences: LINKS, immutableReferences: IMMUTABLES }, other).match).toBeNull();
  });

  it("no match when immutables are not masked (the compiler's references are required)", () => {
    expect(matchRuntime({ object: compiledRuntime(), linkReferences: LINKS }, onchainRuntime()).match).toBeNull();
  });

  it("a deployed library matches: its call-protection self address is zeroed", () => {
    const self = "5fbdb2315678afecb367f032d93f642f64180aa3";
    const compiled = "73" + "0".repeat(40) + "3014" + "6080" + cbor("cc");
    const onchain = "0x73" + self + "3014" + "6080" + cbor("cc");
    const m = matchRuntime({ object: compiled }, onchain);
    expect(m.match).toBe("full");
    expect(m.isLibrary).toBe(true);
  });

  it("refuses a library that would resolve to two different addresses", () => {
    const refs = { "src/L.sol": { L: [{ start: 0, length: 20 }, { start: 20, length: 20 }] } };
    expect(linkFrom(PLACEHOLDER + PLACEHOLDER, refs, LIB + "2".repeat(40))).toBeNull();
  });
});

describe("matchCreation (EXP-S2)", () => {
  // init code: 6080 | 73 <lib placeholder> | 6000 | runtime... ending in cbor
  const initCompiled = (meta = "aa") => "6080" + "73" + PLACEHOLDER + "6000" + "5b5b" + cbor(meta);
  const initOnchain = (meta = "aa") => "6080" + "73" + LIB + "6000" + "5b5b" + cbor(meta);
  const ARGS = "0000000000000000000000000000000000000000000000000000000000000007";
  const CREATION_LINKS = { "src/L.sol": { L: [{ start: 3, length: 20 }] } };
  const libs = { "src/L.sol:L": `0x${LIB}` };

  it("full: input = linked init code + constructor args; the args are read off the transaction", () => {
    const m = matchCreation({ object: initCompiled(), linkReferences: CREATION_LINKS }, "0x" + initOnchain() + ARGS, libs, null);
    expect(m.match).toBe("full");
    expect(m.constructorArgs).toBe(ARGS);
    expect(m.suppliedArgsDiffer).toBe(false);
  });

  it("flags supplied constructor args that differ from the transaction's", () => {
    const m = matchCreation({ object: initCompiled(), linkReferences: CREATION_LINKS }, "0x" + initOnchain() + ARGS, libs, "ff".repeat(32));
    expect(m.match).toBe("full");
    expect(m.constructorArgs).toBe(ARGS);
    expect(m.suppliedArgsDiffer).toBe(true);
  });

  it("partial: only the trailing metadata blob differs; args still recovered", () => {
    const m = matchCreation({ object: initCompiled("aa"), linkReferences: CREATION_LINKS }, "0x" + initOnchain("bb") + ARGS, libs, null);
    expect(m.match).toBe("partial");
    expect(m.constructorArgs).toBe(ARGS);
  });

  it("partial with supplied args when the metadata differs", () => {
    const m = matchCreation({ object: initCompiled("aa"), linkReferences: CREATION_LINKS }, "0x" + initOnchain("bb") + ARGS, libs, ARGS);
    expect(m.match).toBe("partial");
    expect(m.constructorArgs).toBe(ARGS);
  });

  it("no match for a different init code", () => {
    const m = matchCreation({ object: initCompiled(), linkReferences: CREATION_LINKS }, "0x6081" + initOnchain().slice(4) + ARGS, libs, null);
    expect(m.match).toBeNull();
    expect(m.constructorArgs).toBeNull();
  });

  it("no match when the creation input links a different library than the runtime", () => {
    const m = matchCreation({ object: initCompiled(), linkReferences: CREATION_LINKS }, "0x" + initOnchain() + ARGS, { "src/L.sol:L": `0x${"9".repeat(40)}` }, null);
    expect(m.match).toBeNull();
  });
});

describe("maskedRuntimeHash (similar matches)", () => {
  it("is equal for two deployments that differ only in immutable values", () => {
    const a = onchainRuntime("aa", LIB, IMM_VALUE);
    const b = onchainRuntime("aa", LIB, "00".repeat(31) + "01");
    expect(maskedRuntimeHash(a, IMMUTABLES, false)).toBe(maskedRuntimeHash(b, IMMUTABLES, false));
  });

  it("differs when the linked library differs", () => {
    const a = onchainRuntime("aa", LIB);
    const b = onchainRuntime("aa", "2".repeat(40));
    expect(maskedRuntimeHash(a, IMMUTABLES, false)).not.toBe(maskedRuntimeHash(b, IMMUTABLES, false));
  });
});
