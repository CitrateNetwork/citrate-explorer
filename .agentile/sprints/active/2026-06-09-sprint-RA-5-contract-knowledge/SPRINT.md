---
created: 2026-06-09T11:25:00Z
branch: feat/RA-5-contract-knowledge
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-5
status: active
---

# Sprint RA-5: Citrate contract knowledge pack

## Goal
Let the agent explain WHAT Citrate's contracts do (and what Citrate offers), not just
name them — closing gap G-4 at the semantic level.

## Context
The RA-6 context fix already pushed the `address` class to 1.0 (the agent reads the
`label` field and narrates the NAME). RA-5's value is the next layer: PURPOSE — so the
agent can answer "what does the InferenceRouter do" / "what can I do on Citrate".

## What shipped
- `src/lib/citrate/contractCatalog.ts` (+6 tests) — curated `{name → category, purpose}`
  for ~45 system contracts across 9 categories (AI/Inference, Compute/GPU-share, Learning,
  Governance/Treasury, Staking, Tokenization, Payments, AA, Precompile), the 6 precompiles
  (0x…1000/1001/1003, 0x…0100/0101/0108), and a one-paragraph `CITRATE_OVERVIEW`. Keyed by
  NAME, joined to the canonical address map at read time (re-roll safe). Honest `known=false`
  for non-system addresses.
- Tools `describeContract(address)` + `citrateContracts(category?)` — auto-flow to MCP via
  RA-4 (MCP 20→22). Catalog knowledge; confirm live code with getAddress.
- System prompt: a compact bullet steering "what is this contract / what can I do on
  Citrate" to these tools + a one-line statement of Citrate's nature.
- 2 golden items (describe InferenceRouter / LoRAFactory by purpose).

## Verification
- Catalog + golden + MCP tests pass; full suite 161→167 green (0 failures); typecheck clean.
- MCP route now 22 tools (the 2 new ones auto-flowed — RA-4 working).

## Log
- **2026-06-09** — Built the curated catalog + describeContract/citrateContracts tools +
  prompt note + golden items. Suite green. Deploying to measure.
