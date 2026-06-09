/**
 * Agent eval runner (RA-1 WP-1.5; N-run averaging RA-1.5).
 *
 * Loads the golden set, computes live ground truth, drives the agent over each
 * question, scores the run, and emits `BENCH <metric> <value> [unit]` lines on
 * STDOUT (consumed by scripts/eval/benchmark_harness.sh). Progress goes to STDERR.
 * Writes a detailed report under scripts/eval/baselines/ tagged {base_model, lora_id}.
 *
 * Small models are high-variance, so set EVAL_RUNS>1 to run the suite K times and
 * report mean ± stdev plus a per-item pass-rate (flaky items surface explicitly).
 * A single run can otherwise masquerade as signal.
 *
 * Run:
 *   EVAL_TOKEN="$(scripts/eval/mint_token.sh)" EVAL_RUNS=3 npx tsx scripts/eval/run-agent-eval.ts
 *
 * Env: EVAL_BASE_URL (default prod), EVAL_TOKEN, EVAL_GOLDEN, EVAL_LIMIT,
 *      EVAL_INCLUDE_BLOCKED, EVAL_RUNS (default 1), EVAL_BASE_MODEL, EVAL_LORA_ID,
 *      EVAL_REQUEST_TIMEOUT_MS (default 120000), EVAL_DELAY_MS (default 400),
 *      EVAL_RUN_STAMP (detail-file suffix).
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGoldenJsonl, type GoldenRecord } from "@/lib/eval/golden";
import { generateGroundTruth, type TruthValue } from "@/lib/eval/groundTruth";
import { runChat } from "@/lib/eval/chatDriver";
import { scoreItem, aggregate, aggregateRuns, type ItemScore } from "@/lib/eval/scorers";

const log = (m: string) => process.stderr.write(m + "\n");
const env = (k: string, d = "") => process.env[k] ?? d;

const BASE_URL = env("EVAL_BASE_URL", "https://explorer.citrate.ai");
const TOKEN = process.env.EVAL_TOKEN || null;
const GOLDEN = env("EVAL_GOLDEN", resolve(process.cwd(), "scripts/eval/golden/citrate.golden.jsonl"));
const LIMIT = process.env.EVAL_LIMIT ? Number(process.env.EVAL_LIMIT) : Infinity;
const INCLUDE_BLOCKED = env("EVAL_INCLUDE_BLOCKED") === "1";
const RUNS = Math.max(1, Number(env("EVAL_RUNS", "1")));
const BASE_MODEL = env("EVAL_BASE_MODEL", "gemma-4-E4B-it-Q4_K_M");
const LORA_ID = env("EVAL_LORA_ID", "null");
const TIMEOUT = Number(env("EVAL_REQUEST_TIMEOUT_MS", "120000"));
const DELAY = Number(env("EVAL_DELAY_MS", "400"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveTruth(rec: GoldenRecord): Promise<TruthValue | null> {
  if (rec.ground_truth.type !== "rpc") return null;
  return generateGroundTruth(rec.ground_truth.generator ?? "", rec.ground_truth.params ?? {});
}

interface DetailItem {
  id: string;
  class: string;
  called_tools: string[];
  accuracy: string;
  tool_f1: number;
  grounded: boolean;
  http: number;
  latency_ms: number;
  answer_excerpt: string;
}

async function runSuite(pool: GoldenRecord[], runIdx: number): Promise<{ scores: ItemScore[]; detail: DetailItem[] }> {
  const scores: ItemScore[] = [];
  const detail: DetailItem[] = [];
  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    const truth = await resolveTruth(rec).catch(() => null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let result;
    try {
      result = await runChat({ baseUrl: BASE_URL, question: rec.question, token: TOKEN, signal: ctrl.signal });
    } catch (e) {
      result = { answerText: "", toolCalls: [], steps: 0, latencyMs: TIMEOUT, httpStatus: 0, raw: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
    const score = scoreItem({ record: rec, result, truth });
    scores.push(score);
    detail.push({
      id: rec.id,
      class: rec.class,
      called_tools: result.toolCalls.map((t) => t.name),
      accuracy: score.accuracy,
      tool_f1: Number(score.tool.f1.toFixed(3)),
      grounded: score.grounded,
      http: result.httpStatus,
      latency_ms: result.latencyMs,
      answer_excerpt: result.answerText.slice(0, 200),
    });
    log(
      `  [run ${runIdx + 1}/${RUNS}][${i + 1}/${pool.length}] ${rec.id}: acc=${score.accuracy} ` +
        `f1=${score.tool.f1.toFixed(2)} tools=[${result.toolCalls.map((t) => t.name).join(",")}] http=${result.httpStatus} ${result.latencyMs}ms`,
    );
    if (DELAY) await sleep(DELAY);
  }
  return { scores, detail };
}

function writeDetail(payload: object): string {
  const dir = resolve(process.cwd(), "scripts/eval/baselines");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `agent-detail-${env("EVAL_RUN_STAMP", "manual")}.json`);
  writeFileSync(path, JSON.stringify({ base_model: BASE_MODEL, lora_id: LORA_ID === "null" ? null : LORA_ID, base_url: BASE_URL, ...payload }, null, 2));
  return path;
}

async function main() {
  const all = parseGoldenJsonl(readFileSync(GOLDEN, "utf8"));
  const pool = all
    .filter((r) => INCLUDE_BLOCKED || r.blocked_until == null)
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  log(`agent-eval: ${pool.length} record(s) × ${RUNS} run(s) vs ${BASE_URL} | model=${BASE_MODEL} lora=${LORA_ID} | auth=${TOKEN ? "yes" : "no"}`);

  const runs: ItemScore[][] = [];
  let lastDetail: DetailItem[] = [];
  for (let r = 0; r < RUNS; r++) {
    const { scores, detail } = await runSuite(pool, r);
    runs.push(scores);
    lastDetail = detail;
  }

  const out: string[] = [];
  if (RUNS === 1) {
    const m = aggregate(runs[0]);
    out.push(
      `BENCH agent_tool_f1 ${m.toolF1.toFixed(4)}`,
      `BENCH agent_groundedness ${m.groundedness.toFixed(4)}`,
      `BENCH agent_accuracy ${m.accuracy.toFixed(4)}`,
      `BENCH agent_latency_p50 ${Math.round(m.latencyP50)} ms`,
      `BENCH agent_latency_p95 ${Math.round(m.latencyP95)} ms`,
      `BENCH agent_mean_steps ${m.meanSteps.toFixed(2)}`,
      `BENCH agent_scored ${m.scored}`,
      `BENCH agent_not_yet_supported ${m.notYetSupported}`,
    );
    for (const [cls, v] of Object.entries(m.accuracyByClass)) out.push(`BENCH agent_accuracy_${cls} ${v.toFixed(4)}`);
    writeDetail({ runs: 1, metrics: m, items: lastDetail });
    log(`agent-eval: accuracy=${(m.accuracy * 100).toFixed(1)}% toolF1=${m.toolF1.toFixed(3)} grounded=${(m.groundedness * 100).toFixed(1)}% scored=${m.scored}`);
  } else {
    const mr = aggregateRuns(runs);
    out.push(
      `BENCH agent_accuracy ${mr.accuracy.mean.toFixed(4)}`,
      `BENCH agent_accuracy_stdev ${mr.accuracy.stdev.toFixed(4)}`,
      `BENCH agent_tool_f1 ${mr.toolF1.mean.toFixed(4)}`,
      `BENCH agent_tool_f1_stdev ${mr.toolF1.stdev.toFixed(4)}`,
      `BENCH agent_groundedness ${mr.groundedness.mean.toFixed(4)}`,
      `BENCH agent_latency_p50 ${Math.round(mr.latencyP50Mean)} ms`,
      `BENCH agent_runs ${mr.runs}`,
      `BENCH agent_flaky_count ${mr.flaky.length}`,
    );
    for (const [cls, v] of Object.entries(mr.accuracyByClassMean)) out.push(`BENCH agent_accuracy_${cls} ${v.toFixed(4)}`);
    const p = writeDetail({ runs: RUNS, multi: mr, per_item_pass_rate: mr.perItemPassRate, flaky: mr.flaky, items_last_run: lastDetail });
    log(`agent-eval: wrote ${p}`);
    log(
      `agent-eval: accuracy=${(mr.accuracy.mean * 100).toFixed(1)}%±${(mr.accuracy.stdev * 100).toFixed(1)} ` +
        `toolF1=${mr.toolF1.mean.toFixed(3)}±${mr.toolF1.stdev.toFixed(3)} grounded=${(mr.groundedness.mean * 100).toFixed(1)}% ` +
        `over ${RUNS} runs | flaky(${mr.flaky.length}): ${mr.flaky.join(", ") || "none"}`,
    );
  }
  process.stdout.write(out.join("\n") + "\n");
}

main().catch((e) => {
  log(`agent-eval: FATAL ${(e as Error).stack ?? e}`);
  process.exit(1);
});
