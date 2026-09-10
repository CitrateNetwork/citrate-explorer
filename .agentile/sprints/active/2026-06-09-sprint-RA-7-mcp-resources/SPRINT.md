---
created: 2026-06-09T11:50:00Z
branch: feat/RA-7-mcp-resources
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-7
status: active
---

# Sprint RA-7: MCP resources + prompts

## Goal
Let external MCP clients PULL grounding context (resources) and use reusable research
templates (prompts) — on top of the unified registry (RA-4) + contract catalog (RA-5).

## What shipped
- `src/lib/ai/mcpResources.ts` (+ unit tests) — 4 RESOURCES + 4 PROMPTS, pure/data-driven:
  - resources: `citrate://overview`, `citrate://contracts` (catalog as a markdown table),
    `citrate://addresses` (canonical address book JSON), `citrate://index-schema` (what
    the index can answer). Read from the RA-5 catalog + address map.
  - prompts: `audit_address`, `trace_token`, `explain_finality`, `summarize_contract` —
    expand (with args) into a first user turn that drives the tools.
- `/api/mcp`: added `resources/list`, `resources/read`, `prompts/list`, `prompts/get`;
  `initialize` + GET now advertise `resources` + `prompts` capabilities.

## Verification
- MCP route + resource unit tests pass; full suite 167→173 green; typecheck clean.
- Pure MCP-server feature — the in-app chat agent is unaffected (no eval needed).

## Log
- **2026-06-09** — Built resources + prompts module, wired the 4 RPC methods + capability
  advertisement. Suite green. Deploying.
