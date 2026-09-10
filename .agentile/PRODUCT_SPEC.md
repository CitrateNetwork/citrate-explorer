---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# PRODUCT_SPEC.md — What CitrateScan Does

> The answer to "is this in scope?" If a feature isn't here, it's out of scope
> until added explicitly. Changes are planset-gated. The deep design lives in
> `DESIGN_BRIEF.md`, `DESIGN_HARNESS_AND_SETTINGS.md`, `EXPLORER_SPEC.md`,
> `SYSTEM_PROMPTS.md`; the sprint plan in `.agentile/planset/2026-06-02-citrate-explorer-v1/`.

## Vision

CitrateScan lets anyone — from a curious newcomer to a contract auditor —
understand what is happening on the Citrate Network without reading hashes or
bytecode. It is an Etherscan-class explorer for a GHOSTDAG BlockDAG, but
**AI-native**: a built-in agent with read-only chain tool-calls answers natural
language ("what did this address do today?", "explain this transaction", "is
this contract safe to approve?") and can index the chain on demand to answer.
Every page leads with a plain-English summary above the raw data, fixing
Etherscan's documented "everything is a hash" failure.

It also serves builders: read/write any contract (gasless via the Foundation
relayer), verify contracts through the UI **and** an Etherscan-compatible API,
issue API keys, and drive everything programmatically — including an MCP server
so external AI agents use CitrateScan as their on-chain tool. As Foundation
infrastructure it is open and self-hostable, neutralizing the centralization,
ads, and paywall criticisms of incumbent explorers.

## Modules

### `indexer` (worker)
**Purpose:** continuously ingest the BlockDAG into Neon Postgres for fast query.
**Surface:** an always-on Node process (`pnpm indexer`) subscribing WS
`newHeads`, backfilling via `eth_getBlockByNumber`, fetching receipts/logs,
deriving DAG topology (`dag_edges`, blue_score, finality) from
`citrate_getDagStats`. **Out of scope:** consensus participation; it only reads.
**Acceptance:** S-1 WP — ingests blocks/txs/receipts/logs/dag_edges; reorg-safe;
marks finality at depth 100.

### `ai-agent` ("Ask CitrateScan")
**Purpose:** natural-language exploration + plain-English explanations.
**Surface:** `POST /api/chat` (streaming, Vercel AI SDK v6) with a read-only tool
harness (getBlock/getTransaction/getAddress/getLogs/readContract/exploreDag/
searchTransactions/addressActivity/topHolders/indexAddress/semanticSearch/
explainTransaction/explainContract/diagnoseFailure). **Out of scope:** signing or
writing — writes always require an explicit user wallet action. **Acceptance:**
S-1 — agent answers using tool ground-truth and cites the entities it read.

### `explorer-ui`
**Purpose:** block / tx / address / token / contract pages + omni-search.
**Surface:** Next.js routes + `/api/{search,blocks,tx,address,contract}`.
**Out of scope:** non-Citrate chains. **Acceptance:** S-2.

### `dag-viz`
**Purpose:** realtime interactive GHOSTDAG visualization.
**Surface:** `/api/dag` (snapshot + stream) + a WebGL canvas with the
selected-parent spine, blue/red coloring, tips, click→detail. **Acceptance:** S-3.

### `verification`
**Purpose:** verify contract source against on-chain bytecode.
**Surface:** UI verify tab + Etherscan-compatible `/api/verify` &
`/api/v1?module=contract&action=verifysourcecode`. **Acceptance:** S-4.

### `contracts` (read/write)
**Purpose:** decoded read + write (wallet or gasless). **Surface:** contract page
tabs + `/api/relay`. **Acceptance:** S-5.

### `dev-api` (REST + keys + MCP)
**Purpose:** programmatic access. **Surface:** Etherscan-compatible `/api/v1`,
`/api/keys` (hybrid storage), `/api/mcp`. **Acceptance:** S-6.

### `settings`
**Purpose:** account, privacy, transparency, watchlist. **Surface:** settings
pages + `/api/account[/export]`. **Acceptance:** S-6.

## Non-goals
- Multi-chain support (Citrate only, for v1).
- Custody — CitrateScan never holds funds or signs silently.
- Trading, price feeds, or investment guidance.
- A general chatbot — the agent is scoped to on-chain analysis of Citrate.
- Re-implementing consensus — the indexer reads, it does not validate.

## Assumptions
- (2026-06-02) `rpc.citrate.ai` exposes the documented `eth_*` + `citrate_*`
  methods and WS subscriptions. Check: S-1 live-RPC tests.
- (2026-06-02) Inference is reachable via an OpenAI-compatible endpoint. Check:
  `/api/chat` smoke.
- (2026-06-02) Neon + Vercel are the serverless data + hosting plane. Check: S-1.

## Success metrics
| Metric | Baseline (today) | Target (v1) |
|---|---|---|
| Plain-English answer for any tx/address | none (no explorer) | 100% of pages |
| Omni-search latency (indexed) | n/a | p95 < 300ms |
| DAG live view | desktop-only (Slint) | 60fps web, streaming |
| Contract verification | none | UI + API parity w/ Etherscan |
| External-agent usage | none | MCP server live |

## Update protocol
Changes are planset-gated: file a planset under
`.agentile/planset/YYYY-MM-DD-<change>/`, get review, then merge with the planset
reference in the commit message. No drive-by edits to this file.
