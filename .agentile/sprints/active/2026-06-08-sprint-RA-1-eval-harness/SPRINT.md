---
created: 2026-06-09T00:04:02Z
branch: feat/RA-1-eval-harness
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-1
status: active
---

# Sprint RA-1: Agent eval harness + golden benchmark + baseline

> Live working tracker. Full rationale + acceptance criteria:
> [`../../../planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-1-eval-harness.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-1-eval-harness.md).
> This file is authoritative for **status** (Rule 9).

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `RA-1` |
| **Goal** | Stand up an automated agent eval harness on the `scripts/eval/` BENCH framework, author a persona-spanning golden set with live-RPC ground truth, and capture today's `gemma-4-E4B-it-Q4_K_M` baseline. |
| **Branch** | `feat/RA-1-eval-harness` |
| **Start Date** | 2026-06-08 |
| **Status** | `REVIEW` (all WPs complete; baseline captured) |
| **Planset** | [`PLANSET.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/PLANSET.md) |

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | 98 | `ba08566` | `npx vitest run --reporter=json 2>/dev/null \| jq '.numTotalTests'` |
| **Formal specs** | 1 | 2026-06-08 | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | 6 | 2026-06-08 | `ls scripts/semgrep/*.yaml \| wc -l` |
| **Agent eval** | none → established this sprint | — | `./scripts/eval/benchmark_harness.sh` |

## Work Package status

| WP | Title | Status |
|----|-------|--------|
| 1.1 | Golden question set schema + seed items | `[x] COMPLETE` |
| 1.2 | Headless `/api/chat` driver | `[x] COMPLETE` |
| 1.3 | Live-RPC ground-truth generator | `[x] COMPLETE` |
| 1.4 | Four scorers (tool-selection, groundedness, accuracy, latency) | `[x] COMPLETE` |
| 1.5 | BENCH scenario + baseline snapshot | `[x] COMPLETE` |

## Baseline result (base Gemma, no LoRA — `gemma-4-E4B-it-Q4_K_M`)

Captured 2026-06-09 against `explorer.citrate.ai` (19 scored, 0 not-yet-supported,
0 indeterminate). Pinned: `scripts/eval/baselines/canonical.json`.

| Metric | Value |
|---|---|
| accuracy | **89.5%** |
| tool-selection F1 | **0.842** |
| groundedness (cites ≥1 tool) | **100%** |
| latency p50 / p95 | 6.5 s / 18.6 s |
| mean steps | 1.95 |

**What the baseline already taught us (findings for later sprints):**
- `addr-label-router` and `addr-code-lorafactory` **fail**: the agent reads the
  bytecode but can't name the contract ("InferenceRouter", "LoRAFactory"). This is
  gap **G-4** — the contract-knowledge gap → **RA-5** (knowledge pack) will move it.
- `addr-nonce-deployer` is **accurate but tool-F1 0**: the agent used
  `addressActivity` instead of the expected `getAddress` — a valid alternate path.
  `expected_tools` needs an "accepted alternates" notion (golden-set refinement,
  RA-2+) so tool-F1 doesn't penalize correct alternate routing.
- Value/token/introspection items (RA-2/3/4) are present but `blocked_until` and
  excluded from the pass rate — they light up as those sprints land.

## Log

- **2026-06-08** — Sprint kicked off; branch `feat/RA-1-eval-harness` cut from the
  planset commit `ba08566`. Baseline ratchets: 98 tests / 1 spec / 6 tripwires.
- **2026-06-09** — All 5 WPs complete. Eval harness live on the `scripts/eval/` BENCH
  framework: golden set (`scripts/eval/golden/`, 28 items), TS schema/driver/
  ground-truth/scorers under `src/lib/eval/` (+24 tests), runner + scenario +
  `direction.json`. Captured the base-Gemma baseline (89.5% acc / 0.842 F1 / 100%
  grounded) and pinned `canonical.json`. typecheck clean. Also fixed a latent
  type error in `agent-transport.test.ts` (headers fn return type) surfaced by tsc.

## Notes / decisions

- Golden set is the **held-out** eval corpus — never enters the RA-8 LoRA training
  corpus (X-8). It lives under `scripts/eval/golden/`.
- Value-query items that need RA-2/RA-3 are authored now but tagged
  `blocked_until` so they're reported separately, not counted as failures (honest
  baseline).
- Eval scenarios plug into the existing `scripts/eval/benchmark_harness.sh` as
  `BENCH`-line emitters; no new harness framework.
