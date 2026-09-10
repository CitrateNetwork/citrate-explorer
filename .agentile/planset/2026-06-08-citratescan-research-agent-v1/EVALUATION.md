---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: active
---

# EVALUATION — Current state of the CitrateScan agent (pre-RA-1)

A grounded gap analysis from a full read of the agent stack on 2026-06-08. Every
claim below is anchored to a file. This justifies the RA-1..RA-8 sprint sequence.

## Method

Five parallel code reads across: the chat route + AI tools + system prompt + model
provider; the MCP server; the indexer + DB schema + read API; the chain/contract
knowledge layer; and the agentile eval/coverage conventions. Findings cross-checked
against live behavior (the agent works; the "30k SALT" query fails).

## What works today (do not rebuild)

- **A clean read-only tool layer.** 19 tools in `src/lib/ai/tools.ts` wrap
  `src/lib/harness/ops.ts` (live RPC via viem) + `src/lib/indexer/repository.ts`
  (Neon). Strong primitives already exist: `getTransaction`, `explainTransaction`
  (decodes ERC-20/721 Transfer/Approval at read-time), `callView` (reads *any*
  view/pure fn by Solidity signature — no stored ABI needed), `getToken`
  (auto-detects ERC-20/721, reads decimals), `saltDistribution`, `exploreDag`,
  `getLogs`, `getContractCode`. All audited per call to `audit_log`.
- **A disciplined model seam.** `src/lib/ai/provider.ts` selects an
  OpenAI-compatible provider by `CITRATE_INFERENCE_MODE` (gateway | local | onchain);
  gateway default `https://infer.citrate.ai/v1`, model `gemma-4-E4B-it-Q4_K_M`.
  `route.ts` uses `streamText` with `tools`, `stopWhen: stepCountIs(8)`,
  `temperature: 0.3`, `maxOutputTokens` 4096, plus rate-limiting + thread persistence.
- **A 5-layer system prompt** (`src/lib/ai/system-prompt.ts`): persona, capabilities,
  network facts, guardrails (always included), style.
- **An MCP server** (`src/app/api/mcp/route.ts`): JSON-RPC 2.0, 18 tools, API-key +
  rate-limit auth.
- **Eval *infrastructure*** (`scripts/eval/`): a language-agnostic `BENCH`-line
  benchmark harness, regression checker, data-source (Rule 11) linter, human-eval
  protocol, and `scenarios/` + `baselines/` directories. The plumbing exists.

## The gaps (why "working" is not yet "wow")

### G-1 — Hash-free value queries are structurally impossible (the headline)
`transactions.value` is indexed by `from`/`to`/`block`/`timestamp` but **not by
value** (`src/lib/db/schema.ts`). There is no `WHERE value >= 30000e18` path. The
`token_transfers` table **exists in the schema but is never written** by the indexer
(`src/lib/indexer/ingest.ts` ingests blocks/txs/receipts/raw-logs only; ERC-20 decode
happens at read-time in `explainTransaction`, not at index-time). `tokens` and
`accounts` are likewise unpopulated. Net effect: *"when was 30,000 SALT sent and by
whom?"* without a hash can only be answered by bounded live-RPC scans of recent
blocks and in-memory filtering — it fails for anything historical. **→ RA-2, RA-3.**

### G-2 — No agent quality measurement exists
The aspirational metric *"100% of agent answers cite ≥1 tool call"* (prior PLANSET)
is not implemented. `scripts/eval/scenarios/` has only a README — **zero agent
scenarios**. There is no golden set, no tool-selection score, no accuracy check, no
latency baseline. We are improving blind. **→ RA-1 (first).**

### G-3 — Chat tools and MCP tools are duplicated, will drift
`tools.ts` (19 tools, AI-SDK `tool()` + zod + audit) and `mcp/route.ts` (18 tools,
hand-written JSON-Schema + `run()`) are two hand-maintained lists of the same
underlying ops. MCP omits `ledger`. They will diverge. **→ X-1, ADR-003, RA-4/RA-7.**

