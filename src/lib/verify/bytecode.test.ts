import { describe, it, expect } from "vitest";
import { stripMetadata, maskImmutables, matchBytecode } from "./bytecode";

describe("verify/bytecode — metadata + immutable handling", () => {
  it("strips the trailing CBOR metadata (… + 2-byte length)", () => {
    // runtime "aabb" + metadata "cccc" (2 bytes) + length 0x0002
    expect(stripMetadata("0xaabbcccc0002")).toBe("aabb");
    expect(stripMetadata("aabbcccc0002")).toBe("aabb");
  });

  it("masks immutable byte ranges (placeholder vs baked value)", () => {
    // bytes: 00 11 22 33 ; mask byte index 1, length 1 → "11" becomes "00"
    expect(maskImmutables("0x00112233", { "42": [{ start: 1, length: 1 }] })).toBe("00002233");
  });

  it("reports a FULL match for identical bytecode (incl. metadata)", () => {
    expect(matchBytecode("0xabcdef0000", "0xabcdef0000")).toBe("full");
  });

  it("reports a PARTIAL match when only the metadata differs", () => {
    // same runtime "abcd", different metadata blob, same 2-byte length 0x0002
    expect(matchBytecode("0xabcd11110002", "0xabcd22220002")).toBe("partial");
  });

  it("reports a FULL match once an immutable difference is masked", () => {
    // differ only at the immutable byte (index 2) → equal after masking
    const compiled = "0xaabb00000000"; // placeholder zeros
    const onChain = "0xaabbdeadbeef".replace("deadbeef", "deadbeef"); // baked value
    const refs = { "1": [{ start: 2, length: 4 }] };
    expect(matchBytecode(compiled, onChain, refs)).toBe("full");
  });

  it("reports NONE for genuinely different bytecode", () => {
    expect(matchBytecode("0xaabbccdd", "0x11223344")).toBe("none");
    expect(matchBytecode("0x", "0xaabb")).toBe("none");
  });
});
