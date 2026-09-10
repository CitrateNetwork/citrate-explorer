---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-3
status: planned
---

# Sprint RA-3: Full indexed value/transfer backbone

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `RA-3` |
| **Sprint Name** | Full indexed value/transfer backbone |
| **Goal** | Make native SALT value AND decoded ERC-20/721/1155 transfers fully indexed and queryable by amount, time, token, counterparty, and direction — reorg-safe and reconciled against live RPC. |
| **Branch** | `feat/RA-3-value-transfer-backbone` (cut at kickoff) |
| **Start Date** | TBD (kickoff, after RA-2) |
| **End Date (target)** | +4–5 days from kickoff |
| **Status** | `PLANNED` |
| **Planset** | [`../PLANSET.md`](../PLANSET.md) |
| **Predecessors** | RA-1 (eval), RA-2 (native slice) |

## Why this sprint

RA-2 proved the loop on native SALT in a bounded window. RA-3 builds the real
foundation everything else stands on: index-time decoding of token transfers into the
(currently empty) `token_transfers` table, populated `tokens` + `accounts` rollups,
value/amount + time indexes across both native and token movements, and full
historical backfill. Without this, the research tool suite (RA-4), rich lists, and
value-flow tracing are impossible, and native-vs-token disambiguation (X-3) can't be
enforced at the data layer. Decision of record: [`../ADR-002-value-transfer-backbone.md`](../ADR-002-value-transfer-backbone.md).

## Deliverables

