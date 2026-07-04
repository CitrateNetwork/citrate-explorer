# AGENTS.md — CitrateScan working notes

Live status + hard-won facts for anyone (human or agent) picking this up. The
governance is in `.agentile/`; this is the fast orientation.

## Status (2026-06-02)

- **S-0 Bootstrap** ✅ — Agentile foundation, planset (S-1..S-6), design docs,
  stack scaffold, backend skeleton, federation registration.
- **S-1 Indexer + AI foundation** ⏭️ NEXT (the MVP lead) — indexer worker, read
  harness, AI chat with tools, hybrid crypto, live-RPC tests.

## Architecture in one breath
Indexer worker (WS→Neon) feeds a Vercel app (UI + read API + AI agent + verify +
MCP); a Vercel Sandbox runs the solc verification farm. Read-through to live RPC
when the DB isn't provisioned. See `CLAUDE.md`.

## Hard-won Citrate facts (verify before relying — Rule 11)
- Chain **40204** (`0x9D0C`); native **SALT** (18 decimals; wei = "grains").
- **GHOSTDAG BlockDAG**, NOT linear:
  - multiple **tips** at once — there is no single "latest block."
  - **blue_score ≠ height** — blue_score is the consensus order; show both.
  - **finality by depth**: finalized when `current_blue_score − block.blue_score ≥ 100`.
    Don't say "N confirmations."
  - each block: 1 **selected parent** + 0–10 **merge parents**; blocks are blue/red.
  - DAG topology + tips come from `citrate_getDagStats`.
- **No native paymaster** → gasless writes use the app-layer EIP-2771
  `CitrateForwarder` relayer (`/api/relay`). Verify the forwarder with
  `eth_getCode` before routing to it.
- EVM-compatible **LVM**, Solidity ≤0.8.26 (EVM Cancun).
- RPC: `https://rpc.citrate.ai` (443 → node 8545), `wss://rpc.citrate.ai`
  (443 → node 8546). There is no public `rpc.citrate.ai:8545` — the public
  endpoint is 443 only; 8545/8546 are the loopback node ports Caddy proxies
  to. A direct node fallback is used server-side only.
- AI precompiles `0x0100–0x0106`; `citrate_semanticSearch` / `citrate_getTextEmbedding`
  power on-chain semantic search.
- Inference is **env-driven** (`CITRATE_INFERENCE_MODE`: gateway | local). Build
  for the finished state; the gateway may be warming up (first request slow).

## Conventions
- Read-only harness is **deny-by-default**; no signer ever reaches it. Writes are
  always an explicit user wallet action.
- Hybrid secrets: settings E2EE, our API keys hashed (copy-once), third-party
  keys encrypted-at-rest. See `DESIGN_HARNESS_AND_SETTINGS.md §B`.
- Co-locate `*.test.ts`; live-RPC tests run with `LIVE_RPC=1`.
