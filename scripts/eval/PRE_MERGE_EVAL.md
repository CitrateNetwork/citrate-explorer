---
created: 2026-06-09T01:10:00Z
branch: feat/RA-1.5-eval-hardening
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: active
---

# Pre-merge agent eval (close the eval-first loop)

The agent eval drives the **deployed** agent (`POST /api/chat`), so without a
non-prod target a change can only be measured *after* it reaches production. RA-2
hit exactly this: the value-query slice had to be merged to main to be measured.
This is the gap that lets a regression land before it's caught (X-7 wants the eval
to gate *before* merge).

## The loop

```
branch → open PR → Vercel builds a PREVIEW deployment
      → run the eval against the preview URL (N runs)
      → compare to canonical (mean ± stdev; flaky list)
      → only merge if no real regression (tool-F1 / groundedness are the hard gates)
```

Run it:

```bash
EVAL_BASE_URL="https://<your-preview>.vercel.app" EVAL_RUNS=3 scripts/eval/run-eval.sh
```

Get the preview URL from the PR's Vercel check, or:

```bash
gh pr checks <PR#>            # the "Visit Preview" / vercel deployment link
```

## What the preview needs

A preview deployment must have the env the agent uses, on the **Preview** target:

| Var | Why | Note |
|-----|-----|------|
| `CITRATE_GATEWAY_URL` / `CITRATE_GATEWAY_API_KEY` | inference | same gateway as prod |
| `NEXT_PUBLIC_AUTH_MODE=oidc` + `OIDC_*` | `verifySession` on `/api/chat` | or run the agent in mock-auth on preview and use `EVAL_MOCK=1` |
| `DATABASE_URL` | `findTransfers` + indexed reads | **tradeoff below** |

**DATABASE_URL on preview — pick one:**
- **Point preview at the prod Neon** (simplest). The explorer agent is read-only for
  chain data, but it *does* write `audit_log` + `threads` rows — so eval runs would
  add a little eval-thread noise to prod tables. Acceptable for a short calibration;
  prune later if desired.
- **A separate preview/branch Neon** (cleanest) — provision a Neon branch, run the
  indexer against it, set `DATABASE_URL` on the Preview target. No prod pollution; a
  bit more ops.

Until preview has `DATABASE_URL`, value/indexed items return "not provisioned" on
preview — the chain/dag/address-via-RPC items still measure, which already catches
prompt-level regressions.

## Interpreting a pre-merge run (RA-1.5)

- **Hard gates (block the merge):** a real drop in **tool-selection F1** or
  **groundedness** beyond the canonical stdev. These were stable across RA-2 runs
  and reflect whether the agent picks the right tools and grounds its answers.
- **Soft signal (investigate, don't hard-block):** raw text **accuracy** — still
  partly phrasing-sensitive even after the RA-1.5 robustness fixes. Watch the
  **per-item pass-rate** and **flaky** list in the detail report rather than the
  single number.
- Always run **EVAL_RUNS≥3**; a single run is not a measurement for a small model.
