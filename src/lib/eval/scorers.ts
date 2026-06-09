/**
 * Scorers for the agent eval harness (RA-1 WP-1.4).
 *
 * Four metric families turn a golden run into numbers:
 *  - tool-selection: precision / recall / F1 of called vs expected tools
 *  - groundedness:   did a tool-expecting answer actually call ≥1 tool
 *  - accuracy:       does the answer satisfy its assertion (vs live ground truth)
 *  - latency/steps:  how fast, how many agentic steps
 *
 * The accuracy scorer enforces X-3: a value answer must say WHICH asset it is
 * (native SALT vs a specific token) or it does not count as correct.
 */
import type { AnswerAssertion, GoldenRecord } from "./golden";
import type { TruthValue } from "./groundTruth";
import type { ChatRunResult } from "./chatDriver";

// --- tool selection ---------------------------------------------------------

export interface ToolSelectionScore {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export function scoreToolSelection(expected: string[], called: string[]): ToolSelectionScore {
  const exp = new Set(expected);
  const got = new Set(called);
  let tp = 0;
  for (const t of got) if (exp.has(t)) tp += 1;
  const fp = got.size - tp;
  const fn = exp.size - tp;
  // No expectation and no call → perfect (knowledge question answered tool-free).
  if (exp.size === 0 && got.size === 0) return { precision: 1, recall: 1, f1: 1, tp: 0, fp: 0, fn: 0 };
  const precision = got.size === 0 ? (exp.size === 0 ? 1 : 0) : tp / got.size;
  const recall = exp.size === 0 ? 1 : tp / exp.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

// --- accuracy ---------------------------------------------------------------

export type AccuracyOutcome = "pass" | "fail" | "indeterminate" | "not_supported";

const norm = (s: string) => s.toLowerCase();

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Match an expected address tolerant of truncation — small models routinely abbreviate
 * (`0xaceaa7…`, `0xaceaa7d0...`). We accept the answer if it contains the leading
 * `0x` + first 6 hex chars (collision-negligible for our address set), which also
 * matches the full address.
 */
function addressMatch(answer: string, addr: string): boolean {
  const a = norm(answer);
  const lower = norm(addr);
  return a.includes(lower) || a.includes(lower.slice(0, 8)); // 0x + 6 hex
}

/** Substring match, but address-typed expected values match tolerant of truncation. */
function valueMatch(answer: string, value: string): boolean {
  return ADDR_RE.test(value) ? addressMatch(answer, value) : norm(answer).includes(norm(value));
}

export function extractNumbers(text: string): number[] {
  const cleaned = text.replace(/(\d),(?=\d)/g, "$1"); // 30,000 -> 30000
  const matches = cleaned.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

function numericPass(answer: string, expected: number, tolerance = 0): boolean {
  const tol = Math.abs(tolerance);
  const nums = extractNumbers(answer);
  return nums.some((n) => {
    const allowed = Math.max(tol * Math.abs(expected), expected === 0 ? tol : 0);
    return Math.abs(n - expected) <= allowed + 1e-9;
  });
}

const containsAll = (answer: string, values: string[]) => values.every((v) => valueMatch(answer, v));
const containsAny = (answer: string, values: string[]) => values.some((v) => valueMatch(answer, v));

function labeledNative(answer: string): boolean {
  const hasSalt = /\bSALT\b/i.test(answer);
  const mislabeled = /erc-?20|erc-?721|token transfer|\btoken\b/i.test(answer) && !/native/i.test(answer);
  return hasSalt && !mislabeled;
}

function labeledToken(answer: string, token?: { symbol?: string; address?: string }): boolean {
  if (!token) return false;
  const idHit =
    (token.symbol ? norm(answer).includes(norm(token.symbol)) : false) ||
    (token.address ? norm(answer).includes(norm(token.address)) : false);
  return idHit && /token|erc-?20|erc-?721/i.test(answer);
}

/**
 * Score one answer against its assertion. `truth` is the resolved ground truth for
 * rpc-backed records (null for static). Returns an outcome; only pass/fail count
 * toward accuracy (indeterminate/not_supported are excluded).
 */
export function scoreAccuracy(
  assertion: AnswerAssertion,
  answer: string,
  truth: TruthValue | null,
): AccuracyOutcome {
  if (truth?.kind === "unsupported") return "not_supported";
  if (truth?.kind === "indeterminate") return "indeterminate";
  if (!answer.trim()) return "fail";

  // Resolve the expected payload: prefer live truth, else the static assertion.
  const expectedValues: string[] | undefined =
    truth && (truth.kind === "strings" || truth.kind === "address") ? truth.values : assertion.values;
  const expectedNumber: number | undefined =
    truth && truth.kind === "number" ? truth.number : assertion.number;

  const ok = (b: boolean): AccuracyOutcome => (b ? "pass" : "fail");

  switch (assertion.kind) {
    case "contains_all":
      return expectedValues ? ok(containsAll(answer, expectedValues)) : "indeterminate";
    case "contains_any":
      return expectedValues ? ok(containsAny(answer, expectedValues)) : "indeterminate";
    case "address":
      return expectedValues?.[0] ? ok(addressMatch(answer, expectedValues[0])) : "indeterminate";
    case "set_contains":
      return expectedValues ? ok(containsAll(answer, expectedValues)) : "indeterminate";
    case "numeric":
      return typeof expectedNumber === "number"
        ? ok(numericPass(answer, expectedNumber, assertion.tolerance ?? 0))
        : "indeterminate";
    case "labeled_native":
      return ok(labeledNative(answer));
    case "labeled_token":
      return ok(labeledToken(answer, assertion.token));
    default:
      return "indeterminate";
  }
}

// --- per-item + aggregate ---------------------------------------------------

export interface ItemRun {
  record: GoldenRecord;
  result: ChatRunResult;
  truth: TruthValue | null;
}

export interface ItemScore {
  id: string;
  class: GoldenRecord["class"];
  blocked: boolean;
  tool: ToolSelectionScore;
  groundednessApplies: boolean; // expected_tools non-empty
  grounded: boolean;
  accuracy: AccuracyOutcome;
  latencyMs: number;
  steps: number;
}

export function scoreItem(run: ItemRun): ItemScore {
  const { record, result, truth } = run;
  const tool = scoreToolSelection(record.expected_tools, result.toolCalls.map((t) => t.name));
  const groundednessApplies = record.expected_tools.length > 0;
  return {
    id: record.id,
    class: record.class,
    blocked: record.blocked_until != null,
    tool,
    groundednessApplies,
    grounded: result.toolCalls.length > 0,
    accuracy: scoreAccuracy(record.answer_assertion, result.answerText, truth),
    latencyMs: result.latencyMs,
    steps: result.steps,
  };
}

export interface AggregateMetrics {
  scored: number; // pass+fail accuracy denominator
  notYetSupported: number;
  indeterminate: number;
  toolF1: number;
  groundedness: number;
  accuracy: number;
  accuracyByClass: Record<string, number>;
  latencyP50: number;
  latencyP95: number;
  meanSteps: number;
}

export function meanStdev(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdev: Math.sqrt(variance) };
}

/**
 * Aggregate K independent suite runs into stable, variance-aware metrics. Per-item
 * pass-rate (fraction of scored runs that passed) exposes flaky items; the headline
 * metrics carry a stdev so a single lucky/unlucky run can't masquerade as signal.
 */
export interface MultiRunMetrics {
  runs: number;
  accuracy: { mean: number; stdev: number };
  toolF1: { mean: number; stdev: number };
  groundedness: { mean: number; stdev: number };
  latencyP50Mean: number;
  perItemPassRate: Record<string, number>;
  flaky: string[]; // items with a pass-rate strictly between 0 and 1
  accuracyByClassMean: Record<string, number>;
}

export function aggregateRuns(runs: ItemScore[][]): MultiRunMetrics {
  const perRun = runs.map(aggregate);
  const acc = meanStdev(perRun.map((m) => m.accuracy));
  const f1 = meanStdev(perRun.map((m) => m.toolF1));
  const grnd = meanStdev(perRun.map((m) => m.groundedness));
  const p50 = perRun.map((m) => m.latencyP50);

  // Per-item pass-rate over runs where the item was actually scored (pass|fail).
  const byId: Record<string, { pass: number; scored: number }> = {};
  for (const run of runs) {
    for (const it of run) {
      if (it.blocked) continue;
      if (it.accuracy === "pass" || it.accuracy === "fail") {
        const e = (byId[it.id] ??= { pass: 0, scored: 0 });
        e.scored += 1;
        if (it.accuracy === "pass") e.pass += 1;
      }
    }
  }
  const perItemPassRate: Record<string, number> = {};
  const flaky: string[] = [];
  for (const [id, v] of Object.entries(byId)) {
    const rate = v.scored ? v.pass / v.scored : 0;
    perItemPassRate[id] = rate;
    if (rate > 0 && rate < 1) flaky.push(id);
  }

  // Mean per-class accuracy across runs.
  const classSums: Record<string, number[]> = {};
  for (const m of perRun) {
    for (const [c, v] of Object.entries(m.accuracyByClass)) (classSums[c] ??= []).push(v);
  }
  const accuracyByClassMean: Record<string, number> = {};
  for (const [c, vs] of Object.entries(classSums)) accuracyByClassMean[c] = meanStdev(vs).mean;

  return {
    runs: runs.length,
    accuracy: acc,
    toolF1: f1,
    groundedness: grnd,
    latencyP50Mean: meanStdev(p50).mean,
    perItemPassRate,
    flaky,
    accuracyByClassMean,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Aggregate per-item scores into the BENCH metrics. Blocked items are excluded. */
export function aggregate(items: ItemScore[]): AggregateMetrics {
  const live = items.filter((i) => !i.blocked);

  const f1s = live.map((i) => i.tool.f1);
  const toolF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;

  const groundItems = live.filter((i) => i.groundednessApplies);
  const groundedness = groundItems.length
    ? groundItems.filter((i) => i.grounded).length / groundItems.length
    : 1;

  const scored = live.filter((i) => i.accuracy === "pass" || i.accuracy === "fail");
  const passes = scored.filter((i) => i.accuracy === "pass").length;
  const accuracy = scored.length ? passes / scored.length : 0;

  const byClass: Record<string, { pass: number; total: number }> = {};
  for (const i of scored) {
    const c = (byClass[i.class] ??= { pass: 0, total: 0 });
    c.total += 1;
    if (i.accuracy === "pass") c.pass += 1;
  }
  const accuracyByClass: Record<string, number> = {};
  for (const [c, v] of Object.entries(byClass)) accuracyByClass[c] = v.total ? v.pass / v.total : 0;

  const latencies = live.map((i) => i.latencyMs);
  const steps = live.map((i) => i.steps);

  return {
    scored: scored.length,
    notYetSupported: live.filter((i) => i.accuracy === "not_supported").length,
    indeterminate: live.filter((i) => i.accuracy === "indeterminate").length,
    toolF1,
    groundedness,
    accuracy,
    accuracyByClass,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    meanSteps: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0,
  };
}
