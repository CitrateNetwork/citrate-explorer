---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# Planset — CitrateScan (citrate-explorer v1)

> Master plan. Sequences the work in `.agentile/PRODUCT_SPEC.md` and the design
> docs (`DESIGN_BRIEF.md`, `DESIGN_HARNESS_AND_SETTINGS.md`, `EXPLORER_SPEC.md`)
> into six Agentile sprints. Each sprint runs the standard lifecycle (kickoff →
> execute → daily → close); each Work Package runs the 7-step FEATURE workflow
> (TLA+/BDD → RED → GREEN → REFACTOR → adversarial → tripwire+journal). **Every WP
> acceptance criterion names its data source (Rule 11) — no mocks, no seed data,
> no "testing backend" loopholes.** Contract deploys and the production indexer
> cutover run as **CEREMONIES** (`.agentile/workflows/CEREMONY.md`).

## What we are building

**CitrateScan** — an AI-native block explorer for the **Citrate Network**, a
GHOSTDAG **BlockDAG** L1 (chainId **40204**, hex `0x9D0C`, native token **SALT**,
18 decimals, wei = "grains"). It is a better, more agentic Etherscan: the same
trustworthy block/tx/address/contract surface every Ethereum dev expects, plus
three things Etherscan cannot do —

1. **DAG-native truth.** Citrate is not a chain; it is a directed acyclic graph
   ordered by GHOSTDAG. Blocks have a `selected_parent_hash` **and**
   `merge_parent_hashes[]`; ordering is by `blue_score`, not height; multiple
   tips exist at once; finality is by blue-score depth (`current_blue_score -
   block.blue_score >= 100`), not confirmations. A linear explorer is *wrong*
   here, not just incomplete. CitrateScan renders the DAG as a DAG.
2. **An AI agent that actually reads the chain.** A streaming agent (Vercel AI
   SDK v6) with a real tool harness over live RPC and the indexer — it explains
   transactions, diagnoses failures, walks the DAG, and answers "what happened"
   in plain English, every answer traceable to a real backend call.
3. **A machine-first API.** An Etherscan-compatible REST surface (`/api/v1`) and
   a public **MCP server** (`/api/mcp`) so other agents can consume Citrate the
   way humans consume CitrateScan.

## The differentiator leads: why S-1 is the indexer + AI foundation

A block explorer is only as good as its index. Etherscan's moat is not its UI —
it is years of indexed, decoded, queryable history. **So S-1 builds the index
first**, and builds it DAG-aware from block zero: the always-on indexer worker,
the Neon schema (including `dag_edges` for selected-parent and merge-parent
links), and the AI tool harness that reads it. Everything downstream — pages,
DAG viz, verification, read/write, the dev API — is a *view* over that index or
a *fall-through* to live RPC. Build the foundation wrong and all six sprints
rot; build it right and the rest compose cleanly. This is the inversion of a
typical "pages first, index later" explorer plan, and it is deliberate.

## How the requested cadence maps to Agentile

| Cadence phase | Agentile mechanism |
|---|---|
| Spec | `PRODUCT_SPEC.md` + `EXPLORER_SPEC.md` + per-WP scope/acceptance |
| feature | Work Package definition + BDD/Gherkin `.feature` |
| test | RED — failing test + tripwire (Rule 3 ratchet) |
| code | GREEN — smallest real implementation, no mocks (Rule 2/11) |
| refactor | REFACTOR — only under green |
| document | Rule 7 docs-with-code + Rule 12 frontmatter |
| retrospective | `RETRO.md` at sprint close |
| journal+essay | `/journal` per non-obvious learning, `/essay` at milestones |

## Target architecture (v1) — three runtimes

CitrateScan is **not one process**. The hard-won lesson from a DAG with WS
subscriptions and always-on ingest is that an explorer cannot live entirely on
Vercel. Three runtimes, with clean seams:

