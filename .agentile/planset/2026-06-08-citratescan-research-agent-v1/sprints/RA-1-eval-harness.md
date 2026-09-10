---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-1
status: planned
---

# Sprint RA-1: Agent eval harness + golden benchmark + baseline

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `RA-1` |
| **Sprint Name** | Agent eval harness + golden benchmark + baseline |
| **Goal** | Stand up an automated agent eval harness on the `scripts/eval/` BENCH framework, author a persona-spanning golden question set with live-RPC ground truth, and capture today's `gemma-4-E4B-it-Q4_K_M` baseline. |
| **Branch** | `feat/RA-1-eval-harness` (cut at kickoff) |
| **Start Date** | TBD (kickoff) |
| **End Date (target)** | +2–3 days from kickoff |
| **Status** | `PLANNED` |
| **Planset** | [`../PLANSET.md`](../PLANSET.md) |
| **Predecessors** | none (first sprint of this planset) |

## Why this sprint

We cannot take the agent from working to "wow" without a number to move, and the
owner explicitly wants a benchmark/eval to assess capabilities over the coming week.
The eval infrastructure (`scripts/eval/` BENCH harness, regression checker, scenarios/
+ baselines/) already exists but has **zero agent scenarios**. This sprint fills that:
it makes every later sprint a measured experiment (X-7) and produces the first
tool-use traces that the LoRA track (RA-8) will train on. Eval-first is the
sequencing spine of the whole planset.

## Deliverables

- `scripts/eval/golden/` — the versioned golden question set (JSONL), one record per
  question with persona, capability class, expected tool set, and a ground-truth ref.
- `scripts/eval/lib/` — a headless `/api/chat` driver (mints an OIDC token, streams a
  turn, captures the final answer + the tool calls made via `audit_log` or the stream).
- `scripts/eval/ground_truth/` — a live-RPC generator that computes each golden item's
  ground truth from the chain (Rule 11 — truth is computed, never hand-typed).
- `scripts/eval/scorers/` — four scorers: tool-selection (precision/recall/F1),
  groundedness (cites ≥1 tool), accuracy (answer vs ground truth), latency/steps.
- `scripts/eval/scenarios/agent_research.py` (+ `.sh` wrapper) — the executable that
  the BENCH harness runs; emits `BENCH agent_tool_f1 …`, `BENCH agent_groundedness …`,
  `BENCH agent_accuracy …`, `BENCH agent_latency_p50 …` lines.
- `scripts/eval/baselines/canonical.json` — the pinned baseline run for base Gemma,
  tagged `{base_model, lora_id: null}` (X-8).
- `scripts/eval/direction.json` — metric directions (F1/groundedness/accuracy =
  higher_better; latency = lower_better).
- Updated `scripts/eval/README.md` + a short `scripts/eval/AGENT_EVAL.md` describing
  the golden-set schema and how to add an item.

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | 96 (day-zero) / ~98 current | day-zero `36f22fa` | `npx vitest run --reporter=json 2>/dev/null \| jq '.numTotalTests'` |
| **Formal specs** | 1 | 2026-06-08 | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | 6 | 2026-06-08 | `ls scripts/semgrep/*.yaml \| wc -l` |
| **Frontmatter coverage** | tracked | 2026-06-08 | per `scripts/ci/` |
| **Agent eval** | none → established this sprint | — | `./scripts/eval/benchmark_harness.sh` |

## Method

Eval-first FEATURE workflow. For each WP: define the contract (schema/interface) →
failing test/scenario (RED) → implement (GREEN) → refactor → record the baseline.
No TLA+ (no state machine touched). Rule 11 enforced: ground truth is generated from
live RPC, and the golden set is the held-out evaluation corpus (never training data —
X-8).

## Work Packages

### WP-1.1: Golden question set schema + first 30 items

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | contract + fixtures |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Define the JSONL golden-set schema and author ~30 seed questions spanning
three personas (newcomer, auditor, blockchain-native) and the capability classes:
value/amount (incl. the "30k SALT" class), native-vs-token, address/contract
investigation, DAG/finality, and multi-step. Each record: `{id, persona, class,
question, expected_tools[], ground_truth_ref, notes}`. Does NOT include the value
queries that only RA-2/RA-3 can answer yet — those items are authored but tagged
`blocked_until: RA-3` so the harness reports them as "not-yet-supported" rather than
failing the baseline dishonestly.

**Acceptance Criteria** *(Rule 11)*
- [ ] Schema documented in `scripts/eval/AGENT_EVAL.md`; validated by a schema test.
      Data source = the JSONL files themselves + a `vitest`/python schema check.
- [ ] ≥ 30 items across all 3 personas and all 5 classes; each names its
      `expected_tools` (drawn from the real tool registry) and a `ground_truth_ref`.
- [ ] Items unanswerable today are tagged `blocked_until` and excluded from the pass
      rate (counted + reported separately — no silent omission).

**Tests added:** `golden_schema.test` — every record validates against the schema and
references real tool names.

---

### WP-1.2: Headless `/api/chat` driver

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | RED → GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** A driver that, given a question, mints a valid OIDC id_token (reusing the
§7 curl-e2e flow against `auth.citrate.ai`), POSTs to `/api/chat`, consumes the
stream, and returns `{answer_text, tool_calls[], latency_ms, step_count}`. Tool calls
are read from the UI message stream (tool parts) and cross-checked against `audit_log`
when DB is provisioned.

