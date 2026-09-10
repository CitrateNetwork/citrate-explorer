---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: active
---

# PLANSET — CitrateScan Research Agent (v1)

The explorer's "Ask CitrateScan" agent works today: it reads the chain with 19
read-only tools and answers grounded questions. This planset takes it from
*working* to *wow* — where **wow = fast, reads the chain well, and connects logic**
for both newcomers and blockchain-natives, **without anyone needing a transaction
hash or receipt**.

It does NOT chase a bigger model. Citrate's whole thesis is small models made
expert by **LoRA fine-tuning** and served fast through the inference gateway. So
the intelligence here comes from three places working together:

1. A **richer, deterministic tool + query layer** (the agent's hands) — built on a
   real indexed value/transfer backbone so hash-free historical questions are
   answerable at all.
2. A **Citrate-expert LoRA** on Gemma (the agent's instincts) — trained on the
   chain's own structure (precompiles, native contracts, ABIs, the address map,
   DAG/finality semantics) and on tool-use traces, registered on-chain in the
   **LoRAFactory** registry, served by id through the gateway.
3. An **eval harness** (the agent's report card) — built FIRST, so every change is
   measured against a golden benchmark rather than vibes.

This is **one comprehensive planset, executed eval-first**: build the harness and
capture a baseline, prove the loop on a single high-value capability (the
"when was 30k SALT sent?" query), then build out end-to-end.

---

## What we are building

A blockchain research analyst that a non-technical person can talk to in plain
language — *"who got the biggest SALT payouts last week?"*, *"is this address a
contract, and what does it do?"*, *"trace where this token went"* — and that a
technical auditor can lean on for real forensic work. It plans a sequence of tool
calls to satisfy an under-specified question, asks a crisp clarifying question when
it genuinely can't proceed, distinguishes native **SALT** from any **ERC-20 / ERC-721**
token (and tokens launched later), knows every native Citrate contract and
precompile by name and purpose, and returns answers as tight prose with **tables and
lists** when that's the clearest form — never over-explaining.

Concrete facts it must always honor (Citrate, chain `40204`): native token **SALT**
(18 decimals; wei = "grains"); **GHOSTDAG** BlockDAG (multiple tips; `blue_score ≠
height`; finality by depth `maxBlueScore − blue_score ≥ 100`); EVM-compatible **LVM**;
no native paymaster (gasless via EIP-2771 forwarder); inference is env-driven via the
Citrate gateway. The agent is **read-only** — it never signs or writes.

## The differentiator leads: eval-first, backbone-second

We sequence the **eval harness first** (RA-1) because we cannot improve what we
can't measure, and because the user explicitly wants to *"set a benchmark and eval
set up so we can actually assess capabilities over the coming week."* The harness
turns every later sprint into a measured experiment.

We then prove the loop end-to-end on **one capability** (RA-2): the hash-free value
query. This is the exact thing that fails today — *"when was 30,000 SALT sent and by
whom?"* fails because `transactions.value` is indexed by from/to/block/time but
**not by value**, and the `token_transfers` table exists in the schema but is
**never populated**. RA-2 builds the thinnest backbone slice + one tool to answer it
and shows the benchmark move. Only then do we commit to the **full indexed
value/transfer backbone** (RA-3), which is the foundation everything else needs.

## How the requested cadence maps to Agentile

| Requested phase | Agentile mechanism |
|---|---|
| "map out changes before building" | This PLANSET + EVALUATION.md + ADRs (Rule 7 docs precede code) |
| "set a benchmark + eval" | RA-1 eval harness on the `scripts/eval/` BENCH framework; golden set in `scripts/eval/scenarios/` |
| "test one capability" | RA-2 thin vertical slice (BDD `.feature` → RED → GREEN) |
| "build out end to end" | RA-3..RA-8 (FEATURE workflow per sprint) |
| "assess over the coming week" | benchmark-nightly + per-sprint eval deltas recorded in each SPRINT.md |
| spec → test → code → refactor → document → retro | PRODUCT_SPEC refs → `.feature`/RED → GREEN → REFACTOR → Rule-7 docs → RETRO.md |

## Target architecture (v1)

```
                         ┌──────────────────────────────────────────────┐
   USER (NL question) ──▶│  Ask CitrateScan  (agent.tsx, useChat)        │
   "when was 30k SALT     │  • tables/lists rendering (RA-6)             │
    sent?"                │  • clarifying-question UX (RA-6)             │
                         └───────────────┬──────────────────────────────┘
                                         │ POST /api/chat (stream)
                                         ▼
                  ┌─────────────────────────────────────────────────────┐
                  │  Agent runtime  (src/app/api/chat/route.ts)          │
                  │  • system prompt + Citrate knowledge pack (RA-5)     │
                  │  • plan→execute scaffold, step budget (RA-6)         │
                  │  • model via gateway: Gemma + citrate-expert LoRA    │
                  └───────────────┬─────────────────────────────────────┘
                                  │ tools (ONE shared registry — X-1)
                                  ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  Tool brain  (src/lib/ai/tools  ⇄  src/app/api/mcp)                         │
   │  research suite (RA-4): findTransfers · tokenActivity · richList ·          │
   │  traceValueFlow · contractIntrospect · timeRange/amount resolvers · …       │
   └───────┬───────────────────────────────┬───────────────────────────┬────────┘
           │ live RPC (viem)               │ indexed reads             │ precompiles/eth_call
           ▼                               ▼                           ▼
   ┌───────────────┐         ┌──────────────────────────────┐   ┌──────────────────┐
   │ Citrate node  │         │  Neon (indexed backbone RA-3) │   │ native contracts │
   │ rpc.citrate.ai│◀───────│  blocks · txs(+value idx) ·    │   │ + precompiles    │
   └───────────────┘  ingest │  token_transfers(POPULATED) · │   │ (catalog RA-5)   │
        ▲   indexer worker   │  tokens · accounts/richlist   │   └──────────────────┘
        └────────────────────┴──────────────────────────────┘
                                  ▲
                                  │ measured by
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Eval harness (RA-1)  scripts/eval/scenarios/agent_*  →  BENCH metrics     │
   │  golden Q set · tool-selection · groundedness · accuracy vs RPC · latency  │
   └──────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ training corpus (catalog + ABIs + traces)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  LoRA track (RA-8)  curate → train on Gemma → register (LoRAFactory) →     │
   │  serve by id via gateway → measure lift vs base                           │
   └──────────────────────────────────────────────────────────────────────────┘
```

## Pillars

| Pillar | What it means | Lands in |
|---|---|---|
| **Hash-free investigation** | Answer by amount / time / counterparty / token — never requiring a hash or receipt. | RA-2, RA-3, RA-4 |
| **Chain-fluent knowledge** | Knows every native contract, precompile, the address map, DAG/finality; native-vs-token disambiguation is built in. | RA-5, RA-8 |
| **Small-model intelligence** | A Citrate-expert LoRA makes a fast small model reason well about *this* chain. | RA-8 |
| **Measured quality** | A golden benchmark scores groundedness, tool-selection, accuracy, latency; every change is an experiment. | RA-1 (and gates all others) |
| **Conversational research UX** | Plans multi-step queries, asks clarifying questions, renders tables/lists, stays concise. | RA-6 |
| **One tool brain** | A single shared registry powers both the chat agent and MCP (resources + prompts). | RA-4, RA-7 |

## Sprint map

| Sprint | Goal (one sentence) | Workflow | Status | Key dependency |
|---|---|---|---|---|
| **RA-1** | Stand up an agent eval harness + golden benchmark and capture today's Gemma baseline. | FEATURE (eval-first) | ✅ shipped (#44) | `scripts/eval/` BENCH harness (exists) |
| **RA-2** | Prove the eval loop end-to-end with one capability: the hash-free SALT value query. | FEATURE (thin slice) | ✅ shipped (#45) | RA-1 |
| **RA-1.5** | Harden the eval so its number can gate: N-run averaging + variance, robust scoring, pre-merge path; re-baseline. | FEATURE (eval) | ✅ shipped | RA-1; surfaced by RA-2 close-out |
| **RA-3** | Build the full indexed value/transfer backbone (native value indexes + decoded ERC-20/721 transfers). | FEATURE | ✅ shipped (#48) | RA-2; Neon; indexer worker |
| **RA-4** | Ship the research tool suite + one shared chat/MCP tool registry. | FEATURE | ✅ shipped (#55) | RA-3; X-1 |
| **RA-5** | Generate the Citrate contract knowledge pack (describeContract/citrateContracts). | FEATURE | ✅ shipped (#56) | canonical address map (WP-Z) |
| **RA-6** | Context-budget fit (root-caused the ~4k error) + tables in chat. | FEATURE | ✅ shipped (#50/#54) | RA-4, RA-5 |
| **RA-7** | MCP resources + prompts. | FEATURE | ✅ shipped (#58) | RA-4, RA-5 |
| **RA-8** | Citrate-expert LoRA: corpus + training pipeline + runbook. | FEATURE | 🔄 started (corpus+pipeline; gated on base-weights) | RA-1 (eval), RA-5 (corpus), LoRA compute + gateway |

## Sequencing rationale

- **RA-1 before everything** — you can't tune a small model or judge a new tool
  without a number to move. The harness is the instrument; it also generates the
  first tranche of tool-use traces that RA-8 trains on.
- **RA-2 before RA-3** — proving the loop on one capability de-risks the big
  backbone build and validates the eval signal is real (the number must move when a
  genuinely-better capability ships).
- **RA-3 is the foundation** — hash-free value/token investigation is structurally
  impossible without populated, indexed transfer data. Most of RA-4's tools are thin
  query wrappers over it.
- **RA-4 → RA-5 → RA-6** — give the agent hands (tools), then knowledge (prompt +
  catalog), then judgment (planning + clarifying questions). Knowledge before
  judgment because a clarifying-question protocol needs the catalog to suggest
  options.
- **RA-7 (MCP) after RA-4/RA-5** — MCP resources/prompts expose the same registry
  and knowledge pack; doing it earlier would mean redoing it.
- **RA-8 (LoRA) last but corpus-fed throughout** — the training corpus is assembled
  from the catalog (RA-5) and tool-use traces accumulated across RA-1..RA-7. Training
  last means the LoRA learns the *final* tool surface and answer style, and its lift
  is measured against a mature baseline.

## Cross-cutting decisions (apply to every sprint)

| ID | Decision | Rationale |
|---|---|---|
| **X-1** | Chat tools and MCP tools derive from **one shared registry**; neither hand-maintains its own list. | Today they are duplicated (19 vs 18) and will drift. One source of truth. See ADR-003. |
| **X-2** | Every tool names its data source in code (Rule 11): live RPC, a named Neon table/index, or a precompile/`eth_call`. No fabricated data; "not provisioned" is an honest return. | Rule 11. |
| **X-3** | Native **SALT** (`transactions.value`) and **token transfers** (decoded logs → `token_transfers`) are first-class and **always distinguished** in a value answer. Token identity always carries `{address, symbol, decimals, standard}`. | The "30k SALT vs 30k of some token" ambiguity is the core UX failure; never conflate. See ADR-002. |
| **X-4** | Order and scan by `blue_score` + finality depth, **never** by height. | `blue_score ≠ height` on a DAG (inherited). |
| **X-5** | Reads serve from Neon; on a miss or for not-yet-indexed tips, fall through to live RPC and backfill async. | Indexer lags the tip; never show stale-or-nothing (inherited). |
| **X-6** | The explorer agent is **read-only**. No signer, key, or write path is ever wired into this agent. | Owner directive; this agent reads, it does not transact. |
| **X-7** | Every agent-affecting change is gated by the eval harness. A regression in groundedness or accuracy is a **blocker**; latency is **watched, not blocked** (perf is not a ratchet). | Eval-first; matches `scripts/eval/` shadow-mode model. |
| **X-8** | LoRA artifacts are versioned and registered on-chain (**LoRAFactory** `0x6e564d…`); every eval run records `{base_model, lora_id}` for reproducibility. | Dogfoods the LoRA registry; reproducible measurement. See ADR-001. |

## Sprint detail (summaries; full SPRINT.md per sprint at kickoff)

### RA-1 — Eval harness + golden benchmark + baseline — status: planned
**Goal:** Stand up an agent eval harness and capture today's Gemma baseline.
**Workflow:** FEATURE (eval-first). Detailed plan: [`sprints/RA-1-eval-harness.md`](sprints/RA-1-eval-harness.md).

Build agent-eval scenarios as executables under `scripts/eval/scenarios/` that emit
`BENCH` lines into the existing harness. Author a **golden question set** spanning
three personas (newcomer, auditor, blockchain-native) and the capability classes we
care about (value/amount queries, token vs native, address/contract investigation,
DAG/finality, multi-step). Each golden item carries ground truth derived from **live
RPC** (Rule 11 — truth is computed from the chain, not hand-typed). Score four
families: **tool-selection** (precision/recall vs expected tool set), **groundedness**
(answer cites ≥1 tool call, via `audit_log`), **accuracy** (answer matches ground
truth), **latency/steps**. Capture the baseline run for `gemma-4-E4B-it-Q4_K_M`.
Headline WPs: golden-set schema + fixtures; RPC ground-truth generator; scenario
runner that drives `/api/chat` headlessly; metric scorers; baseline snapshot +
`canonical.json`.

### RA-2 — Thin vertical slice: hash-free SALT value query — status: planned
**Goal:** Answer *"when was 30,000 SALT sent and by whom?"* and show the benchmark move.
**Workflow:** FEATURE (thin slice, BDD-led). Detailed plan: [`sprints/RA-2-value-query-slice.md`](sprints/RA-2-value-query-slice.md).

Build the minimum: a value/time index path for native `transactions.value` (forward
slice or bounded scan, whichever the slice proves) and **one** tool — `findTransfers`
for native SALT by amount range + time/counterparty — plus an `amount` resolver
("30k SALT" → grains) and a `timeRange` resolver ("last week" → block range via
`blue_score`/timestamp). Add the corresponding golden items to RA-1 and demonstrate
the accuracy metric move from ~0 to passing on the value-query class. This is the
proof that the eval loop produces real improvement before we commit to RA-3.

### RA-3 — Full indexed value/transfer backbone — status: planned
**Goal:** Make native value and ERC-20/721 transfers fully indexed and queryable.
**Workflow:** FEATURE. Detailed plan: [`sprints/RA-3-value-transfer-backbone.md`](sprints/RA-3-value-transfer-backbone.md). Decision: [`ADR-002-value-transfer-backbone.md`](ADR-002-value-transfer-backbone.md).

Extend the indexer to **decode Transfer/TransferSingle/TransferBatch logs** into the
existing (currently empty) `token_transfers` table; populate `tokens` (metadata,
standard, decimals) and `accounts` (balance/rich-list rollups); add **value/amount +
time indexes** to `transactions` and `token_transfers`. Respect `superseded` blocks
on reorg (no double counting — X-4). Backfill historical + forward-fill from the tip.
Add repository query methods (by amount range, time window, token, counterparty,
direction). Migrations + indexer worker changes + `repository.ts` queries + live-RPC
ground-truth tests.

### RA-4 — Research tool suite (the query brain) — status: planned
**Goal:** Ship the research tools on one shared registry.
**Workflow:** FEATURE.

New tools over the RA-3 backbone, all in **one shared registry** (X-1) consumed by
both `/api/chat` and `/api/mcp`: `findTransfers` (native + token, amount/time/token/
counterparty/direction), `tokenActivity`, `richList`/`holderBalances`,
`traceValueFlow` (best-effort multi-hop via decoded transfers), `contractIntrospect`
(method/event discovery — bytecode selectors + verified ABI when available),
`abiLookup` (native-contract ABI catalog), and the `amount`/`timeRange`/`token`
resolvers promoted from RA-2. Each tool: zod schema, audited, data-source-named
(X-2), and covered by a golden item.

### RA-5 — Chain knowledge + system prompt + contract catalog — status: planned
**Goal:** Give the agent authoritative Citrate knowledge and a rebuilt prompt.
**Workflow:** FEATURE.

Generate a **Citrate knowledge pack** from the canonical address map (WP-Z
`40204.json`) + in-repo ABIs + precompile list: every native contract with a
one-line purpose, address, standard/ABI availability; the precompiles
(`0x…1000`/`…0100` families); the genesis allocations; DAG/finality semantics;
**native-vs-ERC-20-vs-future-token rules**. Rebuild `system-prompt.ts`: persona +
planning protocol + clarifying-question protocol + answer-formatting rules (tables/
lists, concise, no over-explaining) + a compact reference to the knowledge pack
(also exposed as an MCP resource in RA-7). The pack is generated (not hand-typed) so
it stays in sync after re-rolls.

### RA-6 — Reasoning + conversational UX — status: planned
**Goal:** Multi-step planning, clarifying questions, and tables/lists in chat.
**Workflow:** FEATURE.

Server: a **plan→execute scaffold** that helps the small model decompose a question
into a short tool plan, with a parametrized step budget (raise from the fixed
`stepCountIs(8)` where the eval shows it helps). A **clarifying-question protocol**:
when a question is under-specified (e.g., "30k of what token?"), the agent asks one
crisp question with suggested options rather than guessing. Client (`agent.tsx`):
extend `renderRich` with **markdown tables** (it already does ol/ul); render
suggested-option chips for clarifying questions. Tune concise-not-overexplaining and
verify it on the eval set.

### RA-7 — MCP enrichment — status: planned
**Goal:** Shared registry + MCP resources + prompts.
**Workflow:** FEATURE.

Refactor `/api/mcp` to consume the **shared tool registry** (X-1), eliminating the
hand-maintained duplicate. Add MCP **resources**: the Citrate knowledge pack (RA-5),
the address book, the DB schema, chain facts — so MCP clients can ground themselves.
Add MCP **prompts**: research templates ("audit this address", "trace this token",
"explain this finality state", "summarize this contract"). Keep API-key auth +
rate-limit model.

### RA-8 — Citrate-expert LoRA — status: planned
**Goal:** Make the small model a Citrate expert and prove the lift.
**Workflow:** FEATURE. Strategy: [`ADR-001-small-model-lora-strategy.md`](ADR-001-small-model-lora-strategy.md).

Curate a training corpus from the chain's own structure (RA-5 knowledge pack + ABIs +
precompiles + address map + DAG semantics) and from **tool-use traces** (RA-1 golden
runs + `audit_log`): `question → tool-plan → grounded answer` exemplars, with a
strict **train/eval holdout** (no golden-set leakage). Train a LoRA on Gemma (on the
DGX compute), **register it in LoRAFactory** on-chain, serve it by id through the
gateway, and measure the eval lift vs base Gemma at equal latency. This is where the
small-model "wow" is realized.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Full-history transfer backfill is slow / heavy on Neon | Med | Med | Forward-fill first (RA-2 slice), backfill in batches off-peak; index incrementally; cap per-query scan and report it (no silent truncation). |
| DAG reorgs double-count transfers | Med | High | Respect `superseded`/`finalized` flags (X-4); transfers keyed to canonical blocks; reconciliation test vs RPC ground truth. |
| Small model can't plan multi-step even with tools | Med | High | Tight plan→execute scaffold (RA-6), clarifying questions to shrink the problem, and the LoRA (RA-8); eval gates each step (X-7). |
| Eval-set leakage into LoRA training inflates the score | Med | High | Strict holdout; golden set is versioned and excluded from the training corpus by construction; record `{base, lora_id}` per run (X-8). |
| Non-standard / missing-decimals tokens misread as amounts | Med | Med | Always read `decimals()`; carry token identity (X-3); honest "unknown decimals" rather than a wrong number. |
| Larger prompt + multi-step raises latency past "fast" | Med | Med | Keep tools indexed/fast; watch latency in eval (not a blocker, X-7); compact knowledge pack; LoRA reduces needed prompt scaffolding. |
| Gateway can't yet serve a LoRA by id | Low | High | Confirm gateway LoRA-serving path in RA-8 dependency check before training; fall back to base Gemma (still shippable) if not ready. |

## Success metrics

| Metric | Target | Data source |
|---|---|---|
| Hash-free value-query accuracy (the "30k SALT" class) | 0% → ≥ 90% on golden set | RA-1 accuracy scorer vs live-RPC ground truth |
| Tool-selection F1 on golden set | baseline → +20 pts | RA-1 tool-selection scorer vs expected tool sets |
| Groundedness (answer cites ≥1 tool) | 100% | `audit_log` rows per answer (RA-1 scorer) |
| Token-vs-native disambiguation correctness | ≥ 95% on mixed golden items | RA-1 scorer (X-3 assertions) |
| Median answer latency | watched (target ≤ ~8 s) | RA-1 latency metric (BENCH); not a ratchet (X-7) |
| LoRA lift over base Gemma | + measurable F1/accuracy at equal latency | RA-1 run with `{base}` vs `{base+lora_id}` (X-8) |
| Transfer-index completeness | 100% of decodable Transfer logs in `token_transfers` | reconciliation test: indexed count vs RPC `getLogs` (RA-3) |

## Dependencies (project-level)

| ID | Dependency | Needed by | Status |
|---|---|---|---|
| D-1 | Neon `citratescan` DB (have it) | RA-2, RA-3 | ready |
| D-2 | Indexer worker running (DO droplet — see `INDEXER_DROPLET_HANDOFF`) | RA-3 backfill | confirm |
| D-3 | Canonical address map `40204.json` synced (`pnpm sync-addresses`) | RA-5 | ready |
| D-4 | LoRA training compute (DGX Spark per project memory) | RA-8 | confirm |
| D-5 | Gateway serves a LoRA by id (`infer.citrate.ai` + LoRAFactory) | RA-8 | confirm (RA-8 gate) |
| D-6 | Gemma base weights + LoRA-compatible trainer | RA-8 | confirm |
| D-7 | Headless `/api/chat` driver (token auth) for eval scenarios | RA-1 | build in RA-1 |

## Definition of done (planset)

- Eval harness live; baseline + per-sprint deltas recorded; benchmark-nightly green.
- Hash-free value/token investigation works for newcomers and auditors, native +
  ERC-20/721, with native-vs-token always distinguished (X-3).
- The agent knows every native contract + precompile (generated knowledge pack),
  asks clarifying questions when under-specified, and renders tables/lists.
- One shared tool registry powers chat + MCP; MCP exposes resources + prompts.
- A Citrate-expert LoRA is trained, registered on-chain, served by the gateway, and
  shows a measured lift over base Gemma.
- All four ratchets held or raised; no eval regression merged (X-7).

## Execution

Branch per sprint (`feat/RA-N-<slug>`). Kickoff commit per sprint adds the detailed
`SPRINT.md` to `.agentile/sprints/active/` and snapshots the four ratchets + the
current eval baseline. `CURRENT.md` points here. Nothing in this planset writes to
the chain or wires a signer (X-6).
