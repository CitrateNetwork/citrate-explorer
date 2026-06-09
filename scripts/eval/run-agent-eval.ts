/**
 * Agent eval runner (RA-1 WP-1.5).
 *
 * Loads the golden set, computes live ground truth, drives the agent over each
 * question, scores the run, and emits `BENCH <metric> <value> [unit]` lines on
 * STDOUT (consumed by scripts/eval/benchmark_harness.sh). Progress goes to STDERR.
 * Also writes a detailed per-item report under scripts/eval/baselines/ tagged with
 * {base_model, lora_id} for reproducibility (X-8).
 *
 * Run:
 *   EVAL_TOKEN="$(scripts/eval/mint_token.sh)" npx tsx scripts/eval/run-agent-eval.ts
 *
 * Env:
 *   EVAL_BASE_URL   (default https://explorer.citrate.ai)
 *   EVAL_TOKEN      OIDC id_token (else unauthenticated — expect 401s)
 *   EVAL_GOLDEN     (default scripts/eval/golden/citrate.golden.jsonl)
 *   EVAL_LIMIT      cap the number of records (debug)
 *   EVAL_INCLUDE_BLOCKED  "1" to also run blocked items (reported, not scored)
 *   EVAL_BASE_MODEL (default gemma-4-E4B-it-Q4_K_M) — label only
 *   EVAL_LORA_ID    (default "null") — label only
 *   EVAL_REQUEST_TIMEOUT_MS (default 120000)
 *   EVAL_DELAY_MS   (default 400) between turns (respect the chat rate limit)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseGoldenJsonl, activeRecords, type GoldenRecord } from "@/lib/eval/golden";
import { generateGroundTruth, type TruthValue } from "@/lib/eval/groundTruth";
import { runChat } from "@/lib/eval/chatDriver";
import { scoreItem, aggregate, type ItemScore } from "@/lib/eval/scorers";

const log = (m: string) => process.stderr.write(m + "\n");
const env = (k: string, d = "") => process.env[k] ?? d;

const BASE_URL = env("EVAL_BASE_URL", "https://explorer.citrate.ai");
const TOKEN = process.env.EVAL_TOKEN || null;
const GOLDEN = env("EVAL_GOLDEN", resolve(process.cwd(), "scripts/eval/golden/citrate.golden.jsonl"));
const LIMIT = process.env.EVAL_LIMIT ? Number(process.env.EVAL_LIMIT) : Infinity;
const INCLUDE_BLOCKED = env("EVAL_INCLUDE_BLOCKED") === "1";
const BASE_MODEL = env("EVAL_BASE_MODEL", "gemma-4-E4B-it-Q4_K_M");
const LORA_ID = env("EVAL_LORA_ID", "null");
const TIMEOUT = Number(env("EVAL_REQUEST_TIMEOUT_MS", "120000"));
const DELAY = Number(env("EVAL_DELAY_MS", "400"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveTruth(rec: GoldenRecord): Promise<TruthValue | null> {
  if (rec.ground_truth.type !== "rpc") return null;
  return generateGroundTruth(rec.ground_truth.generator ?? "", rec.ground_truth.params ?? {});
}

async function main() {
  const all = parseGoldenJsonl(readFileSync(GOLDEN, "utf8"));
  const pool = (INCLUDE_BLOCKED ? all : all.filter((r) => r.blocked_until == null || activeRecords([r]).length === 0))
    .filter((r) => INCLUDE_BLOCKED || r.blocked_until == null)
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  log(`agent-eval: ${pool.length} record(s) vs ${BASE_URL} | model=${BASE_MODEL} lora=${LORA_ID} | auth=${TOKEN ? "yes" : "no"}`);

  const scores: ItemScore[] = [];
  const detail: unknown[] = [];

  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    const truth = await resolveTruth(rec).catch((e) => {
      log(`  [${rec.id}] ground-truth error: ${(e as Error).message}`);
      return null;
    });
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
      persona: rec.persona,
      question: rec.question,
      expected_tools: rec.expected_tools,
      called_tools: result.toolCalls.map((t) => t.name),
      accuracy: score.accuracy,
      tool_f1: Number(score.tool.f1.toFixed(3)),
      grounded: score.grounded,
      http: result.httpStatus,
      latency_ms: result.latencyMs,
      steps: result.steps,
      truth_kind: truth?.kind ?? "static",
      answer_excerpt: result.answerText.slice(0, 240),
    });
    log(
      `  [${i + 1}/${pool.length}] ${rec.id}: acc=${score.accuracy} f1=${score.tool.f1.toFixed(2)} ` +
        `tools=[${result.toolCalls.map((t) => t.name).join(",")}] http=${result.httpStatus} ${result.latencyMs}ms`,
    );
    if (DELAY) await sleep(DELAY);
  }

  const m = aggregate(scores);

  // BENCH lines on STDOUT (harness-parsed). Directions in scripts/eval/direction.json.
  const out: string[] = [
    `BENCH agent_tool_f1 ${m.toolF1.toFixed(4)}`,
    `BENCH agent_groundedness ${m.groundedness.toFixed(4)}`,
    `BENCH agent_accuracy ${m.accuracy.toFixed(4)}`,
    `BENCH agent_latency_p50 ${Math.round(m.latencyP50)} ms`,
    `BENCH agent_latency_p95 ${Math.round(m.latencyP95)} ms`,
    `BENCH agent_mean_steps ${m.meanSteps.toFixed(2)}`,
    `BENCH agent_scored ${m.scored}`,
    `BENCH agent_not_yet_supported ${m.notYetSupported}`,
    `BENCH agent_indeterminate ${m.indeterminate}`,
  ];
  for (const [cls, v] of Object.entries(m.accuracyByClass)) out.push(`BENCH agent_accuracy_${cls} ${v.toFixed(4)}`);
  process.stdout.write(out.join("\n") + "\n");

  // Detailed report (debuggable; tagged for reproducibility — X-8).
  const dir = resolve(process.cwd(), "scripts/eval/baselines");
  mkdirSync(dir, { recursive: true });
  const stamp = env("EVAL_RUN_STAMP", "manual");
  const reportPath = resolve(dir, `agent-detail-${stamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ base_model: BASE_MODEL, lora_id: LORA_ID === "null" ? null : LORA_ID, base_url: BASE_URL, metrics: m, items: detail }, null, 2),
  );
  log(`agent-eval: wrote ${reportPath}`);
  log(`agent-eval: accuracy=${(m.accuracy * 100).toFixed(1)}% toolF1=${m.toolF1.toFixed(3)} grounded=${(m.groundedness * 100).toFixed(1)}% scored=${m.scored} nys=${m.notYetSupported}`);
}

main().catch((e) => {
  log(`agent-eval: FATAL ${(e as Error).stack ?? e}`);
  process.exit(1);
});
