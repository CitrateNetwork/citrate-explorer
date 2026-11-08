import { describe, expect, it } from "vitest";
import { disassemble, dispatcherEntries, opcodeName, splitMetadata } from "./disasm";
import fixture from "./__fixtures__/registry.json";

describe("disasm: opcode table", () => {
  it("names current opcodes, including Shanghai/Cancun additions", () => {
    expect(opcodeName(0x00)).toBe("STOP");
    expect(opcodeName(0x5f)).toBe("PUSH0");
    expect(opcodeName(0x5c)).toBe("TLOAD");
    expect(opcodeName(0x5e)).toBe("MCOPY");
    expect(opcodeName(0x7f)).toBe("PUSH32");
    expect(opcodeName(0xfe)).toBe("INVALID");
    expect(opcodeName(0xef)).toBe("UNKNOWN_0xef");
  });
});

describe("disasm: decoding", () => {
  it("decodes push immediates and program counters", () => {
    const ins = disassemble("0x6080604052348015600e575f80fd5b");
    expect(ins.slice(0, 4).map((i) => [i.pc, i.name, i.push ?? null])).toEqual([
      [0, "PUSH1", "0x80"],
      [2, "PUSH1", "0x40"],
      [4, "MSTORE", null],
      [5, "CALLVALUE", null],
    ]);
    expect(ins.map((i) => i.index)).toEqual(ins.map((_, k) => k));
  });

  it("marks a push that runs past the end as truncated", () => {
    const ins = disassemble("0x61ff");
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({ name: "PUSH2", push: "0xff", truncated: true });
  });

  it("splits the CBOR metadata trailer off solc output", () => {
    const { code, metadata } = splitMetadata(fixture.runtimeBytecode);
    expect(metadata).not.toBeNull();
    expect(metadata!.startsWith("0xa2")).toBe(true);
    expect((code.length - 2) / 2 + (metadata!.length - 2) / 2 + 2).toBe((fixture.runtimeBytecode.length - 2) / 2);
    expect(splitMetadata("0x6080").metadata).toBeNull();
  });

  it("lines up with solc's source map: one entry per instruction, except the INVALID separator before the metadata", () => {
    const ins = disassemble(fixture.runtimeBytecode);
    expect(ins.length).toBe(fixture.deployedSourceMap.split(";").length + 1);
    expect(ins[ins.length - 1].name).toBe("INVALID");
  });

  it("finds every external function in the dispatcher", () => {
    const ins = disassemble(fixture.runtimeBytecode);
    const sels = dispatcherEntries(ins).map((e) => e.selector).sort();
    // keccak4 of the fixture's external functions (fee, owner, register, resolve, entryOf, tag, importEntries, setFee, transferOwnership)
    const expected = ["0x69fe0e2d", "0x8da5cb5b", "0xddca3f43", "0xf2c298be", "0xf2fde38b", "0x461a4478"];
    for (const s of expected) expect(sels).toContain(s);
    expect(sels.length).toBe(9);
    for (const e of dispatcherEntries(ins)) expect(ins.find((i) => i.pc === e.entryPc)?.name).toBe("JUMPDEST");
  });
});
