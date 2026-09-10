---
created: 2026-06-09T08:27:00Z
branch: feat/RA-4-shared-tool-registry
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-4
status: active
---

# Sprint RA-4: One shared tool registry (chat + MCP)

> Decision: [`../../../planset/2026-06-08-citratescan-research-agent-v1/ADR-003-one-tool-registry.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/ADR-003-one-tool-registry.md).

## Goal
Kill the chat-vs-MCP tool drift — define each tool once, generate both surfaces.

## What shipped
**Implementation choice (lower-risk variant of ADR-003):** rather than introduce a new
`registry.ts` and refactor the working 94% chat path, the existing `citrateTools()` IS
the single source, and `/api/mcp` is **generated from it**:
- `tools/list` → `name` + `description` + `z.toJSONSchema(inputSchema)` (zod 4 built-in;
  no new dependency). Verified `toJSONSchema` works for all 20 tools.
- `tools/call` → looks the tool up in `citrateTools()`, validates args with the SAME
  zod schema (`safeParse` → `-32602 Invalid params` with the field issues in `error.data`),
  and calls the tool's `execute`.
- MCP tool calls are now **audited** under the API-key identity (`mcp:key:<id>`) —
  the old hand-written path had no auditing.

**Result:** the old hand-maintained MCP list (18 tools, missing `findTransfers` /
its token support / `ledger`) is gone. MCP now exposes the **same 20 tools** as the
agent, automatically — no drift possible. Removed ~230 lines of duplicated registry +
hand validators (`reqAddr`/`reqHash`/`clampLimit`/`RpcError`).

## Verification
- MCP route tests updated (18→20; validation detail now in `error.data`) — 11/11 pass.
- Full suite 156→161 green (0 failures); typecheck clean.
- Chat path untouched (zero risk to the 94% baseline).

## Log
- **2026-06-09** — Made `citrateTools()` the single source; `/api/mcp` generated from it
  via `z.toJSONSchema`. MCP 18→20 tools, gained zod validation + auditing. Suite green.
