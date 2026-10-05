#!/usr/bin/env bash
# HUP US-7.1 AC2: the explorer's AgentSBT anvil test. Build AgentSBT + OrganizationSBT from the
# citrate-chain source, then run src/lib/harness/agentSbt.anvil.test.ts, which starts its own anvil
# (chain id 40204), deploys both contracts, and reads them through the harness, the /api/agents
# routes and the MCP getAgent tool. Nothing is broadcast to any real network.
#
# Usage: scripts/anvil-agent-sbt.sh [path/to/citrate-chain/contracts]
#   default: ../citrate-chain/contracts next to this repo, or CITRATE_CHAIN_CONTRACTS.
# Needs forge + anvil (Foundry) on PATH. The artifacts go to a temp dir, never into either repo.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
chain="${1:-${CITRATE_CHAIN_CONTRACTS:-$repo/../citrate-chain/contracts}}"
[ -f "$chain/src/cit_agent/AgentSBT.sol" ] || { echo "AgentSBT.sol not found under $chain (pass the citrate-chain contracts dir)" >&2; exit 2; }
command -v forge >/dev/null || { echo "forge not installed" >&2; exit 2; }
command -v anvil >/dev/null || { echo "anvil not installed" >&2; exit 2; }
work="$(mktemp -d "${TMPDIR:-/tmp}/explorer-agent-sbt.XXXXXX")"
trap 'rm -rf "$work"' EXIT
( cd "$chain" && forge build --out "$work/out" --cache-path "$work/cache" src/cit_agent/AgentSBT.sol >"$work/forge.log" 2>&1 ) \
  || { cat "$work/forge.log" >&2; exit 1; }
echo "built AgentSBT + OrganizationSBT from $chain ($(git -C "$chain" rev-parse --short HEAD 2>/dev/null || echo 'no git'))"
cd "$repo"
CITRATE_AGENT_SBT_ARTIFACTS="$work/out" npx vitest run src/lib/harness/agentSbt.anvil.test.ts
