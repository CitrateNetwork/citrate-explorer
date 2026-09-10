---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: ACCEPTED
---

# ADR-002: Index native value and decode token transfers into a queryable backbone

| Field | Value |
|-------|-------|
| **ADR Number** | ADR-002 |
| **Date** | 2026-06-08 |
| **Status** | ACCEPTED |
| **Author** | Larry Klosowski (saul) |
| **Sprint** | RA-3 (sliced in RA-2) |

## Context

The agent cannot answer hash-free value questions (*"when was 30,000 SALT sent and by
whom?"*) because the data layer can't be queried by value. Specifically
(`src/lib/db/schema.ts`, `src/lib/indexer/ingest.ts`):

- `transactions.value` (native SALT, in grains) is indexed by `from`/`to`/`block`/
  `timestamp`, but **not by value** — no amount-range query.
- The `token_transfers` table exists in the schema but is **never populated**; the
  indexer ingests raw `logs` only and ERC-20/721 decode happens at read-time in
  `explainTransaction`.
- `tokens` (metadata/decimals/standard) and `accounts` (balances/rich-list) are also
  unpopulated.

So historical, amount-based, token-aware investigation is impossible. This is the
foundation the research tool suite (RA-4) needs.

## Decision

**We will extend the indexer to decode token Transfer events into `token_transfers`,
populate `tokens` and `accounts` rollups, and add value/amount + time indexes so both
native SALT (`transactions.value`) and token transfers are queryable by amount range,
time window, token, counterparty, and direction — with native vs token always
distinguished and token identity always carried.**

Reorg-safe by construction: transfers and rollups are keyed to canonical blocks and
respect the existing `superseded`/`finalized` flags (X-4) so a DAG reorg never
double-counts. Reads serve from Neon with live-RPC fallthrough + async backfill (X-5).

## Rationale

- The `token_transfers` schema was always intended ("S-2 pending"); this finishes it.
- Decode at index-time (once) instead of read-time (every query) — required for
  amount/aggregate queries that can't scan the chain live per request.
- A value/amount index turns *"≥ 30k SALT"* from an impossible full-scan into a
  bounded indexed lookup.
- Carrying `{token, symbol, decimals, standard}` on every transfer row makes X-3
  (native-vs-token disambiguation) enforceable at the data layer, not just in prose.

### Alternatives considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| Live-RPC scan + in-memory filter only | No schema/indexer change | Fails for history; slow; bounded windows; can't aggregate | Doesn't answer the headline question |
| Decode transfers at read-time (status quo) | Already exists | No aggregate/range query; re-decodes every call | Can't support amount/time/holder queries |
| External indexer service (e.g., a subgraph) | Offloads work | New infra dependency; off-stack; less control | Heavier than extending the indexer we own |
| **Index-time decode + value/time indexes (chosen)** | Enables all RA-4 queries; reorg-safe; one decode | Backfill cost; migration work | **Selected** |

## Consequences

### Positive
- Hash-free value/token/holder/time queries become correct and fast.
- Rich lists, token leaderboards, and value-flow tracing become possible (RA-4).
- Token identity is first-class everywhere (X-3).

### Negative
- Historical backfill is heavy (mitigated: forward-fill first per RA-2; batch backfill
  off-peak; cap+report per-query scans — no silent truncation).
- More indexer surface to keep reorg-correct (mitigated: key to canonical blocks;
  reconciliation test vs RPC `getLogs` ground truth; respect `superseded`).
- Index/storage growth (mitigated: targeted indexes; prune to retention policy if needed).

### Neutral
- ERC-1155 (`TransferSingle`/`TransferBatch`) included for completeness even if rare today.

## Affected components

| Component | Impact |
|-----------|--------|
| `src/lib/db/schema.ts` + migrations | New indexes on `transactions.value`/time; finalize `token_transfers`, `tokens`, `accounts` |
| `src/lib/indexer/ingest.ts` | Decode Transfer/TransferSingle/TransferBatch → rows; populate token/account rollups |
| `src/lib/indexer/repository.ts` | Query methods: amount range, time window, token, counterparty, direction |
| `src/lib/ai/tools.ts` (+ shared registry) | RA-4 tools consume these queries |

## Compliance check
- [x] Consistent with CONFIG.md (SALT grains, blue_score ordering)
- [x] Doesn't violate CORE_RULES.md (Rule 11: every query names its table/index; reconciliation vs RPC)
- [ ] If consensus change: TLA+ spec — N/A
- [x] Rule-12 frontmatter present

## References
- PLANSET.md — RA-2, RA-3, X-3, X-4, X-5
- EVALUATION.md G-1, G-5
- `src/lib/db/schema.ts` (existing `token_transfers`/`tokens`/`accounts` definitions)

## Revision history
| Date | Author | Change |
|------|--------|--------|
| 2026-06-08 | saul | Initial proposal + accepted (planning) |
