---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-2
status: planned
---

# Sprint RA-2: Thin vertical slice — hash-free SALT value query

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `RA-2` |
| **Sprint Name** | Thin vertical slice — hash-free SALT value query |
| **Goal** | Make the agent answer *"when was 30,000 SALT sent and by whom?"* (and its class) without a tx hash, and show the RA-1 benchmark move from failing to passing on the value-query class. |
| **Branch** | `feat/RA-2-value-query-slice` (cut at kickoff) |
| **Start Date** | TBD (kickoff, after RA-1) |
| **End Date (target)** | +2 days from kickoff |
| **Status** | `PLANNED` |
| **Planset** | [`../PLANSET.md`](../PLANSET.md) |
| **Predecessors** | RA-1 (eval harness) |

## Why this sprint

RA-2 proves the eval loop produces *real* improvement before we commit to the full
backbone build (RA-3). It is deliberately the thinnest path that answers the headline
question the owner raised — *"when was 30k SALT sent?"* — end to end: a minimal native
value index path, one query tool, two resolvers (amount + time), and the golden items
that score it. If the RA-1 number moves on this slice, the eval signal is trustworthy
and RA-3 is de-risked. If it doesn't, we fix the harness before building more.

Scope discipline: **native SALT only** in this slice (`transactions.value`). ERC-20/721
token transfers and the full historical backbone are RA-3. We index *forward from the
tip* plus a bounded backfill window sufficient to contain the golden items — not all
history. This keeps the slice small while still being honest (X-2: the tool reports its
coverage window; no silent truncation).

## Deliverables

- A migration adding a value/amount + time index path for native `transactions.value`
  (the minimal index that turns "≥ N SALT in window" into a bounded indexed lookup).
- `findNativeTransfers(...)` query method in `src/lib/indexer/repository.ts`
  (amount range + time window + optional counterparty/direction), with an explicit
  `coverageWindow` in its result.
- One agent tool `findTransfers` (native-only in this slice) in the tool layer, with a
  zod schema, audit, and data-source tag (X-2).
- Two resolvers: `resolveAmount` ("30k SALT", "30,000 SALT", "0.5 SALT" → grains) and
  `resolveTimeRange` ("last week", "yesterday", ISO dates → block/`blue_score` range).
- A `.feature` BDD scenario for the value query + RED/GREEN tests.
- New RA-1 golden items for the value-query class (un-tagged from `blocked_until` for
  the native-SALT subset), and a recorded benchmark delta.

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (RA-1 close count) | RA-1 closing commit | `npx vitest run --reporter=json 2>/dev/null \| jq '.numTotalTests'` |
| **Formal specs** | 1 | RA-1 close | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | 6 | RA-1 close | `ls scripts/semgrep/*.yaml \| wc -l` |
| **Agent eval (value-query class accuracy)** | ~0% (baseline) | RA-1 `canonical.json` | `./scripts/eval/benchmark_harness.sh` |

## Method

FEATURE, BDD-led. Per WP: `.feature` scenario → RED test → GREEN implementation →
refactor → re-run the RA-1 harness and record the delta. Ground truth for the new
golden items is generated from live RPC (Rule 11). No TLA+ (no consensus change; the
index is derived data reconciled against RPC).

## Work Packages

### WP-2.1: Amount + time resolvers

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | BDD → RED → GREEN |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** Pure functions that turn human phrasings into machine ranges.
`resolveAmount(text, decimals=18)` → grains (bigint), handling `k`/`m` suffixes,
commas, and decimals; honest error on ambiguous/unparseable input. `resolveTimeRange(text)`
→ `{fromBlock, toBlock}` (or `{fromBlueScore,…}`) via the blocks table timestamps,
handling relative ("last week", "yesterday", "last 24h") and absolute (ISO) inputs.

**Acceptance Criteria** *(Rule 11)*
- [ ] `resolveAmount("30k SALT")` → `30000n * 10n**18n` grains; covered by unit tests.
      Data source = pure function (no IO).
- [ ] `resolveTimeRange("last week")` → a block range derived from `blocks.timestamp`
      (real indexed timestamps), not a hardcoded guess. Data source = `blocks` table.
- [ ] Both return an honest, typed error on unparseable input (no silent default).

