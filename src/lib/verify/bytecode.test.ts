import { describe, it, expect } from "vitest";
import { stripMetadata, maskImmutables, matchBytecode } from "./bytecode";

/** solc's CBOR map {solc: 0.8.26} (bytecodeHash none) + its 2-byte length. */
const SOLC_ONLY = "a164736f6c634300081a" + "000a";
/** solc's default CBOR map {ipfs: <34 bytes>, solc: 0.8.26} + its 2-byte length. */
const ipfsMeta = (b: string) => "a2646970667358221220" + b.repeat(32) + "64736f6c6343" + "00081a" + "0033";

describe("verify/bytecode — metadata + immutable handling", () => {
  it("strips the trailing CBOR metadata (… + 2-byte length)", () => {
    // runtime "aabb" + a solc CBOR map {solc: 0.8.26} (10 bytes) + length 0x000a
    expect(stripMetadata("0xaabb" + SOLC_ONLY)).toBe("aabb");
    expect(stripMetadata("aabb" + SOLC_ONLY)).toBe("aabb");
  });

  it("leaves code alone when its last two bytes are not the length of a CBOR map", () => {
    // Plain code whose final bytes happen to read as a small length.
    expect(stripMetadata("0x600160026003010005")).toBe("600160026003010005");
    expect(stripMetadata("0x6001aabbcc0003")).toBe("6001aabbcc0003");
  });

  it("no PARTIAL match for different code without metadata whose last bytes read as lengths", () => {
    expect(matchBytecode("0x6001aabbcc0003", "0x600160026003010005")).toBe("none");
  });

  it("masks immutable byte ranges (placeholder vs baked value)", () => {
    // bytes: 00 11 22 33 ; mask byte index 1, length 1 → "11" becomes "00"
    expect(maskImmutables("0x00112233", { "42": [{ start: 1, length: 1 }] })).toBe("00002233");
  });

  it("reports a FULL match for identical bytecode (incl. metadata)", () => {
    expect(matchBytecode("0xabcdef0000", "0xabcdef0000")).toBe("full");
  });

  it("reports a PARTIAL match when only the metadata differs", () => {
    // same runtime "abcd", different CBOR metadata blob, same 2-byte length
    expect(matchBytecode("0xabcd" + ipfsMeta("11"), "0xabcd" + ipfsMeta("22"))).toBe("partial");
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
