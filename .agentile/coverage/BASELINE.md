---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# BASELINE.md — Day-Zero Ratchet Baseline

Human-readable companion to `baseline.json`. See `GATES.md` for the four-ratchet
model. These numbers may only go **up**.

| Ratchet | Day-zero (2026-06-02) | Command |
|---|---|---|
| Tests | 0 → grows from S-1 | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| Formal specs (TLA+) | 0 | TLC over `.agentile/formal/specs` |
| Tripwires | 5 (semgrep starter rules) | `ls scripts/semgrep/*.yaml \| wc -l` |
| Frontmatter coverage | seeded at first commit | `scripts/ci/check_frontmatter.py` |

S-1 lands the first real tests (live-RPC harness + crypto + indexer), so the test
ratchet starts climbing immediately. The DAG reorg/finality logic gets a TLA+
spec in S-1 (spec ratchet → 1).