**Tests added:** `resolvers.test` — amount parsing matrix; time-range mapping against a
seeded `blocks` fixture.

---

### WP-2.2: Native value index + repository query

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | RED → GREEN |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** Add the minimal index supporting `WHERE value >= ? AND timestamp BETWEEN ? AND ?`
(and optional `from`/`to`). Because `transactions.value` is stored as text (grains),
add a query-able numeric/bytea representation or a generated indexed column so range
comparison is correct for 256-bit values (decided in this WP; documented in the
migration). Implement `findNativeTransfers({minGrains, maxGrains?, fromBlock, toBlock,
counterparty?, direction?, limit})` returning rows + an explicit `coverageWindow` and a
`truncated` flag.

**Acceptance Criteria** *(Rule 11)*
- [ ] A range query over native value returns the correct set vs a live-RPC
      cross-check on a seeded range. Data source = `transactions` table reconciled
      against `eth_getBlockByNumber` value sums.
- [ ] 256-bit values compare correctly (e.g., 30,000 SALT vs 3,000 SALT vs 300,000 SALT
      ordering holds; no lexical-text comparison bug). Covered by a boundary test.
- [ ] Result always carries `coverageWindow` + `truncated` (X-2: no silent truncation).

**Tests added:** `findNativeTransfers.test` — range correctness, 256-bit boundary,
coverage-window reporting (live-RPC gated for the reconciliation case).

---

### WP-2.3: `findTransfers` tool (native slice) + system-prompt note

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | GREEN → REFACTOR |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** Expose `findTransfers` as an agent tool (native SALT only this sprint),
zod-validated, audited, data-source-tagged. It accepts natural parameters
(`amount`, `comparator`, `since`, `until`, `address?`, `direction?`) and internally
calls the resolvers + `findNativeTransfers`. Add a one-line capability note to the
system prompt so the model knows it can answer value questions now. (Registry refactor
is RA-4; here it's added in the existing `tools.ts` shape.)

**Acceptance Criteria** *(Rule 11)*
- [ ] The tool answers *"when was 30k SALT sent and by whom?"* with the matching
      transfer(s): block, timestamp, from, to, amount in SALT — explicitly labeled
      **native SALT** (X-3). Data source = `findNativeTransfers` over the `transactions`
      index.
- [ ] When the answer is outside the coverage window, the tool says so (honest "not in
      the indexed window" rather than "none found").

**Tests added:** `findTransfers.tool.test` — tool returns labeled native results;
out-of-window honesty case.

---

### WP-2.4: Golden items + benchmark delta

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | measure |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** Move the native-SALT value-query golden items from `blocked_until: RA-3` to
active, add 3–5 more (different amounts/windows/directions), regenerate their live-RPC
ground truth, and run the RA-1 harness. Record the before/after on the value-query
class in the sprint REPORT.

**Acceptance Criteria** *(Rule 11)*
- [ ] Value-query-class accuracy moves from ~0% to ≥ 80% on the native subset. Data
      source = RA-1 accuracy scorer vs live-RPC ground truth.
- [ ] The delta is recorded in `scripts/eval/baselines/` and summarized in the sprint
      REPORT; `canonical.json` updated if this becomes the new reference.

**Tests added:** none beyond the golden items (the harness is the test here).

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| RA-1 harness + golden schema | Built in RA-1 | WP-2.4 can't measure |
| Indexer has populated `transactions` for the window | Available (live RPC fallback) | backfill the window if the worker isn't caught up |
| Neon migration path | Available | WP-2.2 |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `transactions.value` text comparison breaks range queries | Med | High | Generated numeric/bytea indexed column; explicit 256-bit boundary test (WP-2.2) |
| The golden value-query answer isn't inside the indexed window | Med | Med | Backfill the specific window; tool reports coverage honestly; pick golden items within range |
| Slice leaks scope into full ERC-20 work | Med | Med | Native-only guardrail; token transfers explicitly deferred to RA-3 |

## Notes

- This slice intentionally does the *minimum* index work. RA-3 generalizes it (token
  transfers, full backfill, rich lists) and may replace the WP-2.2 index with the
  fuller schema — that's expected; the tool interface stays stable.
- Keep `findTransfers`'s signature token-ready (an optional `token` param that errors
  "token transfers land in RA-3" for now) so RA-3 fills it in without an interface break.
