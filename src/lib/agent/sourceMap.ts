/**
 * Program counter → source line, from a solc deployed source map (EXP-AGENT
 * `contract_source`). Pure.
 *
 * A solc source map has one entry per INSTRUCTION, not per byte, so the pc is
 * first turned into an instruction index by walking the bytecode (PUSH1..PUSH32
 * carry 1..32 immediate bytes). Entries are `s:l:f:j:m` and inherit any empty
 * field from the previous entry. `f = -1` means compiler-generated code with no
 * source file.
 */

export interface SourceMapEntry {
  /** byte offset into the source file */
  s: number;
  /** length in bytes */
  l: number;
  /** source file index, -1 for generated code */
  f: number;
  j: string;
}

export function decodeSourceMap(map: string): SourceMapEntry[] {
  const out: SourceMapEntry[] = [];
  let prev: SourceMapEntry = { s: 0, l: 0, f: -1, j: "-" };
  for (const item of map.split(";")) {
    const [s, l, f, j] = item.split(":");
    const cur: SourceMapEntry = {
      s: s !== undefined && s !== "" ? Number(s) : prev.s,
      l: l !== undefined && l !== "" ? Number(l) : prev.l,
      f: f !== undefined && f !== "" ? Number(f) : prev.f,
      j: j !== undefined && j !== "" ? j : prev.j,
    };
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** The instruction index at byte offset `pc`, or null when pc is not an opcode boundary. */
export function pcToInstructionIndex(bytecode: string, pc: number): number | null {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  const len = hex.length / 2;
  if (!Number.isInteger(pc) || pc < 0 || pc >= len) return null;
  let i = 0;
  let idx = 0;
  while (i < len) {
    if (i === pc) return idx;
    if (i > pc) return null;
    const op = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    // PUSH1 (0x60) .. PUSH32 (0x7f) carry op - 0x5f immediate bytes; PUSH0 (0x5f) carries none.
    i += op >= 0x60 && op <= 0x7f ? 1 + (op - 0x5f) : 1;
    idx += 1;
  }
  return null;
}

/** 1-based line and column of a byte offset in `content` (UTF-8 byte offsets, as solc reports). */
export function offsetToLineColumn(content: string, byteOffset: number): { line: number; column: number } {
  const bytes = new TextEncoder().encode(content);
  const head = new TextDecoder().decode(bytes.slice(0, Math.max(0, Math.min(byteOffset, bytes.length))));
  const lines = head.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

export interface SourceFile {
  /** solc source id (the `f` in the source map) */
  id: number;
  path: string;
  content: string;
}

export type PcLookup =
  | { found: true; pc: number; instruction: number; path: string; line: number; column: number; snippet: string }
  | { found: false; pc: number; reason: string };

export function pcToSource(p: { bytecode: string; sourceMap: string; sources: SourceFile[]; pc: number }): PcLookup {
  const instruction = pcToInstructionIndex(p.bytecode, p.pc);
  if (instruction === null) return { found: false, pc: p.pc, reason: "pc is outside the code or inside a PUSH immediate, not at an instruction" };
  const entries = decodeSourceMap(p.sourceMap);
  const e = entries[instruction];
  if (!e) return { found: false, pc: p.pc, reason: "the source map has no entry for this instruction" };
  if (e.f < 0) return { found: false, pc: p.pc, reason: "compiler-generated code with no source file" };
  const file = p.sources.find((s) => s.id === e.f);
  if (!file) return { found: false, pc: p.pc, reason: `source file id ${e.f} is not in the verified sources` };
  const { line, column } = offsetToLineColumn(file.content, e.s);
  const bytes = new TextEncoder().encode(file.content);
  const snippet = new TextDecoder().decode(bytes.slice(e.s, e.s + Math.min(e.l, 400)));
  return { found: true, pc: p.pc, instruction, path: file.path, line, column, snippet };
}
