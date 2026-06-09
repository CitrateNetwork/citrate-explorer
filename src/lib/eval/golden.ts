/**
 * Golden-set model for the agent eval harness (RA-1).
 *
 * A "golden record" is one evaluation question with: the personas it targets, the
 * capability class it exercises, the tools we expect the agent to call, a
 * machine-checkable assertion on the answer, and a ground-truth source (a static
 * invariant, or an RPC generator computed at run time — Rule 11: truth comes from
 * the chain, never hand-typed). Records that need a not-yet-built capability carry
 * `blocked_until` so the harness reports them separately instead of failing the
 * baseline dishonestly.
 *
 * This module is the single source of the schema; both the validation test
 * (`golden.test.ts`) and the eval runner (`scripts/eval/`) import it.
 */

export const PERSONAS = ["newcomer", "auditor", "native"] as const;
export type Persona = (typeof PERSONAS)[number];

export const CAPABILITY_CLASSES = [
  "chain", // basic chain facts (status, gas)
  "address", // address / contract investigation
  "dag", // GHOSTDAG ordering & finality
  "token", // ERC-20/721 metadata, holders, transfers
  "value", // amount-based queries ("when was 30k SALT sent")
  "native_vs_token", // SALT-vs-token disambiguation (X-3)
  "multistep", // chains of tool calls
] as const;
export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