- Migrations finalizing `token_transfers`, `tokens`, `accounts`, and the value/amount +
  time indexes (generalizing RA-2's native index).
- Indexer changes (`src/lib/indexer/ingest.ts`): decode `Transfer(address,address,uint256)`,
  `TransferSingle`/`TransferBatch` (ERC-1155), populate transfer rows + token metadata
  (lazy `name`/`symbol`/`decimals`/`standard` reads, cached in `tokens`) + account
  rollups; reorg-safe via `superseded`/`finalized` (X-4).
- Backfill tooling: forward-fill from the tip + batched historical backfill with a
  resumable cursor; a reconciliation report (indexed transfer count vs RPC `getLogs`).
- Repository query methods (`src/lib/indexer/repository.ts`): unified
  `findTransfers` (native + token), `tokenActivity`, `richList`/`holderBalances`,
  `counterpartyFlows`.
- Live-RPC reconciliation tests + golden items un-tagged for the token-transfer class.

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (RA-2 close count) | RA-2 closing commit | `npx vitest run --reporter=json 2>/dev/null \| jq '.numTotalTests'` |
| **Formal specs** | 1 | RA-2 close | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | 6 | RA-2 close | `ls scripts/semgrep/*.yaml \| wc -l` |
| **Agent eval (value+token class)** | native passing; token ~0% | RA-2 `canonical.json` | `./scripts/eval/benchmark_harness.sh` |

## Method

FEATURE. Per WP: `.feature` → RED (reconciliation test fails) → GREEN → refactor →
re-run harness. Reconciliation is the core discipline: every indexed aggregate is
cross-checked against live RPC ground truth (Rule 11). A new **tripwire** is added so a
future change that double-counts across `superseded` blocks is caught in CI (raises the
tripwire ratchet).

## Work Packages

### WP-3.1: Schema + indexes (finalize token_transfers / tokens / accounts)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | RED → GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Migrations to: add value/amount range indexes to `transactions` (generalize
RA-2) and to `token_transfers`; confirm/extend `token_transfers` columns
(`token, from, to, value, tokenId, standard, logIndex, txHash, blockHash, blockHeight,
finalized`); `tokens` (`address, standard, name, symbol, decimals, totalSupply,
firstSeen`); `accounts` (`address, isContract, txCount, firstSeen, lastSeen` and
balance rollup strategy). Decide native value comparison representation once (carry
RA-2's choice).

**Acceptance Criteria** *(Rule 11)*
- [ ] Migration applies cleanly on a fresh DB and is idempotent; verified by
      `db:migrate` in a test DB. Data source = Drizzle migration + schema.
- [ ] Range/order queries on `value` and `token_transfers.value` are correct for 256-bit
      magnitudes (boundary test).
- [ ] `token_transfers` rows are uniquely keyed `(txHash, logIndex)` and carry
      `blockHash` so reorg cleanup is possible.

**Tests added:** `schema_backbone.test` — migration idempotency + index presence +
256-bit boundary.

---

### WP-3.2: Index-time transfer decoding (ERC-20/721/1155)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | RED → GREEN |
| **Estimated effort** | L |
| **Commit(s)** | — |

**Scope:** In `ingestBlock`, after logs are ingested, decode transfer events into
`token_transfers`: ERC-20/721 `Transfer` (topic0 = keccak `Transfer(address,address,uint256)`),
distinguishing ERC-721 (3 indexed topics → `tokenId`) from ERC-20 (2 topics + data →
`value`); ERC-1155 `TransferSingle`/`TransferBatch`. Lazily resolve + cache token
metadata in `tokens` (read `decimals`/`symbol`/`standard`; honest null on
non-conforming). Reuse the existing decode logic in `synthesis/explainTransaction.ts`
as the shared decoder (refactor it to be callable at index-time — kills duplication and
fixes the pre-existing test noted in EVALUATION.md).

**Acceptance Criteria** *(Rule 11)*
- [ ] For a block known to contain ERC-20 transfers, the indexed `token_transfers` rows
      exactly match decoding the same logs via live RPC. Data source = `logs`/RPC
      reconciliation.
- [ ] ERC-721 vs ERC-20 vs ERC-1155 are classified correctly and carry `standard` +
      `tokenId`/`value` appropriately (X-3).
- [ ] Token metadata is read once and cached; missing/non-standard tokens store an
      honest `decimals: null` (never a fabricated 18).

**Tests added:** `transfer_decode.test` — ERC-20/721/1155 classification + value/tokenId
extraction against fixture logs; the previously-failing
`explainTransaction` ERC-20 case now passes via the shared decoder.

---

### WP-3.3: Reorg-safe rollups + accounts/tokens population

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN → adversarial |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Maintain `accounts` (txCount, first/last seen, isContract) and rich-list
inputs and `tokens` rollups as blocks ingest. On reorg, when a block is marked
`superseded`, its `token_transfers` and rollup contributions are removed/recomputed so
no double counting (X-4). Add a CI tripwire (semgrep or a check script) asserting
transfer aggregation always filters on canonical (`superseded = false`) blocks.

**Acceptance Criteria** *(Rule 11)*
- [ ] A simulated reorg (block superseded then replaced) leaves transfer counts and
      rollups consistent with the canonical set; verified by a reorg reconciliation
      test. Data source = `blocks.superseded` + `token_transfers`.
- [ ] Rich-list / holder rollups match a from-scratch recompute over canonical blocks
      (no drift). Data source = recompute vs incremental.
- [ ] A tripwire rejects aggregation code paths that don't filter `superseded`
      (raises the tripwire ratchet).

**Tests added:** `reorg_rollup.test` — supersede/replace consistency; `richlist_recompute.test`.

---

### WP-3.4: Backfill + reconciliation report

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** A resumable backfill (forward-fill from tip + batched historical) writing
transfers/rollups for the existing block range, with a cursor in `indexerState`. Emit a
reconciliation report: for sampled ranges, indexed transfer count vs live `getLogs`
count; flag gaps. Runs on the indexer worker (D-2).

**Acceptance Criteria** *(Rule 11)*
- [ ] After backfill, sampled ranges reconcile 100% (indexed == RPC `getLogs`
      decodable transfers). Data source = reconciliation report.
- [ ] Backfill is resumable (kill + restart continues from the cursor) and bounded
      (batch size + rate limited); no unbounded memory.
- [ ] Gaps are reported, not hidden (no silent truncation — X-2).

**Tests added:** `backfill_resume.test` — cursor resume; `reconcile.test` (live-RPC gated).

---

### WP-3.5: Unified repository queries

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN → REFACTOR |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Repository methods the RA-4 tools wrap: `findTransfers` (native + token via
a `token?` param; amount range, time window, counterparty, direction, with
`coverageWindow`/`truncated`), `tokenActivity(token, window)`, `richList(token?, limit)`
(native uses balances; token uses transfer rollups), `counterpartyFlows(address)`.
Promote RA-2's native `findTransfers` into this unified method (interface stable).

**Acceptance Criteria** *(Rule 11)*
- [ ] `findTransfers({token, minAmount, since, until})` returns correct native OR token
      results, each labeled with token identity `{address, symbol, decimals, standard}`
      or native SALT (X-3). Data source = `transactions` / `token_transfers`.
- [ ] `richList` matches a recompute; `tokenActivity` matches RPC for a sample window.
- [ ] All methods report coverage + truncation honestly.

**Tests added:** `repository_queries.test` — native+token findTransfers, richList,
tokenActivity correctness vs ground truth.

---

### WP-3.6: Golden items + benchmark delta (token class)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | measure |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** Un-tag the token-transfer + rich-list golden items, regenerate ground truth,
run the RA-1 harness, record the delta in the sprint REPORT, refresh `canonical.json`.

**Acceptance Criteria** *(Rule 11)*
- [ ] Token-transfer + rich-list classes move to ≥ 85% accuracy; native stays ≥ RA-2.
      Data source = RA-1 scorers vs live-RPC ground truth.
- [ ] Transfer-index completeness metric = 100% on sampled ranges (reconciliation).

**Tests added:** golden items (harness-scored).

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| Indexer worker running (D-2) | Confirm | backfill (WP-3.4) can't complete; forward-fill still works |
| Neon capacity for backfill | Available | throttle batch size if pressured |
| RA-2 native index + resolvers | Built in RA-2 | generalized here |
| Shared decoder from `explainTransaction.ts` | In-repo | refactored in WP-3.2 |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Reorg double-counting | Med | High | `superseded` filtering + tripwire + reorg test (WP-3.3) |
| Non-standard tokens (missing decimals/symbol) | High | Med | Honest null metadata; never fabricate decimals; tool surfaces "unknown decimals" |
| Backfill cost/time over full history | Med | Med | Forward-fill first; batched/resumable; report progress; cap per-query scans |
| Decoder edge cases (proxy tokens, non-standard Transfer sigs) | Med | Med | Reconcile vs RPC; log undecodable; don't drop silently |
| 256-bit value comparison correctness | Med | High | Generated numeric/bytea column + boundary tests (carried from RA-2) |

## Notes

- WP-3.2 deliberately unifies the read-time decoder (`explainTransaction.ts`) with the
  index-time decoder — one decode path, and it resolves the pre-existing failing test
  flagged in EVALUATION.md.
- This sprint adds a CI tripwire (WP-3.3), raising the tripwire ratchet from 6 → 7.
- After RA-3, RA-4 tools become thin wrappers over WP-3.5; most of RA-4's effort is
  schema/zod/prompt + the shared registry (ADR-003), not new query logic.
