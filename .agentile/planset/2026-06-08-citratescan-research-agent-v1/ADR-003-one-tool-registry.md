---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: ACCEPTED
---

# ADR-003: One shared tool registry for the chat agent and the MCP server

| Field | Value |
|-------|-------|
| **ADR Number** | ADR-003 |
| **Date** | 2026-06-08 |
| **Status** | ACCEPTED |
| **Author** | Larry Klosowski (saul) |
| **Sprint** | RA-4 (chat) + RA-7 (MCP) |

## Context

The same read-only operations are exposed twice, by two hand-maintained lists:

- `src/lib/ai/tools.ts` — 19 tools, AI-SDK `tool()` wrappers, zod schemas, `audited()`.
- `src/app/api/mcp/route.ts` — 18 tools, hand-written JSON-Schema + `run()`, no audit.

They already disagree (MCP omits `ledger`) and validate inputs differently (zod vs
manual `reqAddr`/`reqHash`). As we add ~8 research tools (RA-4), maintaining two lists
guarantees drift: a tool fixed or added in one surface silently lags in the other.

## Decision

**We will define each tool once in a shared registry — name, description, input
schema (zod), data-source tag, and `execute` — and generate both the AI-SDK tool map
(for `/api/chat`) and the MCP JSON-Schema tool list (for `/api/mcp`) from it.** zod
schemas convert to JSON Schema for MCP; auditing is applied uniformly at the registry
boundary.

## Rationale

- One definition → no drift; a new research tool lights up in chat and MCP at once.
- zod is already the chat validator; JSON Schema is derivable from it (no second
  hand-written schema).
- A single boundary is the natural place to enforce X-2 (data-source tag) and uniform
  auditing — including for MCP, which has none today.

### Alternatives considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| Keep two lists, add a lint that diffs them | Minimal refactor | Still two sources; lint catches drift after the fact | Treats the symptom, not the cause |
| MCP imports the AI-SDK tool objects directly | Reuses zod | AI-SDK `tool()` shape isn't a clean MCP source; couples MCP to the chat SDK | Leaky; awkward schema extraction |
| **Shared registry, generate both (chosen)** | Single source; uniform audit + data-source tag; clean | One-time refactor of both call sites | **Selected** |

## Consequences

### Positive
- Research tools (RA-4) are defined once; chat + MCP stay in lockstep.
- MCP gains uniform auditing and data-source tagging for free.
- Easier to enumerate the tool surface for the LoRA training corpus (RA-8).

### Negative
- One-time refactor of `tools.ts` and `mcp/route.ts` onto the registry (mitigated:
  behavior-preserving; covered by existing MCP route tests + new registry tests).

### Neutral
- `ledger` (pure compute) can be tagged registry-side as chat-only or exposed to MCP —
  a per-tool flag, decided when the registry lands.

## Affected components

| Component | Impact |
|-----------|--------|
| `src/lib/ai/tools.ts` | Becomes a thin adapter over the shared registry |
| `src/app/api/mcp/route.ts` | Generates its tool list + dispatch from the registry |
| new `src/lib/ai/registry.ts` (or similar) | The single source of tool truth |

## Compliance check
- [x] Consistent with CONFIG.md
- [x] Doesn't violate CORE_RULES.md (Rule 11: data-source tag enforced at the boundary)
- [ ] If consensus change: TLA+ spec — N/A
- [x] Rule-12 frontmatter present

## References
- PLANSET.md — X-1, RA-4, RA-7
- EVALUATION.md G-3

## Revision history
| Date | Author | Change |
|------|--------|--------|
| 2026-06-08 | saul | Initial proposal + accepted (planning) |