export const ASSERTION_KINDS = [
  "contains_all", // answer (normalized) contains every string in `values`
  "contains_any", // answer contains at least one string in `values` (phrasing-tolerant)
  "address", // answer contains the 0x address in `values[0]` (case-insensitive)
  "numeric", // a number within `tolerance` (relative) of `number` appears
  "set_contains", // answer references every member of `values` (e.g. tx hashes)
  "labeled_native", // answer labels the value as native SALT (X-3)
  "labeled_token", // answer labels the value as the token in `token` (X-3)
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export interface AnswerAssertion {
  kind: AssertionKind;
  /** For contains_all / address / set_contains. */
  values?: string[];
  /** For numeric. */
  number?: number;
  /** Relative tolerance for numeric (0 = exact). Default 0. */
  tolerance?: number;
  unit?: string;
  /** For labeled_token. */
  token?: { symbol?: string; address?: string };
}

export type GroundTruthType = "static" | "rpc";

export interface GroundTruth {
  type: GroundTruthType;
  /** For rpc: the generator name (see scripts/eval ground-truth registry). */
  generator?: string;
  params?: Record<string, unknown>;
  /** Filled by the generator at run time so the value is reproducible. */
  pinnedAtBlock?: number | null;
}

export interface GoldenRecord {
  id: string;
  persona: Persona;
  class: CapabilityClass;
  question: string;
  /**
   * Tools that SHOULD be called. Scored as a set (precision/recall/F1). An empty
   * list means "no tool required" (a knowledge question) — such records are
   * excluded from the groundedness metric.
   */
  expected_tools: string[];
  answer_assertion: AnswerAssertion;
  ground_truth: GroundTruth;
  /** e.g. "RA-2" | "RA-3": excluded from the pass rate until that sprint lands. */
  blocked_until?: string | null;
  notes?: string;
}

/**
 * Tools planned by this planset but not yet implemented. Golden records may
 * reference these in `expected_tools` only when they are also `blocked_until` the
 * sprint that builds them. Keep in sync with PLANSET RA-2/RA-3/RA-4.
 */
export const FUTURE_TOOLS = [
  "tokenActivity",
  "richList",
  "holderBalances",
  "traceValueFlow",
  "contractIntrospect",
  "abiLookup",
] as const;

const ID_RE = /^[a-z][a-z0-9-]*$/;
const BLOCKED_RE = /^RA-\d+$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export interface ValidationOptions {
  /** Tool names that exist today (e.g. Object.keys(citrateTools())). */
  knownTools: readonly string[];
  /** Planned-but-unbuilt tools allowed for blocked_until records. */
  futureTools?: readonly string[];
}

/** Validate one record. Returns an array of human-readable errors (empty = valid). */
export function validateGoldenRecord(
  rec: unknown,
  opts: ValidationOptions,
): string[] {
  const errors: string[] = [];
  const r = rec as Partial<GoldenRecord>;
  const future = opts.futureTools ?? FUTURE_TOOLS;
  const allowedTools = new Set<string>([...opts.knownTools, ...future]);

  const fail = (m: string) => errors.push(m);

  if (typeof r.id !== "string" || !ID_RE.test(r.id)) {
    fail(`id "${String(r.id)}" must match ${ID_RE}`);
  }
  if (!PERSONAS.includes(r.persona as Persona)) {
    fail(`persona "${String(r.persona)}" not in ${PERSONAS.join("|")}`);
  }
  if (!CAPABILITY_CLASSES.includes(r.class as CapabilityClass)) {
    fail(`class "${String(r.class)}" not in ${CAPABILITY_CLASSES.join("|")}`);
  }
  if (typeof r.question !== "string" || r.question.trim().length === 0) {
    fail("question must be a non-empty string");
  }

  if (!Array.isArray(r.expected_tools)) {
    fail("expected_tools must be an array");
  } else {
    for (const t of r.expected_tools) {
      if (!allowedTools.has(t)) fail(`expected_tools: unknown tool "${t}"`);
      if (future.includes(t as (typeof FUTURE_TOOLS)[number]) && !r.blocked_until) {
        fail(`expected_tools references future tool "${t}" but record is not blocked_until a sprint`);
      }
    }
  }

  errors.push(...validateAssertion(r.answer_assertion, r.ground_truth));
  errors.push(...validateGroundTruth(r.ground_truth));

  if (r.blocked_until != null && (typeof r.blocked_until !== "string" || !BLOCKED_RE.test(r.blocked_until))) {
    fail(`blocked_until "${String(r.blocked_until)}" must match ${BLOCKED_RE} or be null`);
  }

  return errors;
}

function validateAssertion(a: AnswerAssertion | undefined, g: GroundTruth | undefined): string[] {
  const e: string[] = [];
  if (!a || typeof a !== "object") return ["answer_assertion missing"];
  if (!ASSERTION_KINDS.includes(a.kind)) return [`answer_assertion.kind "${String(a.kind)}" invalid`];
  // For RPC-backed truth the expected value is computed at run time by the
  // generator, so a static value-bearing field is not required on the record.
  const rpcSupplied = g?.type === "rpc";
  switch (a.kind) {
    case "contains_all":
    case "contains_any":
    case "set_contains":
      if (!rpcSupplied && (!Array.isArray(a.values) || a.values.length === 0)) {
        e.push(`${a.kind} needs non-empty values[] (or an rpc ground_truth)`);
      }
      break;
    case "address":
      if (!rpcSupplied && (!a.values?.[0] || !ADDR_RE.test(a.values[0]))) {
        e.push("address assertion needs a 0x… address in values[0] (or an rpc ground_truth)");
      }
      break;
    case "numeric":
      if (!rpcSupplied && typeof a.number !== "number") e.push("numeric assertion needs `number` (or an rpc ground_truth)");
      if (a.tolerance != null && (a.tolerance < 0 || a.tolerance > 1)) e.push("tolerance must be in [0,1]");
      break;
    case "labeled_token":
      if (!a.token || (!a.token.symbol && !a.token.address)) e.push("labeled_token needs token.symbol or token.address");
      break;
    case "labeled_native":
      break;
  }
  return e;
}

function validateGroundTruth(g: GroundTruth | undefined): string[] {
  if (!g || typeof g !== "object") return ["ground_truth missing"];
  if (g.type !== "static" && g.type !== "rpc") return [`ground_truth.type "${String(g.type)}" must be static|rpc`];
  if (g.type === "rpc" && (typeof g.generator !== "string" || g.generator.length === 0)) {
    return ["ground_truth.type=rpc requires a generator name"];
  }
  return [];
}

/** Parse a JSONL golden file (one record per non-empty, non-comment line). */
export function parseGoldenJsonl(text: string): GoldenRecord[] {
  const out: GoldenRecord[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("#")) return;
    try {
      out.push(JSON.parse(t) as GoldenRecord);
    } catch (err) {
      throw new Error(`golden JSONL parse error on line ${i + 1}: ${(err as Error).message}`);
    }
  });
  return out;
}

/** Records that count toward the live pass rate (not blocked on a future sprint). */
export function activeRecords(records: GoldenRecord[]): GoldenRecord[] {
  return records.filter((r) => r.blocked_until == null);
}
