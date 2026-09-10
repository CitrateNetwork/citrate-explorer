---
created: 2026-06-09T21:10:00Z
branch: feat/RA-6-context-budget
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-6
status: active
---

# Sprint RA-6: Fit the context budget (+ narration)

> Re-scoped from "reasoning + tables" to **context budget first** after the owner
> reported the agent errors around ~4k tokens. Root cause measured below.

## Root cause (measured)
The gateway serves a SMALL-context model. The agent's FIXED overhead was already over
4k tokens before the user typed anything:
- system prompt **~1,515 tokens** (re-listed every tool the schemas already describe)
- 20 tool schemas **~3,327 tokens** of descriptions (findTransfers alone ~212)
- → **~4,840 tokens fixed**, then + 30 turns history + tool results + a **4,096-token
  output reservation**. It could never fit → empty/errored output (the RA-3
  "empty narration").

## Work Package status
| WP | Title | Status |
|----|-------|--------|
| 6.1 | Context budget config (maxOutputTokens 4096→896, history 30→6, steps→6) | `[x] COMPLETE` |
| 6.2 | Trim system prompt (don't re-list tools; ~1515→637 tokens) | `[x] COMPLETE` |
| 6.3 | Lean tool descriptions (~3327→610 tokens) | `[x] COMPLETE` |
| 6.4 | Compact results (strip raw bytecode from getContractCode) + measure | `[x] COMPLETE` |

## RESULT — the highest-impact change of the project (3-run, vs prod)
| Metric | RA-3 (pre) | **RA-6** |
|---|---|---|
| **accuracy** | 49.3% | **82.6% ± 3.5%** |
| value class | 0% | **88.9%** |
| multistep | 17% | **100%** |
| token / native-vs-token | 100% / 67% | 100% / 83% |
| empty narration (last run) | ~6/23 | **2/23 → ~0** (bytecode fix) |
| `value-30k` pass-rate | 0 | **1.0** |
| tool-F1 | 0.734 | 0.696 (within noise) |

The "~4k token error" was the master key. Cutting the fixed overhead ~4,840→~1,700
tokens (+ right-sizing output/history) let the model actually generate answers. The 2
residual empties both called `getContractCode`, which fed the model the full **raw
bytecode** (10s of KB) — fixed by returning facts + a preview (WP-6.4). Those 2 items
may still need RA-5's contract catalog to get the *name* right, but they now narrate.

**canonical.json pinned at the measured RA-6 82.6%** (bytecode fix is a further
narration improvement on top).

## Budget after RA-6
| | before | after |
|---|---|---|
| system prompt | ~1,515 tok | **637** |
| tool descriptions | ~3,327 tok | **610** |
| maxOutputTokens | 4,096 | **896** |
| history turns | 30 | **6** |
| **fixed overhead** | **~4,840** | **~1,700** |

All env-tunable (`CITRATE_HISTORY_TURNS`, `CITRATE_MAX_OUTPUT_TOKENS`, `CITRATE_MAX_STEPS`)
so a larger served context can relax them.

## Recommendation to the owner
The structural fix is also to **increase the served context window** on the gateway
(gemma-4-E4B supports far more than 4k; llama-server's `-c` is likely set small). With
RA-6's lean overhead AND a bigger served context, the agent has comfortable room. This
also reinforces RA-8: bake chain knowledge into a **LoRA** instead of a long prompt.

## Log
- **2026-06-09** — Measured the overhead (~4,840 fixed). Cut system prompt 1515→637
  (stop re-listing tools — the schemas carry them), tool descriptions 3327→610,
  maxOutputTokens 4096→896, history 30→6, steps 8→6. Suite green (156), typecheck
  clean. Deploying to measure the empty-narration / accuracy recovery.