```
                         Citrate L1 — GHOSTDAG BlockDAG (chainId 40204, SALT)
   JSON-RPC https://rpc.citrate.ai:8545   ·   WS wss://rpc.citrate.ai:8546
   eth_* + citrate_getDagStats + citrate_{getTextEmbedding,semanticSearch,chatCompletion}
   AI precompiles 0x0100–0x0106 · CitrateForwarder (EIP-2771, ours)
        │                                   │                            │
        ▼ (1) INDEXER WORKER                ▼ (2) VERCEL APP             ▼ (3) VERIFY SANDBOX
   always-on Node/TS (NOT Vercel)      Next.js 16 / React 19 / TS    Vercel Sandbox microVM
   ├ eth_subscribe newHeads (WS)       ├ UI: blocks/tx/addr/contract  ├ multi-version solc farm
   ├ backfill eth_getBlockByNumber     ├ /api/* read API (reads Neon, ├ recompile-and-diff
   ├ eth_getTransactionReceipt + logs  │   falls through to live RPC) │   (constructor args,
   ├ citrate_getDagStats (tips, blue)  ├ POST /api/chat (AI agent)    │   CBOR auxdata,
   └ WRITE → Neon (Drizzle):           ├ /api/dag topology+stream     │   immutables, libs)
       blocks, transactions, receipts, ├ /api/verify orchestration    └ returns match verdict
       logs, dag_edges, accounts,      ├ /api/relay EIP-2771 relayer       to /api/verify
       contracts, tokens,              ├ /api/v1 Etherscan-compat REST
       token_transfers,                ├ /api/mcp MCP server
       contract_verifications          └ Privy auth · hybrid crypto
                                              │
                                              ▼
                                  Neon Postgres (Drizzle / @neondatabase/serverless)
                       indexer tables (above) + user tables: settings, api_keys,
                       watchlist, audit_log, threads, messages(encrypted), thread_memory
```

**Inference** is OpenAI-compatible and env-driven: `infer.citrate.ai/v1` gateway
or a local `llama-server` via `@ai-sdk/openai-compatible`. Embeddings/semantic
search go through the AI precompiles / `citrate_*` RPC where available, indexed
into Neon for fast recall.

**Hybrid encryption** (one model, three regimes — see
`DESIGN_HARNESS_AND_SETTINGS.md`):
- **E2EE** for logins/settings — key derived client-side from a wallet signature
  → HKDF → AES in-browser; server stores ciphertext only.
- **Hashed** for our issued API keys — salted SHA-256, shown once.
- **AES-256-GCM at-rest** for third-party provider keys the agent uses
  server-side — per-user key `HKDF(master, wallet)`.

## Pillars

| Pillar | What it means | Lands in |
|---|---|---|
| **P1 DAG-native index** | Every read traces to indexed blocks/txs/logs/dag_edges or live RPC; ordering by `blue_score`; finality by depth; merge parents are first-class. | S-1, S-2 |
| **P2 Agentic reading** | AI agent with a real tool harness; no answer without a backing call; transparency (system prompt + tool allowlist + audit log). | S-1, S-2, S-6 |
| **P3 See the DAG** | Real GHOSTDAG visualization: Sugiyama layout, blue/red coloring, selected-parent spine, live tips — never a free-floating force layout. | S-3 |
| **P4 Trust the bytecode** | Source verification by recompile-and-diff in a sandbox; proxy-aware; Etherscan-compatible verify API. | S-4 |
| **P5 Gasless interaction** | Read + Write contract tabs; gasless writes via CitrateForwarder relayer (no native paymaster on Citrate). | S-5 |
| **P6 Machine-first** | Etherscan-compatible REST + public MCP server + hybrid-stored API keys + E2EE settings/account control. | S-6 |

## Sprint map

| Sprint | Goal (one sentence) | Workflow | Status | Key dependency |
|---|---|---|---|---|
| **S-1 Indexer + AI foundation** | The indexer worker ingests live Citrate blocks/txs/logs/dag_edges into Neon, and an AI agent answers questions over it and live RPC. | FEATURE | **active** | D-Neon, D-Privy, D-Infer |
| **S-2 Core explorer pages** | A user browses real blocks/tx/address/contract/token pages over the indexer, with decoded logs, gas/state breakdowns, plain-English summaries, and omni-search. | FEATURE | planned | S-1 |
| **S-3 Live DAG visualization** | A user watches the GHOSTDAG grow in real time — Sugiyama layout, blue/red, selected-parent spine, live tips, click→detail. | FEATURE | planned | S-1 (dag_edges), S-2 (detail panels) |
| **S-4 Contract verification** | A user submits Solidity source and CitrateScan proves it matches deployed bytecode via sandboxed recompile-and-diff, proxy-aware, Etherscan-compatible API. | FEATURE + CEREMONY (sandbox cutover) | planned | S-1 (contracts), S-2 (contract page) |
| **S-5 Read/Write contracts** | A user reads contract state and submits writes — including **gasless** writes via the CitrateForwarder relayer through a Privy embedded wallet. | FEATURE + CEREMONY (forwarder deploy) | planned | S-4 (ABI from verified source), D-Forwarder |
| **S-6 Dev API + keys + MCP + settings** | A developer (or agent) calls an Etherscan-compatible REST API and an MCP server with a managed key, and a user controls their E2EE settings/account with full transparency. | FEATURE + AUDIT_DRIVEN | planned | S-1..S-5 (all surfaces to expose) |