### G-4 — The agent has tools but not knowledge
40+ native contracts exist in the canonical map (`src/generated/addresses.json`:
ModelRegistry, InferenceRouter, ComputePool, LoRAFactory, the ERC-4337 AA stack,
precompiles at `0x…1000`/`0x…0100`, …) but **only 3 ABIs are in-repo**
(`src/lib/citrate/abi.ts`: Forwarder, ERC-20, ERC-721). The system prompt's network
section is a short paragraph. The agent cannot reliably say *what a contract is* or
*what the precompiles do*. There is no method/ABI introspection tool. **→ RA-5, RA-4.**

### G-5 — Native vs token disambiguation is implicit
Native SALT lives in `transactions.value`; tokens live in logs. Nothing forces the
agent to distinguish *"30k SALT"* from *"30k of token X"* or to always carry token
identity (`symbol`/`decimals`/`standard`). For non-technical users this is the most
common source of a wrong answer. **→ X-3, RA-3, RA-4.**

### G-6 — No reasoning scaffold or clarifying-question protocol
The loop is a flat `stepCountIs(8)`. There is no plan→execute decomposition and no
mechanism to ask the user a question back when the request is under-specified — the
model either guesses or fails. A small model especially needs this scaffolding.
**→ RA-6.**

### G-7 — Chat can't render tables
`agent.tsx`'s `renderRich` handles `**bold**`, `code`, ordered/unordered lists, and
entity chips — but **not markdown tables**. Organized tabular answers (rich lists,
transfer tables) can't be shown cleanly. **→ RA-6.**

### G-8 — MCP has no resources or prompts
`/api/mcp` implements `tools/*` only. There are no MCP **resources** (a client can't
pull the contract catalog or schema to ground itself) and no **prompts** (no reusable
research templates). **→ RA-7.**

### G-9 — The small model is untuned for Citrate
`gemma-4-E4B-it-Q4_K_M` is a capable, fast small model but has no Citrate-specific
knowledge or tool-use priors. The project strategy is LoRA fine-tuning + the on-chain
LoRA registry (`LoRAFactory 0x6e564d22949992705b5de7108b2c68d3554d5863`). No corpus,
no trained adapter, no serving path is wired. **→ RA-8, ADR-001.**

## Baselines at planset start (the four ratchets)

| Ratchet | Value | Source |
|---|---|---|
| Tests | 96 (day-zero) / ~98 current | `.agentile/coverage/baseline.json`; `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| Formal specs | 1 | `find specs/tla -name '*.tla' \| wc -l` |
| CI tripwires | 6 | `ls scripts/semgrep/*.yaml \| wc -l` |
| Agent eval | **none** | `scripts/eval/scenarios/` (README only) |

Note: one pre-existing test failure unrelated to this planset —
`src/lib/ai/synthesis/explainTransaction.test.ts` "decodes an ERC-20 Transfer"
(expects `ModelRegistry`, gets `null`). Triage during RA-3 (it touches event/label
decoding, which RA-3 reworks).

## How this planset closes the gaps

| Gap | Closed by |
|---|---|
| G-1 hash-free value queries | RA-2 (slice) → RA-3 (backbone) → RA-4 (tools) |
| G-2 no measurement | RA-1 (eval harness, first) |
| G-3 tool duplication | RA-4 + RA-7 (one shared registry, X-1, ADR-003) |
| G-4 no knowledge | RA-5 (generated knowledge pack) + RA-4 (introspection) |
| G-5 native/token ambiguity | X-3 enforced in RA-3/RA-4 |
| G-6 no reasoning/clarify | RA-6 (plan→execute + clarifying protocol) |
| G-7 no tables | RA-6 (renderRich tables) |
| G-8 MCP bare | RA-7 (resources + prompts) |
| G-9 untuned model | RA-8 (Citrate-expert LoRA, ADR-001) |
