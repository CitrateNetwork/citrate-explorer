---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-2
status: planned
---

# Sprint S-2: Core explorer pages

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-2` |
| **Sprint Name** | Core explorer pages |
| **Goal** | A user browses real blocks/tx/address/contract/token pages over the indexer, with decoded logs, internal txns, state diffs, gas breakdown, plain-English summaries, and omni-search. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-06-16 (target) |
| **End Date (target)** | 2026-07-01 |
| **Status** | `IN PROGRESS` placeholder → set at kickoff |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | S-1 (indexer + harness; closing commit recorded at kickoff) |

## Why this sprint

S-1 produced the index; S-2 makes it visible. These are the pages every Ethereum
dev reflexively reaches for — but rendered for a DAG: a block page shows its
selected parent **and** merge parents and a finality badge by blue-score depth;
a "latest blocks" list orders by `blue_score`, not height. S-2 must precede the
DAG viz (S-3) because the viz click→detail panel reuses these detail components
and APIs — building viz first would force stubbed panels (Rule 2 violation).

## Deliverables

- `app/blocks/page.tsx` + `app/blocks/[id]/page.tsx` — list + block detail
- `app/tx/[hash]/page.tsx` — transaction detail (decoded)
- `app/address/[addr]/page.tsx` — address overview + activity
- `app/contract/[addr]/page.tsx` — contract overview (verify/read/write tabs land in S-4/S-5)
- `app/token/[addr]/page.tsx` — token detail + transfers
- `app/api/blocks/route.ts` + `app/api/blocks/[id]/route.ts`
- `app/api/tx/[hash]/route.ts`, `app/api/address/[addr]/route.ts`, `app/api/contract/[addr]/route.ts`
- `app/api/search/route.ts` — omni-search
- `lib/decode/` — log/event decoding, internal-txn tracing, state-diff, gas breakdown
- `lib/ai/synthesis/{explainContract,diagnoseFailure}.ts` + indexer search tools (`searchTransactions, addressActivity, topHolders, tokenTransfers, indexAddress, semanticSearch`)
- Token decoding populates `tokens, token_transfers` in Neon

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (S-1 close count) | at kickoff | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | (S-1 close count) | at kickoff | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | (S-1 close count) | at kickoff | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (S-1 close fraction) | at kickoff | see `coverage/GATES.md` |

## Method

Per WP: BDD/Gherkin → failing test + tripwire → code → refactor → adversarial →
journal. No TLA+ WPs (read/render only; the state machine lives in S-1's indexer).

## Work Packages

### WP-2.1: Blocks list + block detail page

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/blocks` list ordered by `blue_score`; `/blocks/[id]` accepts hash OR
height OR blue_score and renders header fields, tx list, gas used/limit, base
fee, **selected parent + merge parents**, and a finality badge. `/api/blocks*`
serve from Neon, fall through to live RPC (X-1). Does NOT render the DAG graphic
(S-3).

**Acceptance Criteria** *(Rule 11)*

- [ ] `/blocks` lists the latest 50 blocks ordered by `blue_score DESC`; order matches `citrate_getDagStats` tip set at load (data source = `blocks` table / live RPC fall-through).
- [ ] Block detail shows `selected_parent_hash` as a link AND every `merge_parent_hashes[]` entry as links (data source = `dag_edges` / live header) — merge parents are not dropped.
- [ ] Finality badge reads "Final" iff `maxBlueScore - blue_score >= 100`, else shows depth-to-finality (data source = computed from `blocks` + live `citrate_getDagStats`).
- [ ] Requesting a not-yet-indexed tip block renders live data and triggers async backfill (data source = live RPC, then `blocks` on refresh).
- [ ] Gas shows `gas_used / gas_limit` with `gas_limit == 30,000,000` and base fee in grains+SALT (data source = `blocks`).

**Tests added:** `blocks.order.test.ts`, `block.mergeparents.test.ts`, `block.finality.test.ts`, `block.fallthrough.live.test.ts`.

---

### WP-2.2: Transaction detail (decoded)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/tx/[hash]` — from/to/value (dual-unit), status, gas used/price/fee,
nonce, input data with method decoding (4byte/ABI when verified), decoded event
logs, internal transactions (trace), state diff, and a plain-English
`explainTransaction` summary. `/api/tx/[hash]` serves from `transactions +
receipts + logs`. Does NOT cover failed-tx diagnosis depth beyond `diagnoseFailure`.

**Acceptance Criteria** *(Rule 11)*

- [ ] Tx page renders to/from/value/status/gasUsed exactly matching `eth_getTransactionReceipt` for a real tx (data source = `receipts` / live RPC diff).
- [ ] Event logs are decoded against the ABI when the contract is verified, else shown as raw topics+data (data source = `logs` + `contract_verifications` ABI).
- [ ] Internal transactions are listed from a trace (`debug_traceTransaction` or receipt-derived) for a tx with internal calls (data source = live trace RPC) — not fabricated.
- [ ] A failed tx shows a `diagnoseFailure` reason derived from the revert data / trace, not a generic "failed" (data source = live trace / revert reason).
- [ ] Value displayed dual-unit (SALT + grains) per X-4 (data source = `transactions.value`).

