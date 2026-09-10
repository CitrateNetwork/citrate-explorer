---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-1
status: active
---

# Sprint S-1: Indexer + AI foundation

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-1` |
| **Sprint Name** | Indexer + AI foundation (the differentiator) |
| **Goal** | The always-on indexer worker ingests live Citrate blocks/txs/receipts/logs/dag_edges into Neon, and a streaming AI agent answers questions over the index and live RPC with a real read-only tool harness. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-06-02 |
| **End Date (target)** | 2026-06-16 |
| **Status** | `KICKED OFF` |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | — (first build sprint) |

## Why this sprint

A block explorer is only as good as its index, and Citrate is a **GHOSTDAG
BlockDAG** — so the index must be DAG-native from block zero or every downstream
view inherits a linear-chain lie. S-1 builds the foundation the other five
sprints are views over: the always-on indexer worker, the Neon schema with
`dag_edges` as a first-class citizen, and the AI tool harness that reads it.
This is the headline differentiator (agentic + DAG-native), so it leads.

## Deliverables

- `lib/citrate/chain.ts` — viem `defineChain(40204)` + public/WS clients + wagmi config
- `lib/citrate/rpc.ts` — typed wrappers for `citrate_getDagStats` and `citrate_*` RPC
- `worker/indexer/` — always-on Node/TS worker (WS ingest + backfill + receipts/logs + DAG stats)
- `db/schema.ts` (Drizzle) — `blocks, transactions, receipts, logs, dag_edges, accounts, contracts` (+ stubs for `tokens, token_transfers, contract_verifications` columns)
- `lib/ai/tools/*.ts` — read-only harness tools: `getChainStatus, getBlock, getTransaction, getAddress, getBalance, getLogs, readContract, isContract, exploreDag`
- `lib/ai/synthesis/explainTransaction.ts`
- `app/api/chat/route.ts` — streaming AI agent (Vercel AI SDK v6, `@ai-sdk/openai-compatible`)
- `lib/auth/privy.ts` + server session verify
- `lib/crypto.ts` — hybrid crypto (E2EE helpers, hashed-key helpers, AES-256-GCM at-rest)
- Live-RPC vitest suite (`tests/integration/*.test.ts`)

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | 0 | 2026-06-02 | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | 0 | 2026-06-02 | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | 0 | 2026-06-02 | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (set at first sprint close) | 2026-06-02 | see `coverage/GATES.md` |

## Method

For each WP: TLA+ (if state-machine touching) → BDD/Gherkin → failing test +
tripwire → code → refactor → adversarial check → journal entry. WP-1.3 (indexer
reorg/finality ordering) is the one state-machine-touching WP and gets a TLA+
sketch of selected-parent-chain reconciliation.

## Work Packages

### WP-1.1: Chain config + viem/wagmi clients

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | S |
| **Commit(s)** | — |

**Scope:** `lib/citrate/chain.ts` exporting a viem `defineChain` for Citrate and
a wagmi config; a JSON-RPC public client (8545) and a WS client (8546). Does NOT
cover writes or relayer (S-5).

**Acceptance Criteria** *(Rule 11 — data source named)*

- [ ] `defineChain({ id: 40204, name: 'Citrate', nativeCurrency: { symbol:'SALT', decimals:18 }, rpcUrls:{ default:{ http:['https://rpc.citrate.ai'], webSocket:['wss://rpc.citrate.ai'] } } })` — unit test asserts id/symbol/decimals (data source = exported config).
- [ ] **Integration test hits `https://rpc.citrate.ai` `eth_chainId` and asserts `0x9d0c`** (data source = live RPC, not a mock).
- [ ] WS client connects to `wss://rpc.citrate.ai` and `eth_subscribe("newHeads")` yields at least one header within 60 s (data source = live WS).

**Tests added:** `chain.config.test.ts` (unit) · `rpc.chainid.live.test.ts`, `ws.newheads.live.test.ts` (integration).

---

### WP-1.2: DAG-aware RPC layer

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** `lib/citrate/rpc.ts` — typed wrappers for `citrate_getDagStats` and
the DAG fields on block headers (`selected_parent_hash`, `merge_parent_hashes[]`,
`blue_score`, `blue_work`, `height`, `base_fee_per_gas`, `gas_used`, `gas_limit`).
A `isFinal(block, dagStats)` helper. Does NOT cover the AI precompiles (deferred
to S-1 semantic search? no — semanticSearch is S-2/S-6; only chat in S-1).

**Acceptance Criteria** *(Rule 11)*

- [ ] `getDagStats()` returns `{ totalBlocks, blueBlocks, redBlocks, tipsCount, maxBlueScore, currentTips[], height, ghostdagParams }` with `ghostdagParams.k === 18`, `finalityDepth === 100` (data source = live `citrate_getDagStats`).
- [ ] `getBlock(hashOrTag)` exposes `selected_parent_hash` and `merge_parent_hashes[]` (data source = live `eth_getBlockByHash`/`ByNumber`).
- [ ] `isFinal(block, stats)` returns true iff `stats.maxBlueScore - block.blue_score >= 100`; unit test covers boundary (diff 99 → false, 100 → true) using a live block + live stats (data source = live RPC).
- [ ] Test asserts `tipsCount >= 1` and `currentTips.length === tipsCount` (data source = live `citrate_getDagStats`) — proves multi-tip handling, not single-head.

**Tests added:** `dagstats.live.test.ts`, `block.dagfields.live.test.ts`, `finality.boundary.test.ts`.

---

### WP-1.3: Indexer worker — ingest + backfill → Neon

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | TLA+ → code/test |
| **Estimated effort** | XL |
| **Commit(s)** | — |

**Scope:** `worker/indexer/` — an always-on Node/TS process (NOT Vercel) that:
subscribes WS `newHeads`; on each head fetches the full block, its receipts
(`eth_getTransactionReceipt`) and logs; calls `citrate_getDagStats`; writes
`blocks, transactions, receipts, logs, dag_edges` to Neon via Drizzle. A backfill
mode walks `eth_getBlockByNumber` from a start height to the tip. Reconciles the
selected-parent chain and records merge-parent edges. Resumes from last committed
`blue_score` on restart. Does NOT decode token transfers (S-2) or verify
contracts (S-4).

**Acceptance Criteria** *(Rule 11)*

- [ ] For 1000 consecutive live blocks, every block's `selected_parent_hash` produces one `dag_edges` row (kind=`selected_parent`) and every entry in `merge_parent_hashes[]` produces a `dag_edges` row (kind=`merge_parent`); count matches live header (data source = live `eth_getBlockByHash` diffed against `dag_edges`).
- [ ] `blocks` rows store `blue_score, blue_work, height, base_fee_per_gas, gas_used, gas_limit` exactly as returned live; `gas_limit` observed = 30,000,000 (data source = live block headers).
- [ ] Ordering query `SELECT hash FROM blocks ORDER BY blue_score DESC` returns the same tip set as `citrate_getDagStats.currentTips` at a captured instant (data source = live `citrate_getDagStats` vs Neon) — proves blue_score ordering, not height.
- [ ] `transactions` + `receipts` + `logs` for a sampled block exactly match `eth_getBlockByHash` + `eth_getTransactionReceipt` (count, hashes, status, gasUsed) (data source = live RPC diff).
- [ ] Worker restart resumes from `MAX(blue_score)` in Neon with zero duplicate rows and zero gaps (data source = Neon row audit + `citrate_getDagStats.totalBlocks`).
- [ ] A reorg/red-block event below finality depth updates ordering without deleting blocks (rows marked superseded, not removed); blocks at depth ≥ 100 are never rewritten (data source = `blocks` history vs recomputed finality).

**Tests added:** `indexer.dagedges.live.test.ts`, `indexer.blueorder.live.test.ts`, `indexer.receipts.live.test.ts`, `indexer.resume.test.ts`, `indexer.reorg.test.ts` · TLA+ `specs/tla/SelectedParentReconcile.tla` (+ `.cfg`).

---

### WP-1.4: Neon schema + Drizzle migrations

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** `db/schema.ts` defining indexer tables `blocks, transactions,
receipts, logs, dag_edges, accounts, contracts` with the DAG columns, plus the
user table `audit_log` (needed by WP-1.6) and table definitions (empty for now)
for `tokens, token_transfers, contract_verifications`. Drizzle migration applies
on Neon. Does NOT populate token/verification tables (S-2/S-4).

**Acceptance Criteria** *(Rule 11)*

- [ ] Migration applies cleanly on the live Neon branch (`drizzle-kit push`); `\d blocks` shows `blue_score`, `blue_work`, `height` columns (data source = Neon).
- [ ] `dag_edges` has `(child_hash, parent_hash, kind)` with kind ∈ {`selected_parent`,`merge_parent`} and an index on `child_hash` (data source = Neon schema introspection).
- [ ] Indexes exist for the hot read paths: `blocks(blue_score)`, `transactions(from)`, `transactions(to)`, `transactions(block_hash)`, `logs(address)`, `logs(topic0)` (data source = `pg_indexes`).
- [ ] All SALT-valued columns store raw grains (numeric/bigint); a unit test asserts round-trip of a 18-decimal value with no float loss (data source = Neon round-trip).

**Tests added:** `schema.migrate.live.test.ts`, `grains.roundtrip.test.ts`.

---

### WP-1.5: Read-only AI tool harness

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | L |
| **Commit(s)** | — |

**Scope:** `lib/ai/tools/` — the read harness, each tool a real backend call:
`getChainStatus` (→ `citrate_getDagStats`), `getBlock`, `getTransaction`,
`getAddress`, `getBalance`, `getLogs`, `readContract` (`eth_call`), `isContract`
(`eth_getCode`), `exploreDag` (walk `dag_edges` / live headers — selected-parent
spine + merge parents + tips + finality). Reads index first, falls through to
live RPC (decision X-1). Does NOT include indexer-search tools (`searchTransactions`,
`topHolders`, `semanticSearch` — S-2/S-6) or write tools (S-5).

**Acceptance Criteria** *(Rule 11)*

- [ ] Each tool returns data from a named backend; no tool returns a literal/hardcoded value — adversarial grep for mock/placeholder returns 0 (Rule 2) (data source = the tool's RPC/Neon call).
- [ ] `isContract(addr)` returns true iff `eth_getCode(addr) !== '0x'`; verified against one known contract and one known EOA on live 40204 (data source = live `eth_getCode`) — enforces decision X-5.
- [ ] `getChainStatus()` reports `tipsCount`, `maxBlueScore`, and finality depth from live stats (data source = live `citrate_getDagStats`).
- [ ] `exploreDag(blockHash)` returns the selected-parent ancestor chain AND merge parents AND whether the block is final; merge parents are present (not dropped) for a known multi-parent block (data source = `dag_edges` + live header).
- [ ] All SALT outputs are dual-unit (SALT + grains) per decision X-4 (data source = computed from grains).

**Tests added:** `tool.iscontract.live.test.ts`, `tool.chainstatus.live.test.ts`, `tool.exploredag.live.test.ts`, `tool.dualunit.test.ts`.

---

### WP-1.6: Streaming chat agent + explainTransaction synthesis

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | L |
| **Commit(s)** | — |

**Scope:** `app/api/chat/route.ts` — Vercel AI SDK v6 `streamText` agent wired to
the WP-1.5 harness, inference via `@ai-sdk/openai-compatible` (env-driven:
`infer.citrate.ai/v1` or local `llama-server`). `lib/ai/synthesis/
explainTransaction.ts` composes `getTransaction` + `getLogs` + decoded events
into a plain-English "what happened". Every tool invocation is written to
`audit_log`. Does NOT include `diagnoseFailure`/`explainContract` (S-2) or
persistent encrypted threads (S-2 messages table).

**Acceptance Criteria** *(Rule 11)*

- [ ] `POST /api/chat` streams tokens incrementally; a prompt like "what is the latest blue score?" results in a `getChainStatus` tool call whose result drives the answer (data source = live `citrate_getDagStats` via tool, logged in `audit_log`).
- [ ] `explainTransaction(hash)` for a real on-chain tx names the actual to/from/value and at least one decoded log; the summary contains no field absent from the tool results (data source = live tx + logs).
- [ ] Inference provider is selected by env (`INFERENCE_BASE_URL`); switching from gateway to local `llama-server` requires no code change — integration test runs against whichever is configured (data source = configured OpenAI-compatible endpoint).
- [ ] Every agent answer in the eval set cites ≥1 tool call in `audit_log`; 0 answers fabricate data (Pillar P2 groundedness) (data source = `audit_log` rows).

**Tests added:** `chat.stream.live.test.ts`, `explaintx.live.test.ts`, `chat.grounded.test.ts`.

---

### WP-1.7: Privy auth + hybrid crypto

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Order step** | code/test |
| **Estimated effort** | M |
| **Commit(s)** | — |

**Scope:** `lib/auth/privy.ts` (provider + server session verify) and
`lib/crypto.ts` implementing all three regimes: E2EE (wallet-signature → HKDF →
AES, in-browser), hashed (salted SHA-256 for issued keys), AES-256-GCM at-rest
(per-user `HKDF(master, wallet)` for third-party provider keys). Does NOT include
the keys/settings UI or REST endpoints (S-6) — only the primitives + auth gate.

**Acceptance Criteria** *(Rule 11)*

- [ ] An authenticated Privy session exposes the user's wallet address server-side; an unauthenticated call to `/api/chat` is rejected 401 (data source = Privy session token verified server-side).
- [ ] E2EE round-trip: a settings blob encrypted in-browser from a wallet signature decrypts back to plaintext; the server-stored value is ciphertext (no plaintext) (data source = encrypted blob inspection).
- [ ] Issued-API-key hashing: same key hashes to the same salted SHA-256; the plaintext is unrecoverable from storage; shown-once flow returns plaintext exactly once (data source = `api_keys` row inspection — only hash stored).
- [ ] At-rest provider key: AES-256-GCM encrypt/decrypt round-trips under `HKDF(master, wallet)`; ciphertext differs per user for the same plaintext (data source = encrypted column inspection).

**Tests added:** `auth.session.live.test.ts`, `crypto.e2ee.test.ts`, `crypto.hashedkey.test.ts`, `crypto.atrest.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| D-Neon (Neon Postgres) | Provision in WP-1.4 | Blocks WP-1.3 writes, WP-1.6 audit_log |
| D-Privy (Privy app) | Provision in WP-1.7 | Blocks auth gate on WP-1.6 |
| D-Infer (OpenAI-compatible endpoint) | Env-driven; local `llama-server` fallback | Blocks WP-1.6 streaming; harness tools unaffected |
| D-Host (always-on host for worker) | Choose + provision in WP-1.3 | Indexer cannot run continuously off Vercel |
| Live `rpc.citrate.ai` / `wss://rpc.citrate.ai` | Available | Blocks all live-RPC tests |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Indexer lags the tip (multi-tip, reorgs) | High | Med | X-1 fall-through + async backfill; resume-from-blue-score; reconcile on each `newHeads` |
| Treating DAG as linear (height ordering) | High | High | X-2/X-3 in schema + WP-1.3 acceptance proves blue_score ordering & multi-tip |
| Worker host instability | Med | Med | Health-check + idempotent resume; no duplicate/gap on restart (WP-1.3 AC) |
| Inference endpoint down | Med | Med | Env-driven provider, local `llama-server`; harness works without the model |

## Notes

S-1 is the foundation; resist scope creep into pages (S-2) or token decoding.
The one non-obvious thing future agents must not relearn: **`blue_score ≠ height`,
multiple tips exist, finality is depth ≥ 100** — the schema and WP-1.3 acceptance
criteria encode this so no downstream sprint can quietly assume a single linear
head. Journal the first reorg observed against the live DAG.

## Definition of Done

- All WP acceptance criteria checked, each tracing to a live RPC or Neon source (Rule 11); 0 mocks in production paths (Rule 2 grep clean).
- Indexer worker runs continuously on D-Host, ingesting live `newHeads` into Neon with p95 lag < 3 s; restart resumes with 0 gaps / 0 duplicates.
- `dag_edges`, `blue_score` ordering, and finality-by-depth all verified against live data for ≥1000 sampled blocks.
- `POST /api/chat` streams grounded answers via the read harness; 100% of eval answers cite a tool call in `audit_log`.
- Privy auth gate enforced; all three crypto regimes round-trip in tests.
- Four ratchets recorded at close (tests up from 0; ≥1 TLA+ spec; ≥1 tripwire for the "linear-chain assumption" class; frontmatter coverage 100% of new `.md`).
- `RETRO.md` + journal ("first reorg on the live DAG") committed; S-2 kicked off.
