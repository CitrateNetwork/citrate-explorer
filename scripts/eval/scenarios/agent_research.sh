#!/usr/bin/env bash
# agent_research.sh — BENCH scenario: run the CitrateScan agent over the golden set.
#
# Emits `BENCH agent_*` lines (consumed by ../benchmark_harness.sh). Mints an OIDC
# token unless one is supplied. Set EVAL_MOCK=1 to use a mock token (local AUTH_MODE=mock),
# or export EVAL_TOKEN yourself. Target with EVAL_BASE_URL (default prod).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

if [[ -z "${EVAL_TOKEN:-}" ]]; then
  if [[ "${EVAL_MOCK:-}" == "1" ]]; then
    EVAL_TOKEN="$("${ROOT}/scripts/eval/mint_token.sh" --mock 2>/dev/null || true)"
  else
    EVAL_TOKEN="$("${ROOT}/scripts/eval/mint_token.sh" 2>/dev/null || true)"
  fi
  export EVAL_TOKEN
fi

if [[ -z "${EVAL_TOKEN:-}" ]]; then
  echo "agent_research: WARNING — no token minted; running unauthenticated (expect 401s)" >&2
fi

cd "${ROOT}"
exec npx tsx scripts/eval/run-agent-eval.ts