**Tests added:** `tx.receipt.live.test.ts`, `tx.logdecode.test.ts`, `tx.internal.live.test.ts`, `tx.diagnose.live.test.ts`.

---

### WP-2.3: Address overview + activity

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/address/[addr]` — balance (dual-unit), tx count, is-contract flag,
paginated tx history (sent/received), token transfers, first/last-seen. Backed by
indexer tools `addressActivity`, `tokenTransfers`, `indexAddress` (on-demand index
of a cold address). `/api/address/[addr]` from Neon. Does NOT include analytics
charts.

**Acceptance Criteria** *(Rule 11)*

- [ ] Balance equals live `eth_getBalance(addr)` at the displayed block, shown dual-unit (data source = live RPC + `accounts`).
- [ ] `isContract` badge derives from `eth_getCode !== '0x'` (X-5) (data source = live `eth_getCode`).
- [ ] Tx history paginates by `blue_score` cursor and matches indexed `transactions` for the address; a never-indexed address triggers `indexAddress` on-demand and then renders real history (data source = `transactions` / on-demand backfill).
- [ ] Token transfers list matches `token_transfers` for the address (data source = `token_transfers`).

**Tests added:** `address.balance.live.test.ts`, `address.iscontract.live.test.ts`, `address.history.cursor.test.ts`, `address.ondemand.live.test.ts`.

---

### WP-2.4: Contract overview + token page + decoding

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/contract/[addr]` overview (bytecode size, creation tx, verified
status placeholder for S-4 tabs); `/token/[addr]` token detail + transfers; token
detection/decoding (ERC-20/721/1155) populating `tokens` + `token_transfers` from
`logs`. `explainContract` synthesis. Does NOT include the verify/read/write tabs
(S-4/S-5).

**Acceptance Criteria** *(Rule 11)*

- [ ] Contract page shows creation tx + deployer + code size from `eth_getCode` and the creation receipt (data source = live RPC + `contracts`).
- [ ] Token page shows name/symbol/decimals/totalSupply read via `eth_call` and indexed `tokens` (data source = live `eth_call` + `tokens`).
- [ ] Token transfers list is built by decoding `Transfer` logs from `logs`; count matches a live `eth_getLogs` for the token over a window (data source = `token_transfers` vs live `eth_getLogs` diff).
- [ ] `explainContract(addr)` summary references only real contract metadata (ABI/standard/owner) present in tool results (data source = `contracts` + live calls).

**Tests added:** `contract.overview.live.test.ts`, `token.meta.live.test.ts`, `token.transfers.diff.live.test.ts`, `explaincontract.test.ts`.

---

### WP-2.5: Omni-search (`/api/search`)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/api/search?q=` — classify input (block hash/height/blue_score, tx
hash, address, ENS-like label, token symbol) and route to the right page; semantic
fallback via `semanticSearch` (`citrate_semanticSearch` / embedded index). Does NOT
cover natural-language Q&A (that's `/api/chat`, S-1).

**Acceptance Criteria** *(Rule 11)*

- [ ] A 32-byte hash resolves to the correct block OR tx (disambiguated by lookup), an address resolves to the address page, an integer resolves by blue_score then height (data source = `blocks`/`transactions` lookups).
- [ ] A token symbol resolves to its token page when indexed (data source = `tokens`).
- [ ] A free-text query returns ranked results via `semanticSearch`, each result a real indexed entity (data source = `citrate_semanticSearch` / embedded index over Neon) — no fabricated results.

**Tests added:** `search.classify.test.ts`, `search.hash.live.test.ts`, `search.semantic.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| S-1 indexer + schema | Required | All pages read from S-1 tables |
| S-1 harness tools | Required | Detail synthesis reuses harness |
| Live trace RPC (`debug_traceTransaction`) | Verify availability | Blocks WP-2.2 internal txns / diagnose |
| `citrate_semanticSearch` / embeddings | Verify availability | Blocks WP-2.5 semantic fallback (keyword still works) |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Trace RPC unavailable on Citrate node | Med | Med | Degrade internal-txn view to receipt-derived; name the limitation; revisit when node exposes `debug_*` |
| Cold-address on-demand indexing is slow | Med | Low | `indexAddress` async with progress state; never block render on full backfill |
| Latest-blocks list ordered by height (linear bug) | Med | High | WP-2.1 AC asserts blue_score ordering vs live tip set |

## Notes

The DAG-native deltas a linear-explorer plan would miss, made concrete here:
block pages show **both** parent kinds; finality is a computed badge, not a
confirmation count; lists order by `blue_score`. Journal any place the
"confirmations" mental model tried to creep back in.

## Definition of Done

- All five core entity pages render real, decoded data from the S-1 index with live-RPC fall-through; every AC traces to a named source (Rule 11), 0 mocks (Rule 2).
- Block pages render selected parent + merge parents + finality badge; lists order by `blue_score`.
- Token detection populates `tokens` + `token_transfers`; transfer counts diff-match live `eth_getLogs`.
- Omni-search routes hashes/addresses/integers/symbols correctly with semantic fallback.
- `explainTransaction` / `explainContract` / `diagnoseFailure` produce grounded summaries (no field absent from tool results).
- Four ratchets non-decreasing at close; `RETRO.md` + journal committed; S-3 kicked off.
