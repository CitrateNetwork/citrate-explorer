---
created: 2026-06-09T01:10:00Z
branch: feat/RA-1.5-eval-hardening
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-1.5
status: active
---

# Sprint RA-1.5: Eval hardening (trustworthy measurement)

> Inserted follow-up to RA-1, prompted by RA-2's close-out finding: the eval's
> accuracy metric was unreliable (small-model variance + brittle assertions), so it
> couldn't gate quality (X-7). This sprint makes the number trustworthy before RA-3.

## Goal
Make the agent eval a measurement you can gate on: average over runs, score robustly,
and provide a pre-merge path — then re-baseline.

## Work Package status
| WP | Title | Status |
|----|-------|--------|
| 1 | N-run averaging + variance (`EVAL_RUNS`, mean±stdev, per-item pass-rate, flaky list) | `[x] COMPLETE` |
| 2 | Robust scoring (truncation-tolerant address match; synonym `contains_any`) | `[x] COMPLETE` |
| 3 | Pre-merge eval path (`run-eval.sh` + `PRE_MERGE_EVAL.md`, target a preview URL) | `[x] COMPLETE` |
| 4 | Re-baseline with averaging + pin canonical | `[x] COMPLETE` |

## Trustworthy baseline (RA-1.5: 3-run averaged, robust scoring, vs prod)

| Metric | Value |
|---|---|
| accuracy | **65.2% ± 3.5%** |
| **tool-selection F1** (hard gate) | **0.754 ± 0.020** |
| **groundedness** (hard gate) | **87.3%** |
| latency p50 (mean) | 6.75 s |
| flaky items (pass-rate strictly 0<r<1) | 4 |

Per-class accuracy: dag **1.0**, token 1.0, chain 0.83, native_vs_token 0.83,
address 0.48, multistep 0.33, value 0.33.

**Named flaky items:** `chain-id-newcomer` (sometimes calls no tool),
`addr-nonce-deployer` (picks a different tool), `multistep-latest-block-txcount`
(tip drift between agent and ground truth), `value-ambiguous-30k-native-vs-token`
(sometimes asks for a hash instead of using findTransfers).

## What changed vs the misleading single runs
- RA-1 single run reported 89.5% (an **optimistic sample**); RA-2 single runs 56.5%.
- The truth, averaged + robustly scored, is **~65% ± 3.5%**. The robust scorer alone
  fixed real artifacts (dag class 0.75→1.0 once "GHOSTDAG"/"selected-parent" count;
  truncated addresses like `0xaceaa7…` now match).
- **Hard gates are stable:** tool-F1 ±0.02, groundedness high. Gate merges on these;
  treat raw accuracy as a soft signal + watch the per-item pass-rate / flaky list.

## Findings carried forward
- **value class 0.33 / empty narration:** `findTransfers` works (the 30k query returns
  real data), but on some value items the model returns no narration of the tool
  result — a reasoning/formatting issue for **RA-6** (and the tool may need a more
  model-friendly result summary). Not an eval bug.
- **address class 0.48:** dominated by the contract-naming gap (G-4) → **RA-5**.
- **Pre-merge path** is documented but needs preview env (`DATABASE_URL`/OIDC/gateway
  on the Preview target) to fully exercise indexed items — an ops follow-up.

## Log
- **2026-06-09** — Branched from `main`. WP-2 (robust scoring) + WP-1 (N-run averaging)
  + WP-3 (pre-merge path) built and unit-tested. WP-4: re-baselined ×3 vs prod →
  65.2%±3.5 accuracy, 0.754±0.020 tool-F1; pinned `canonical.json`. Eval tests added;
  typecheck clean.