---

## Sequencing rationale

- **S-1 before everything** because the index is the product (see above). It also
  forces the DAG-native data model (`dag_edges`, `blue_score`, finality-by-depth)
  to be correct *before* any UI assumes a linear chain.
- **S-2 before S-3** because the DAG viz click→detail panel reuses the S-2
  block/tx detail components and APIs; building viz first would mean stubbing
  detail panels (Rule 2 violation).
- **S-3 can run partly parallel to S-4** — they share no code path. We sequence
  S-3 first because the live DAG is the headline demo and de-risks the WS delta
  pipeline early.
- **S-4 before S-5** because the Write Contract tab needs a verified ABI to
  render a typed write form; verification is the data source for the ABI.
- **S-6 last** because the dev API, MCP server, and account controls *expose*
  every surface the prior sprints built; exposing an incomplete surface to
  machines is worse than not exposing it.

## Cross-cutting decisions (apply to all sprints)

| ID | Decision | Rationale |
|---|---|---|
| X-1 | Reads serve from Neon; on a miss or for not-yet-indexed tips, fall through to live RPC and backfill async. | Indexer can lag the tip; UI must never show stale-or-nothing. Data source is always named (indexed table OR live RPC). |
| X-2 | Order by `blue_score` everywhere; expose `height` separately; never conflate them. | `blue_score ≠ height` on a DAG. A "latest blocks" list ordered by height is wrong. |
| X-3 | Finality is computed, not stored: `final = (currentBlueScore - block.blue_score) >= 100`. | `finalityDepth: 100` from `citrate_getDagStats.ghostdagParams`. Confirmations are meaningless on a DAG. |
| X-4 | All SALT amounts are dual-unit: SALT (18-dec) and grains (wei). APIs return both. | Avoids the unit-confusion class of bugs; MCP/REST consumers need raw grains. |
| X-5 | Verify every contract address with `eth_getCode` before treating it as a contract. | Hard-won Citrate rule; EOAs and selfdestructed addresses must not render as contracts. |
| X-6 | No native paymaster on Citrate → all sponsored writes go through **our** CitrateForwarder (EIP-2771) + a relayer that pays SALT. | There is no protocol paymaster to lean on; gasless is app-layer. |

---

## S-1 — Indexer + AI foundation (the differentiator)  ·  status: active

**Goal:** The always-on indexer worker ingests live Citrate blocks, transactions,
receipts, logs and DAG edges into Neon, and a streaming AI agent answers questions
over the index and live RPC with a real read-only tool harness.

Full sprint file: `sprints/S-1-indexer-ai-foundation.md`. Headline WPs: chain
config + viem clients (`eth_chainId → 0x9d0c` live test) · indexer worker (WS
`newHeads` ingest + backfill → `blocks/transactions/receipts/logs/dag_edges`) ·
read-only harness tools (`getBlock/getTransaction/getAddress/getLogs/exploreDag/
readContract/isContract`) · `POST /api/chat` streaming agent + `explainTransaction`
synthesis · Privy auth · hybrid `crypto.ts` · live-RPC vitest.

## S-2 — Core explorer pages  ·  status: planned

**Goal:** Real blocks/tx/address/contract/token pages over the indexer, with
decoded logs, internal txns, state diffs, gas breakdown, plain-English summaries,
and `/api/search` omni-search. File: `sprints/S-2-core-explorer-pages.md`.

## S-3 — Live DAG visualization  ·  status: planned

**Goal:** d3-dag Sugiyama in a Web Worker + WebGL renderer + WS delta stream
(`/api/dag`), selected-parent spine, blue/red GHOSTDAG coloring, tips accent,
click→detail, semantic zoom, minimap. File: `sprints/S-3-live-dag-visualization.md`.

## S-4 — Contract verification  ·  status: planned

**Goal:** Multi-version solc farm in a Vercel Sandbox; recompile-and-diff
(constructor args, CBOR auxdata, immutables, library linking); proxy detection
(EIP-1967/1822/Beacon); Etherscan-compatible verify API; UI verify tab.
File: `sprints/S-4-contract-verification.md`.

## S-5 — Read/Write contracts  ·  status: planned

**Goal:** Decoded Read Contract tab (`eth_call`); Write Contract via Privy
embedded wallet (viem/wagmi); gasless write path via CitrateForwarder relayer
(`/api/relay` + `useSponsoredWrite`). File: `sprints/S-5-read-write-contracts.md`.

## S-6 — Dev API + keys + MCP + settings  ·  status: planned

