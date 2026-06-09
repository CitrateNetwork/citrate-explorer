#!/usr/bin/env bash
# run-eval.sh — run the agent eval against any target, with N-run averaging.
#
# The eval drives the DEPLOYED agent, so to measure a change BEFORE it reaches
# prod, point it at a Vercel PREVIEW deployment URL (see PRE_MERGE_EVAL.md):
#
#   EVAL_BASE_URL="https://<preview>.vercel.app" EVAL_RUNS=3 scripts/eval/run-eval.sh
#
# Or measure prod:
#   EVAL_BASE_URL="https://explorer.citrate.ai" EVAL_RUNS=5 scripts/eval/run-eval.sh
#
# Mints an OIDC token unless EVAL_TOKEN is set (EVAL_MOCK=1 for a mock token).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${EVAL_BASE_URL:?set EVAL_BASE_URL — a preview URL to test pre-merge, or prod}"
export EVAL_RUNS="${EVAL_RUNS:-3}"

if [[ -z "${EVAL_TOKEN:-}" ]]; then
  if [[ "${EVAL_MOCK:-}" == "1" ]]; then
    EVAL_TOKEN="$("${ROOT}/scripts/eval/mint_token.sh" --mock 2>/dev/null || true)"
  else
    EVAL_TOKEN="$("${ROOT}/scripts/eval/mint_token.sh" 2>/dev/null || true)"
  fi
  export EVAL_TOKEN
fi

cd "${ROOT}"
exec npx tsx scripts/eval/run-agent-eval.ts