**Acceptance Criteria** *(Rule 11)*
- [ ] Driver returns the assistant's final text + the ordered list of tool calls for a
      live `/api/chat` turn. Data source = live `POST /api/chat` (the deployed or local
      app) + `audit_log` table.
- [ ] Token minting is parameterized (env: issuer, client_id) and degrades to mock
      mode locally; no secrets in the repo.
- [ ] Driver is idempotent and hermetic (writes only to `/tmp`); safe for CI nightly.

**Tests added:** `chat_driver.test` — against a stubbed stream, asserts correct
extraction of text + tool parts + latency.

---

### WP-1.3: Live-RPC ground-truth generator

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** For each golden item, compute the expected answer from the chain via the
harness ops / RPC (e.g., the actual latest block, an address's actual balance, the set
of transfers ≥ X SALT in a window once RA-3 lands). Ground truth is stored as a small
structured assertion (`{kind, value|set|range}`) the accuracy scorer can check — not
free text.

**Acceptance Criteria** *(Rule 11)*
- [ ] Each non-blocked golden item has machine-checkable ground truth generated from
      live RPC (chain `40204`), regenerable on demand. Data source = `harnessClient()`
      reads, never hand-typed values.
- [ ] Ground truth records the block height / `blue_score` it was computed at, so
      time-sensitive items are reproducible.

**Tests added:** `ground_truth.test` — generator output validates against the
assertion schema for a sample item (live-RPC gated, runs with `LIVE_RPC=1`).

---

### WP-1.4: Four scorers (tool-selection, groundedness, accuracy, latency)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Implement the four metric families. Tool-selection: precision/recall/F1 of
called tools vs `expected_tools`. Groundedness: fraction of answers with ≥1 tool call.
Accuracy: answer satisfies the ground-truth assertion (numeric tolerance for amounts;
set membership for transfer/holder lists; exact for addresses/hashes). Latency/steps:
p50/p95 latency and mean step_count.

**Acceptance Criteria** *(Rule 11)*
- [ ] Each scorer consumes driver output + golden ground truth and returns a number;
      unit-tested on fixtures. Data source = WP-1.2 driver output + WP-1.3 ground truth.
- [ ] The accuracy scorer enforces X-3: a value answer must name whether it is native
      SALT or a token (and carry the token identity) to count as correct.

**Tests added:** `scorers.test` — each scorer on crafted pass/fail fixtures, incl. an
X-3 native-vs-token disambiguation case.

---

### WP-1.5: BENCH scenario + baseline snapshot

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | integrate + baseline |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** Wire WP-1.1..1.4 into `scripts/eval/scenarios/agent_research.py` so the
existing `benchmark_harness.sh` runs it and aggregates `BENCH` lines. Run it against
base Gemma, pin the result as `canonical.json`, tag `{base_model, lora_id: null}`, and
register the agent scenario in `benchmark-nightly.yml` (shadow mode).

**Acceptance Criteria** *(Rule 11)*
- [ ] `./scripts/eval/benchmark_harness.sh` produces a run with `agent_tool_f1`,
      `agent_groundedness`, `agent_accuracy`, `agent_latency_p50` metrics. Data source =
      live agent run over the golden set.
- [ ] `canonical.json` committed (`git add -f`) tagged with `{base_model, lora_id}` (X-8).
- [ ] `check_regression.py` compares a fresh run to canonical and comments (shadow
      mode; not a hard block — X-7).
- [ ] `direction.json` sets metric directions correctly.

**Tests added:** `bench_scenario.test` — the scenario emits well-formed BENCH lines on
a tiny golden subset.

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| Live `/api/chat` (deployed or local) + gateway up | Available | WP-1.2/1.5 can't run |
| Neon `audit_log` provisioned | Available | groundedness falls back to stream-only tool detection |
| OIDC token minting (auth.citrate.ai) | Available | WP-1.2 (use mock mode locally if down) |
| RA-2/RA-3 backbone | Not yet | value-query golden items stay `blocked_until` (by design) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Small-model answers are unstructured → hard to score | High | Med | Constrain via prompt for the scored classes; accuracy scorer parses structured claims, not prose; X-3 assertion is explicit |
| Live-RPC ground truth shifts between runs (chain moves) | Med | Med | Pin ground truth to a block/blue_score; regenerate per run; tolerance for "latest"-type items |
| Gateway latency noise inflates latency metric | Med | Low | Report p50/p95; latency is watched, not gated (X-7) |
| Golden set too small to be meaningful | Med | Med | Seed 30, grow to ~60 across RA-2..RA-6 as capabilities land |

## Notes

- The golden set is the **held-out** evaluation corpus and must never enter the LoRA
  training corpus (X-8). Enforce by keeping it under `scripts/eval/golden/` and
  excluding that path from RA-8 corpus assembly by construction.
- This sprint should surface a fix or triage for the pre-existing
  `explainTransaction.test.ts` ERC-20 failure noted in EVALUATION.md (it touches the
  decode path RA-3 reworks).
- First tool-use traces captured here feed RA-8; log them in a trace store separate
  from the golden answers.
