# CLAUDE.md — citrate-explorer (CitrateScan)

This file provides guidance to Claude Code when working in this repository.

## 🚨 START HERE — Agentile Framework

**Before doing ANY work, read the framework entry point:**

@.agentile/AGENT_ENTRY.md

This repository uses the **Agentile** methodology. All project governance, sprint
planning, rules, and workflows live in `.agentile/`. Key files:

- **Entry point**: `.agentile/AGENT_ENTRY.md`
- **Constants**: `.agentile/CONFIG.md`
- **Rules**: `.agentile/rules/CORE_RULES.md` — 13 non-negotiable rules (0–12)
- **Product spec**: `.agentile/PRODUCT_SPEC.md`
- **Plan**: `.agentile/planset/2026-06-02-citrate-explorer-v1/PLANSET.md`
- **Current work**: `.agentile/sprints/CURRENT.md`

**GATE: Do NOT write code until you have read AGENT_ENTRY.md and CONFIG.md.**

## Project at a glance

| Field | Value |
|-------|-------|
| **Project** | citrate-explorer (brand: CitrateScan) |
| **Description** | AI-native BlockDAG explorer for the Citrate Network — a better, agentic Etherscan. |
| **Primary languages** | TypeScript (Next.js 16 / React 19), Solidity (Foundry) |
| **License** | Apache-2.0 |
| **Framework version** | Agentile v1.0.0-rc1 |

## Architecture (three runtimes)

1. **Indexer worker** (`pnpm indexer`, `scripts/indexer/run.ts`) — always-on Node
   process; WS `newHeads` → backfill → Neon. NOT on Vercel (functions can't hold
   a socket). Code: `src/lib/indexer/`.
2. **Vercel app** — UI + `src/app/api/*` read API + AI chat + verify orchestration
   + MCP server. Reads the indexed Neon DB, falls through to live RPC.
3. **Verify sandbox** (S-4) — multi-version `solc` recompile-and-diff in a Vercel
   Sandbox microVM.

## Build & test commands

```bash
pnpm install            # deps
pnpm dev                # next dev (:3000)
pnpm build              # production build
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint
pnpm test               # vitest (unit)
pnpm test:live          # LIVE_RPC=1 vitest run (hits rpc.citrate.ai)
pnpm indexer            # run the indexer worker
pnpm db:generate        # drizzle-kit generate (no DB needed)
pnpm db:migrate         # apply migrations (needs DATABASE_URL)
pnpm contracts:test     # forge test
```

The canonical test-count command is in `.agentile/coverage/baseline.json`
(`tests.command`) — that's what the ratchet enforces.

## The four ratchets (never decrease)
Tests · formal specs · tripwires · frontmatter coverage. A merge that drops any
ratchet is a BLOCKER. See `.agentile/coverage/GATES.md`.

## Hard-won Citrate facts (verify before relying)
- Chain **40204** (`0x9D0C`), native **SALT** (18 decimals, wei = "grains").
- **GHOSTDAG BlockDAG** — multiple tips at once; **blue_score ≠ height**; finality
  is by **depth** (`current_blue_score − block.blue_score ≥ 100`), not
  "confirmations". Each block has 1 selected parent + 0–10 merge parents.
- **No native paymaster** → gasless writes go through the app-layer EIP-2771
  `CitrateForwarder` relayer (`/api/relay`).
- EVM-compatible **LVM**, Solidity ≤0.8.26. Verify any address with `eth_getCode`
  before treating it as a contract.
- Inference is **env-driven** (OpenAI-compatible gateway or local); build for the
  finished state — the gateway may be warming up.
- **Rule 11 (no mocks):** every feature traces to a real data source — live RPC,
  a Neon table, Foundry, or the sandbox. Live-RPC tests run with `LIVE_RPC=1`.
