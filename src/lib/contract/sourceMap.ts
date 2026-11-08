/**
 * solc source maps (EXP-S3): decode `evm.deployedBytecode.sourceMap` and map each
 * runtime instruction to a file and line range, and each line back to its
 * instructions, for cross-highlighting in the code pane. Pure.
 *
 * Format (solc docs, "Source Mappings"): entries `s:l:f:j:m` separated by `;`, one
 * per instruction; an empty field inherits the previous entry's value. `s` and `l`
 * are BYTE offsets into the UTF-8 source; `f = -1` means compiler-generated code.
 */
import type { Instruction } from "./disasm";
import type { SourceFile } from "./types";

export interface SourceMapEntry {
  s: number;
  l: number;
  f: number;
  j: string;
  m: number;
}

export function decodeSourceMap(map: string): SourceMapEntry[] {
  const out: SourceMapEntry[] = [];
  let prev: SourceMapEntry = { s: -1, l: -1, f: -1, j: "-", m: 0 };
  for (const part of map.split(";")) {
    const f = part.split(":");
    const num = (i: number, d: number) => (f[i] === undefined || f[i] === "" ? d : Number(f[i]));
    const cur: SourceMapEntry = {
      s: num(0, prev.s),
      l: num(1, prev.l),
      f: num(2, prev.f),
      j: f[3] === undefined || f[3] === "" ? prev.j : f[3],
      m: num(4, prev.m),
    };
    out.push(cur);
    prev = cur;
  }
  return out;
}

const enc = new TextEncoder();
const lineStartCache = new Map<string, number[]>();

/** Byte offsets at which each line starts (line 1 starts at 0). */
function lineStarts(text: string): number[] {
  const hit = lineStartCache.get(text);
  if (hit) return hit;
  const bytes = enc.encode(text);
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) starts.push(i + 1);
  if (lineStartCache.size > 64) lineStartCache.clear();
  lineStartCache.set(text, starts);
  return starts;
}

/** 1-based line containing a UTF-8 byte offset. */
export function lineOfOffset(text: string, byteOffset: number): number {
  const starts = lineStarts(text);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= byteOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * solc assigns source unit ids in sorted order of source unit names. Returns
 * id -> index into `names`.
 */
export function sourceIndexByIdFromNames(names: string[]): Record<number, number> {
  const sorted = [...names].sort();
  return Object.fromEntries(sorted.map((n, id) => [id, names.indexOf(n)]));
}

export interface SourceRange {
  file: number;
  startLine: number;
  endLine: number;
}

export interface CrossMap {
  /** Source range of instruction `index`, or null for compiler-generated code. */
  rangeOf(index: number): SourceRange | null;
  /** Instruction indices whose range starts on this line. */
  instructionsAt(file: number, line: number): number[];
  /** Lines of one file that have at least one instruction starting there. */
  linesWithInstructions(file: number): Set<number>;
}

export function buildCrossMap(
  instructions: Instruction[],
  entries: SourceMapEntry[],
  sources: SourceFile[],
  sourceIndexById: Record<number, number>,
): CrossMap {
  const ranges: (SourceRange | null)[] = instructions.map((_, k) => {
    const e = entries[k];
    if (!e || e.f < 0 || e.s < 0) return null;
    const file = sourceIndexById[e.f];
    if (file === undefined || !sources[file]) return null;
    const text = sources[file].content;
    return { file, startLine: lineOfOffset(text, e.s), endLine: lineOfOffset(text, Math.max(e.s, e.s + e.l - 1)) };
  });
  const byLine = new Map<string, number[]>();
  ranges.forEach((r, k) => {
    if (!r) return;
    const key = `${r.file}:${r.startLine}`;
    const list = byLine.get(key);
    if (list) list.push(k);
    else byLine.set(key, [k]);
  });
  return {
    rangeOf: (k) => ranges[k] ?? null,
    instructionsAt: (file, line) => byLine.get(`${file}:${line}`) ?? [],
    linesWithInstructions: (file) => {
      const s = new Set<number>();
      for (const r of ranges) if (r && r.file === file) s.add(r.startLine);
      return s;
    },
  };
}
