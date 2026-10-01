---
created: 2026-10-01
branch: hup/n4-mem-scan-mcp
author: Larry Klosowski + Claude Opus 5.5
sprint: HUP-S4.3 (citrate-core Hermes upskill) / federation F-6
status: active
---

# Verified source for agents, and the annotation we never sent

## What changed

- `getVerifiedSource` is a new read-only tool in the shared registry (`src/lib/ai/tools.ts`),
  so it reaches the in-app agent and `/api/mcp` at once (ADR-003, one registry).
- `GET /api/contract/[addr]/source` is the lean REST form of the same lookup: no RPC, no
  bytecode, just the recorded match. citrate-core's `get_verified_source` agent tool calls it.
- Both are built on `src/lib/verify/verifiedSource.ts`, which goes through
  `verificationBadge()` so a partial match is never reported as verified.
- Every tool in `tools/list` (and the GET discovery manifest) now carries MCP annotations:
  `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

## The non-obvious part

Wiring CitrateScan into Hermes's MCP host showed that our MCP server never sent tool
annotations. The spec defaults an unannotated tool to "may write, may destroy", and
citrate-agent-runtime's host follows the spec: it offers only read-only-annotated tools unless
a server is explicitly allowed to write. So every CitrateScan tool would have been skipped, and
Hermes would have connected to the explorer and seen nothing. The server was read-only by
construction, but it never said so on the wire.

## Honest statuses

The lookup separates "unverified" (no passing record) from "unavailable" (the Neon store is
not provisioned or the read failed). The older contract route folds both into "unverified";
an agent deciding whether to trust a contract needs to know which one it is.

## Not done

- The compiler settings (optimizer runs, EVM version) are not stored in
  `contract_verifications`, so the lookup returns the compiler version and source hash only.
- No deploy: production picks this up with the next explorer release.
