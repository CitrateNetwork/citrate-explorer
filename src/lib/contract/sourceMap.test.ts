import { describe, expect, it } from "vitest";
import { buildCrossMap, decodeSourceMap, lineOfOffset, sourceIndexByIdFromNames } from "./sourceMap";
import { disassemble } from "./disasm";
import fixture from "./__fixtures__/registry.json";

const files = Object.entries(fixture.stdJsonInput.sources).map(([path, s]) => ({ path, content: (s as { content: string }).content }));

describe("sourceMap: decoding the compressed form", () => {
  it("inherits empty fields from the previous entry", () => {
    expect(decodeSourceMap("1:2:0:i:0;;3;:9:1:o;-1:-1:-1:-:0")).toEqual([
      { s: 1, l: 2, f: 0, j: "i", m: 0 },
      { s: 1, l: 2, f: 0, j: "i", m: 0 },
      { s: 3, l: 2, f: 0, j: "i", m: 0 },
      { s: 3, l: 9, f: 1, j: "o", m: 0 },
      { s: -1, l: -1, f: -1, j: "-", m: 0 },
    ]);
  });

  it("decodes the fixture's map to one entry per instruction", () => {
    expect(decodeSourceMap(fixture.deployedSourceMap).length).toBe(disassemble(fixture.runtimeBytecode).length);
  });
});

describe("sourceMap: byte offsets to lines", () => {
  it("counts UTF-8 bytes, not UTF-16 units", () => {
    const text = "// é\nfoo\nbar";
    // "// é\n" is 6 bytes (é is 2 bytes), so byte 6 is the start of line 2
    expect(lineOfOffset(text, 0)).toBe(1);
    expect(lineOfOffset(text, 6)).toBe(2);
    expect(lineOfOffset(text, 10)).toBe(3);
  });

  it("assigns solc's ids by sorted source unit name", () => {
    expect(sourceIndexByIdFromNames(["src/lib/Owned.sol", "src/Registry.sol", "src/interfaces/IRegistry.sol"])).toEqual({ 0: 1, 1: 2, 2: 0 });
    const names = Object.keys(fixture.sourceIds);
    const byName = sourceIndexByIdFromNames(names);
    for (const [name, id] of Object.entries(fixture.sourceIds)) expect(names[byName[id as number]]).toBe(name);
  });
});

describe("sourceMap: cross-highlighting both ways", () => {
  const ins = disassemble(fixture.runtimeBytecode);
  const idx = Object.fromEntries(Object.entries(fixture.sourceIds).map(([n, id]) => [id, files.findIndex((f) => f.path === n)]));
  const cross = buildCrossMap(ins, decodeSourceMap(fixture.deployedSourceMap), files, idx);

  it("maps an opcode to its source range and back", () => {
    const regFile = files.findIndex((f) => f.path === "src/Registry.sol");
    const feeLine = files[regFile].content.split("\n").findIndex((l) => l.includes("revert FeeRequired")) + 1;
    const hits = cross.instructionsAt(regFile, feeLine);
    expect(hits.length).toBeGreaterThan(0);
    for (const k of hits) {
      const r = cross.rangeOf(k);
      expect(r).not.toBeNull();
      expect(r!.file).toBe(regFile);
      expect(r!.startLine).toBe(feeLine);
    }
  });

  it("reports compiler-generated instructions as having no source", () => {
    const generated = ins.findIndex((_, k) => cross.rangeOf(k) === null);
    expect(generated).toBeGreaterThanOrEqual(0);
  });

  it("lists the lines that have opcodes for one file", () => {
    const owned = files.findIndex((f) => f.path === "src/lib/Owned.sol");
    const lines = cross.linesWithInstructions(owned);
    const onlyOwner = files[owned].content.split("\n").findIndex((l) => l.includes("msg.sender != owner")) + 1;
    expect(lines.has(onlyOwner)).toBe(true);
  });
});