**Goal:** Etherscan-compatible REST (`/api/v1`) over the indexer; API-key
management (`/api/keys`, hybrid storage) with per-key rate limits/quotas; public
MCP server (`/api/mcp`) with decoded/dual-unit/cursor-paginated data;
settings/account pages (E2EE settings, export/delete, transparency).
File: `sprints/S-6-dev-api-keys-mcp-settings.md`.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Treating the DAG as a linear chain** (ordering by height, confirmations, single tip) | High (default mental model) | High | X-2/X-3 baked into the schema and every query; `dag_edges` + `blue_score` are first-class in S-1; viz never uses a force layout. A linear-explorer plan would silently ship wrong data. |
| **Indexer lag behind the tip** (multiple tips, reorgs by blue-work) | High | Med | X-1 fall-through to live RPC + async backfill; indexer reconciles selected-parent chain on each `newHeads`; blue-work used to pick the canonical tip, not arrival order. |
| **Reorg / red-block churn** rewriting recent ordering | Med | Med | Store `blue_score`/`blue_work` per block; recompute finality on read; never delete, mark superseded. Blocks below finality depth (100) are immutable. |
| **Indexer worker is not Vercel** — needs an always-on host | High | Med | Explicit third runtime; deploy on a long-running host (Railway/Fly/VM); health-check + resume-from-last-blue-score on restart. Documented in S-1 DoD. |
| **Inference backend unavailable** (`infer.citrate.ai` down or model unregistered) | Med | Med | Env-driven provider (`gateway | local`); local `llama-server` fallback; tool calls (the read harness) work regardless of which model answers. |
| **Wrong contract addresses** (the 0x1f17/0xc655 traps from chatbot project) | Med | High | X-5: `eth_getCode` before use; CitrateForwarder is **ours**, deployed in S-5 ceremony, recorded in an in-repo address book. |
| **Verify sandbox abuse / cost** (untrusted source compiled in microVM) | Med | Med | Vercel Sandbox isolation; per-IP/key rate limits; solc version allowlist; bounded CPU/time. S-4 + S-6 quotas. |
| **Relayer SALT drained by abuse** | Med | High | S-5/S-6 per-key quotas + rate limits + bot mitigation before public write access; bounded per-user sponsored spend. |
| **WS delta firehose overwhelms the browser** | Med | Med | S-3 batches deltas per `requestAnimationFrame`, last-N windowing, Web Worker layout off the main thread, WebGL render. |

## Success metrics

| Metric | Target | Data source |
|---|---|---|
| Index completeness | 100% of blocks from genesis (or chosen start height) to tip-minus-finality present in `blocks`; gap count = 0 | `SELECT count(*)` vs `citrate_getDagStats.totalBlocks` |
| Index freshness | p95 lag from `newHeads` event to row committed < 3 s | indexer metrics |
| DAG correctness | For 1000 sampled blocks, stored `selected_parent_hash` + `merge_parent_hashes[]` exactly match live `eth_getBlockByHash` | live RPC diff test |
| Finality correctness | Computed finality matches `currentBlueScore - blue_score >= 100` for all sampled blocks | `citrate_getDagStats` + `blocks` |
| AI groundedness | 100% of agent answers cite at least one tool call; 0 answers fabricate data not present in a tool result | `audit_log` + eval set |
| Verification fidelity | A known-verified contract re-verifies with a byte-exact match; a tampered source is rejected | recompile-and-diff in sandbox |
| Gasless write | A user with 0 SALT lands a write on-chain; gas deducted from relayer, not user | live receipt + balance deltas |
| API parity | Etherscan-compatible `module=account&action=txlist` returns the same shape Etherscan does for an equivalent address | `/api/v1` integration test |
| Ratchets | Tests / formal specs / tripwires / frontmatter coverage all monotonically non-decreasing across S-1..S-6 | `.agentile/coverage/GATES.md` |

## Dependencies (project-level)

| ID | Dependency | Needed by | Status |
|---|---|---|---|
| D-Neon | Neon Postgres (Drizzle, `@neondatabase/serverless`) | S-1+ (all reads/writes) | provision in S-1 |
| D-Privy | Privy app (embedded wallets, EIP-712 signing) | S-1 (auth), S-5 (write signing) | provision in S-1 |
| D-Infer | Inference endpoint (`infer.citrate.ai/v1` or local `llama-server`) | S-1 (`/api/chat`) | env-driven; local fallback |
| D-Host | Always-on host for the indexer worker (NOT Vercel) | S-1 (worker runtime) | choose + provision in S-1 |
| D-Sandbox | Vercel Sandbox (microVM) for solc farm | S-4 (verify) | provision in S-4 |
| D-Forwarder | CitrateForwarder (EIP-2771) deployed to 40204 + funded relayer | S-5 (gasless) | deploy ceremony in S-5 |
