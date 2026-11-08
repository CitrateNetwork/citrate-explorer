/**
 * `contract_source`: a verified contract's source files, compiler settings and,
 * when a deployed source map is on record, the source line for a program counter.
 *
 * Data source (Rule 11): the verification store (`getVerifiedSource`, the
 * `contract_verifications` table) and eth_getCode for the runtime bytecode the
 * pc indexes into. Nothing is recompiled here.
 *
 * Source text and NatSpec are attacker-authored: the agent tool wraps every file
 * as untrusted data before it reaches the model (contractTools.ts).
 */
import type { VerifiedSource } from "@/lib/verify/verifiedSource";
import { pcToSource, type PcLookup, type SourceFile } from "./sourceMap";

export interface ParsedSources {
  format: "standard-json" | "single-file";
  files: SourceFile[];
  /** Compiler settings from a standard-JSON input (outputSelection dropped); null for single-file. */
  settings: Record<string, unknown> | null;
}

/**
 * Split a stored verification source into files. A standard-JSON input keeps its
 * paths; solc numbers source units in sorted path order, which is what the
 * source map's file index refers to.
 */
export function parseSources(source: string): ParsedSources {
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as { sources?: Record<string, { content?: string }>; settings?: Record<string, unknown> };
      if (j && j.sources && typeof j.sources === "object") {
        const paths = Object.keys(j.sources).sort();
        const files = paths.map((path, id) => ({ id, path, content: String(j.sources![path]?.content ?? "") }));
        const settings = j.settings ? Object.fromEntries(Object.entries(j.settings).filter(([k]) => k !== "outputSelection")) : null;
        return { format: "standard-json", files, settings };
      }
    } catch {
      /* not JSON: a flattened single file that starts with a brace is not valid Solidity anyway */
    }
  }
  return { format: "single-file", files: [{ id: 0, path: "Contract.sol", content: source }], settings: null };
}

export interface SourceMapRecord {
  /** solc `evm.deployedBytecode.sourceMap` */
  deployedSourceMap: string;
}

export interface ContractSourceDeps {
  verified: (address: string) => Promise<VerifiedSource>;
  /** The deployed source map for this address, when the verification record stores one. */
  sourceMap: (address: string) => Promise<SourceMapRecord | null>;
  code: (address: string) => Promise<string>;
}

export interface ContractSourceResult {
  address: string;
  status: VerifiedSource["status"];
  verified: boolean;
  contractName: string | null;
  compiler: { version: string | null; settings: Record<string, unknown> | null; settingsNote: string };
  files: Array<{ path: string; chars: number; content: string; truncated: boolean }>;
  pc: PcLookup | null;
  note: string;
}

export const DEFAULT_SOURCE_CHARS = 20_000;

export async function contractSource(address: string, opts: { pc?: number; maxChars?: number }, deps: ContractSourceDeps): Promise<ContractSourceResult> {
  const vs = await deps.verified(address);
  // Read the whole stored source for structure; the per-call cap applies to what we return.
  const base = {
    address: vs.address,
    status: vs.status,
    verified: vs.verified,
    contractName: vs.contractName,
  };
  if (!vs.source) {
    return {
      ...base,
      compiler: { version: vs.compilerVersion, settings: null, settingsNote: "no verified source" },
      files: [],
      pc: opts.pc === undefined ? null : { found: false, pc: opts.pc, reason: "no verified source for this address" },
      note: vs.note,
    };
  }
  const parsed = parseSources(vs.source);
  let budget = Math.max(1, opts.maxChars ?? DEFAULT_SOURCE_CHARS);
  const files = parsed.files.map((f) => {
    const take = Math.max(0, Math.min(f.content.length, budget));
    budget -= take;
    return { path: f.path, chars: f.content.length, content: f.content.slice(0, take), truncated: take < f.content.length };
  });

  let pc: PcLookup | null = null;
  if (opts.pc !== undefined) {
    const map = await deps.sourceMap(vs.address);
    if (!map) {
      pc = { found: false, pc: opts.pc, reason: "this contract's verification record does not include a deployed source map, so a pc cannot be mapped to a line" };
    } else if (vs.sourceTruncated) {
      pc = { found: false, pc: opts.pc, reason: "the stored source is larger than the lookup cap" };
    } else {
      pc = pcToSource({ bytecode: await deps.code(vs.address), sourceMap: map.deployedSourceMap, sources: parsed.files, pc: opts.pc });
    }
  }

  return {
    ...base,
    compiler: {
      version: vs.compilerVersion,
      settings: parsed.settings,
      settingsNote:
        parsed.format === "standard-json"
          ? "Settings from the submitted standard-JSON input."
          : "Single-file submission: only the compiler version is on record (optimizer and EVM settings were not stored).",
    },
    files,
    pc,
    note: vs.note,
  };
}
