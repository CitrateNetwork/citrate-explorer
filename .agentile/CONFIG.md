---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CONFIG.md — Canonical Project Constants

> Source of truth for every immutable constant in CitrateScan. Other docs may
> reference these values; they may not redefine them. Changing a value here is
> planset-gated (see Stability guarantees).

## Project identity

| Field | Value |
|---|---|
| Project name | `citrate-explorer` (product brand **CitrateScan**) |
| One-line description | AI-native BlockDAG explorer for the Citrate Network — a better, agentic Etherscan. |
| Repository | `https://github.com/CitrateNetwork/citrate-explorer` |
| License | Apache-2.0 (see `LICENSE`) |
| Initial author | Saul Loveman + Claude Opus 4.8 (1M context) |
| Federation role | `block-explorer` (tier 1) |

## Languages and toolchains

| Language | Toolchain | Test command (canonical) |
|---|---|---|
| TypeScript | Next.js 16 / React 19 / pnpm | `npx vitest run --reporter=json 2>/dev/null \| jq '.numTotalTests'` |
| Solidity | Foundry (solc 0.8.26, EVM Cancun) | `forge test --summary 2>&1 \| grep 'Suite result' \| awk '{s+=$4}END{print s}'` |

## Environments

| Environment | Purpose | RPC / endpoint | Stable since |
|---|---|---|---|
| `local` | Developer machine | `http://localhost:3000` | Day 0 |
| `citrate-testnet` | Live chain reads | `https://rpc.citrate.ai` (HTTP) / `wss://rpc.citrate.ai` (WS) | 2026-05-30 |
| `vercel-preview` | PR previews | `*.vercel.app` | TBD |
| `vercel-prod` | Production | `explorer.citrate.ai` (planned) | TBD |

## Versioned constants

| Name | Value | Reason it cannot change silently |
|---|---|---|
| Chain ID | `40204` (hex `0x9D0C`) | Network identity; permanent (federation PR #8396). |
| Native token | `SALT`, 18 decimals (wei = "grains") | Display + value math across the whole UI. |
| Consensus | GHOSTDAG BlockDAG | Determines all DAG-native UI semantics. |
| GHOSTDAG params | `k=18, maxParents=10, maxBlueScoreDiff=1000, pruningWindow=100000, finalityDepth=100` | Drives finality + DAG layout (from `citrate_getDagStats`). |
| VM | LVM (Lattice VM), EVM-compatible, Solidity ≤0.8.26 | Verification compiler farm + ABI decoding. |
| Gasless rail | EIP-2771 `CitrateForwarder` relayer (no native paymaster) | Write-contract sponsorship path. |
| DAG RPC | `citrate_getDagStats`, `citrate_semanticSearch`, `citrate_getTextEmbedding`, `citrate_chatCompletion` | Non-standard endpoints the explorer + agent depend on. |

## Encryption posture (hybrid — see DESIGN_HARNESS_AND_SETTINGS.md §B)

| Data class | Posture | Key |
|---|---|---|
| Logins / user settings | **E2EE** (server can't read) | derived client-side from a wallet signature → HKDF → AES-256-GCM |
| Our issued API keys | **hashed**, copy-once | salted SHA-256 + `API_KEY_PEPPER` (never recoverable) |
| Third-party provider keys (agent uses server-side) | **AES-256-GCM at rest** | per-user HKDF(`APP_MASTER_KEY`, wallet) |

## Stability guarantees

Anything in this file is on the **stable surface**. Changing a value requires:
1. A versioned migration document under `.agentile/planset/`.
2. A sprint that lands the migration with a rollback plan.
3. A note in `CHANGELOG.md` flagging the change.

Wanting to change a value here mid-sprint is a signal to file a planset, not to
edit this file silently.
