---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CitrateScan — Explorer Specification

The feature specification for **CitrateScan** (`citrate-explorer`): an AI-native
**BlockDAG** explorer for the **Citrate Network**. It is **Etherscan-parity plus
DAG-native truth plus an AI agent and a machine-first API**.

This spec drives engineering and design. It is exhaustive and concrete on
purpose. Three companion docs sit alongside it: `SYSTEM_PROMPTS.md` (the AI
agent prompt), `DESIGN_BRIEF.md` / `DESIGN_HARNESS_AND_SETTINGS.md` (UI), and
`.agentile/planset/2026-06-02-citrate-explorer-v1/PLANSET.md` (the six sprints).

## Canonical facts (match the code and sibling docs exactly)

- **Chain** 40204 (hex `0x9D0C`). **Native token** SALT (18 decimals; wei =
  **grain**). **Consensus** GHOSTDAG BlockDAG.
- **RPC** `https://rpc.citrate.ai` + **WS** `wss://rpc.citrate.ai`.
- **VM** EVM-compatible **LVM**; Solidity ≤ 0.8.26. Gasless via **EIP-2771
  `CitrateForwarder` relayer** (no native paymaster).
- **`citrate_getDagStats`** →
  `{ totalBlocks, blueBlocks, redBlocks, tipsCount, maxBlueScore, currentTips[],
  height, ghostdagParams{ k:18, maxParents:10, maxBlueScoreDiff:1000,
  pruningWindow:100000, finalityDepth:100 } }`.
- **Block header fields**: `selected_parent_hash`, `merge_parent_hashes[]`,
  `blue_score`, `blue_work`, `height`, `base_fee_per_gas`, `gas_used`,
  `gas_limit` (30M).
- **WS subscriptions**: `eth_subscribe("newHeads" | "newPendingTransactions" |
  "logs")`.
- **Stack**: Next 16 / React 19 / viem + wagmi / Privy / Vercel AI SDK v6 /
  Drizzle + Neon / Tailwind 4 / Foundry.

## Sprint legend

Each feature is tagged with the sprint that lands it. **MVP** = the S-1
indexer + AI foundation slice. Sprints map to the planset:

| Tag | Sprint | Theme |
|---|---|---|
| **MVP** / **S-1** | S-1 | Indexer + AI foundation (DAG-aware index, tool harness, agent) |
| **S-2** | S-2 | Core explorer pages (block / tx / address / token) |
| **S-3** | S-3 | Live DAG visualization (streaming graph) |
| **S-4** | S-4 | Contract verification (source, ABI, proxy detection) |
| **S-5** | S-5 | Read/write contracts (read tab, write tab via wallet) |
| **S-6** | S-6 | Dev API + keys + MCP server + settings |

**Data source** column (Rule 11 — name the source, no mocks):
**live RPC** (`eth_*` / `citrate_*` against the node), **indexer DB**
(Neon + Drizzle, populated by the always-on indexer worker), or **synthesis**
(the AI agent composes other tools/queries and reasons over them).

---

## 1. Feature checklist

### Blocks

| Feature | Sprint | Data source |
|---|---|---|
| Block detail by number / hash / `blue_score` | MVP/S-1 (index), S-2 (page) | indexer DB + live RPC |
| Block header fields (selected parent, merge parents, blue_score, blue_work, height, base fee, gas used/limit) | S-2 | indexer DB |
| Blocks list / feed (newest first by blue_score) | S-2 | indexer DB |
| Live new-block stream | S-3 | live RPC `eth_subscribe("newHeads")` |
| Transactions contained in a block (with canonical position) | S-2 | indexer DB |
| Block reward / fees burned + tipped | S-2 | synthesis over receipts |
| Blue / red classification badge per block | S-2 | indexer DB (`citrate_getDagStats` derived) |
| Finality state (finalized vs pending, by depth) | S-2 | synthesis (`maxBlueScore − blue_score ≥ 100`) |
| Parent / child edges (selected + merge) | S-1 (`dag_edges`), S-3 (viz) | indexer DB |

### Transactions

| Feature | Sprint | Data source |
|---|---|---|
| Transaction detail (from/to/value/nonce/status) | MVP/S-1 (index), S-2 (page) | indexer DB + live RPC |
| Receipt (status, gas used, effective gas price, logs) | S-2 | live RPC `eth_getTransactionReceipt` |
| **Internal transactions** (traces: calls, creates, value moves) | S-2 | live RPC `debug_traceTransaction` → indexer DB |
| **Decoded logs / events** (against verified ABI) | S-2 (raw), S-4 (decoded) | indexer DB + ABI |
| **State diffs** (pre/post balances + storage touched) | S-3 | live RPC trace → synthesis |
| **Gas breakdown** (base fee, priority, gas used vs limit, L1-style cost note) | S-2 | live RPC receipt + synthesis |
| **Transaction action** (plain-English summary: "Swap 10 SALT → …") | MVP/S-1 | synthesis (`explainTransaction`) |
| Method decode (4-byte → signature + params) | S-2 | indexer DB + 4byte/ABI |
| **Gasless / EIP-2771 awareness** (show meta-tx sender vs relayer payer) | S-2 | synthesis (CitrateForwarder decode) |
| Tx canonical order position (across-blocks, GHOSTDAG total order) | S-2 | indexer DB |
| Failure / revert reason decode | MVP/S-1 | synthesis (`diagnoseFailure`) |
| Pending tx view | S-3 | live RPC `eth_subscribe("newPendingTransactions")` |

### Addresses

| Feature | Sprint | Data source |
|---|---|---|
| Address overview (type EOA/contract, balance, counts, first/last seen) | MVP/S-1 (index), S-2 (page) | indexer DB + `eth_getBalance` |
| **Balance** (grains → SALT) | S-2 | live RPC `eth_getBalance` |
| **Multi-tab history** (Transactions / Internal / Token transfers / Logs / Analytics) | S-2 | indexer DB |
| **Token holdings** (ERC-20/721/1155 portfolio) | S-2 | indexer DB |
| **Analytics** (activity over time, counterparties, gas spent, in/out flow) | S-2 (basic), S-3 (charts) | indexer DB + synthesis |
| Address tags / labels (name tags) | S-6 | indexer DB (user + curated) |
| On-demand (re)index of an address | MVP/S-1 | indexer worker (`indexAddress`) |
| AI "explain this address" | MVP/S-1 | synthesis (`addressActivity`) |

### Tokens

| Feature | Sprint | Data source |
|---|---|---|
| Token detail (name, symbol, decimals, supply, standard) | S-2 | indexer DB + `readContract` |
| **ERC-20** transfers + holders | S-2 | indexer DB |
| **ERC-721** (NFT) inventory + transfers | S-2 | indexer DB |
| **ERC-1155** (multi-token) balances + transfers | S-2 | indexer DB |
| **Top holders** + holder distribution | S-2 | indexer DB (`topHolders`) |
| Token transfer feed (per token / per address) | S-2 | indexer DB (`tokenTransfers`) |
| Total supply / circulating note | S-2 | `readContract` + synthesis |
| Token approvals surfaced per address | S-2 | indexer DB (logs) |

### Contracts

| Feature | Sprint | Data source |
|---|---|---|
| Bytecode + `isContract` check | MVP/S-1 | live RPC `eth_getCode` |
| **Source code** (post-verification) | S-4 | indexer DB (verified store) |
| **ABI** | S-4 | indexer DB (verified store) |
| **Read tab** (call view/pure fns) | S-5 | live RPC `eth_call` |
| **Write tab** (state-changing fns via user wallet) | S-5 | user wallet (wagmi/viem) — write |
| **Verification** (Solidity ≤ 0.8.26, Foundry/solc; single + multi-file + standard-JSON) | S-4 | verifier service → indexer DB |
| **Proxy detection** (EIP-1967/1822/diamond; resolve implementation) | S-4 | live RPC (storage slots) + synthesis |
| Contract creation tx + creator | S-2 | indexer DB |
| AI "explain this contract" | MVP/S-1 | synthesis (`explainContract`) |
| Decoded events using verified ABI | S-4 | indexer DB + ABI |
| Similar / matching verified contracts | S-4 | indexer DB (bytecode hash) |

### Tools

| Feature | Sprint | Data source |
|---|---|---|
| **Gas tracker** (base fee now / trend, suggested priority) | S-3 | live RPC `eth_feeHistory` + synthesis |
| **Approval checker** (outstanding ERC-20/721 approvals; revoke link) | S-5 | indexer DB + write (revoke via wallet) |
| **Watchlist** (watch addresses/txs; notify) | S-6 | indexer DB (per-user) |
| **Name tags** (private + curated public labels) | S-6 | indexer DB |
| **Advanced filters** (multi-field tx/log search) | S-2 (basic), S-6 (advanced) | indexer DB (`searchTransactions`) |
| **CSV export** (tx/token-transfer/internal history) | S-6 | indexer DB |
| DAG explorer / parent-walker | S-3 | indexer DB (`exploreDag`) |
| Semantic search (NL → entities) | MVP/S-1 | indexer DB + embeddings (`semanticSearch`) |

### API

| Feature | Sprint | Data source |
|---|---|---|
| **Etherscan-compatible REST** (`/api/v1?module=&action=`) | S-6 (full), S-2 (subset for own pages) | indexer DB + live RPC |
| **JSON-RPC proxy** (`eth_*` / `citrate_*` passthrough w/ rate limit) | S-6 | live RPC passthrough |
| **MCP server** (`/api/mcp`, tools mirror the AI harness) | S-6 | indexer DB + live RPC + synthesis |
| API keys + per-key rate limits + usage | S-6 | indexer DB |
| OpenAPI / docs surface | S-6 | static + synthesis |

### AI ("Ask CitrateScan")

| Feature | Sprint | Data source |
|---|---|---|
| **Explain tx** (narrative above raw) | MVP/S-1 | synthesis (`explainTransaction`) |
| **Explain contract** | MVP/S-1 | synthesis (`explainContract`) |
| **NL query** (natural-language → tool calls → answer) | MVP/S-1 | synthesis over full harness |
| **Failure diagnosis** (decode revert + suggest fix) | MVP/S-1 | synthesis (`diagnoseFailure`) |
| **Semantic search** | MVP/S-1 | indexer DB + embeddings (`semanticSearch`) |
| Streaming agent UI (Vercel AI SDK v6, tool-call traces visible) | MVP/S-1 (API), S-2 (UI) | synthesis |
| DAG walk in plain English | S-3 | synthesis (`exploreDag`) |

---

## 2. DAG-native deltas

Etherscan assumes a **linear chain**: one latest block, height = order,
"N confirmations." Citrate is a **GHOSTDAG BlockDAG** — several of those
assumptions are simply *wrong* here, not just incomplete. CitrateScan renders
the DAG as a DAG. For each delta: the truth, the UI treatment, and the
RPC/field it derives from.

| # | Etherscan assumption | Citrate reality | CitrateScan UI treatment | Derives from |
|---|---|---|---|---|
| 1 | One "latest block" | **Multiple simultaneous tips** — the DAG has many leaf blocks at once | Header shows **`tipsCount`** and lists `currentTips[]`; "Latest" is a *set*, not a single block; the live feed shows all incoming tips | `citrate_getDagStats.currentTips[]`, `tipsCount` |
| 2 | height = order | **`blue_score` ≠ height** — consensus order (blue_score) is distinct from DAG height | Every block shows **both** `blue_score` (primary, "consensus order") and `height` (secondary, "DAG depth"); sort/feeds default to `blue_score` | `blue_score`, `height` |
| 3 | "N confirmations" | **Finality by depth** — final when `current_blue_score − block.blue_score ≥ 100` | Finality badge: **Finalized** vs **Pending (k of 100)**; show depth `= maxBlueScore − blue_score`; never the word "confirmations" | `citrate_getDagStats.maxBlueScore`, `blue_score`, `finalityDepth = 100` |
| 4 | one parent | **1 selected parent + 0–10 merge parents** | Block page draws **all parent edges**; the **selected parent** edge is highlighted/bold, merge parents are secondary edges; show counts | `selected_parent_hash`, `merge_parent_hashes[]` (≤ `maxParents:10`) |
| 5 | (n/a) | **Blue / red GHOSTDAG classification** | Per-block **blue/red badge**; DAG viz colors blue vs red blocks; tooltip explains "blue = in the well-connected past, red = anticone" | `citrate_getDagStats.blueBlocks` / `redBlocks` + per-block class |
| 6 | "tx is in block N" | **Canonical ordering via GHOSTDAG total order** — a tx's position is *across blocks*, not just "in block N" | Tx page shows its **canonical order index** (position in the GHOSTDAG total order) alongside its containing block; explain that ordering is DAG-wide | GHOSTDAG total order (indexer-computed from `blue_score` + tie-break) |
| 7 | "longest chain reorg" | **Reorg / anticone semantics** — blocks can be in the anticone; ordering can shift until finalized | Show **anticone** membership where relevant; mark non-finalized blocks/txs as **order may change**; on reorg the indexer re-derives order (see §4) | `blue_work`, anticone set (indexer-derived), `finalityDepth` |

**Notes**

- **`blue_work`** is the accumulated work used for selected-parent / total-order
  decisions; surfaced on the block page as the DAG analog of "total difficulty."
- The indexer persists DAG structure in a **`dag_edges`** table (selected-parent
  and merge-parent links) so parent-walking and the live viz are index reads,
  not repeated RPC crawls.
- GHOSTDAG params are fixed network constants and shown in an info panel:
  `k:18, maxParents:10, maxBlueScoreDiff:1000, pruningWindow:100000,
  finalityDepth:100`.

---

## 3. Etherscan API compatibility matrix

CitrateScan exposes an **Etherscan-compatible** REST surface at **`/api/v1`**
using the familiar `?module=&action=` form, so existing Etherscan client code
mostly works unchanged. Where a DAG changes the semantics, the **delta** column
says how. Implemented in **S-6** (a subset lands earlier to back our own pages).

| Module | Action | Behavior | DAG delta |
|---|---|---|---|
| `account` | `balance` | SALT balance of an address (grains; clients expect wei-scale — same 18 decimals) | none (unit = grain) |
| `account` | `txlist` | Normal txs for address | results ordered by **blue_score**, not block number; each row carries `blueScore` + `blockHash` |
| `account` | `txlistinternal` | Internal txs (traces) for address or by txhash | from `debug_traceTransaction`; ordering by blue_score |
| `account` | `tokentx` | ERC-20 transfer events for address | adds `blueScore` field |
| `account` | `tokennfttx` | ERC-721/1155 transfer events for address | adds `blueScore`; `tokenID`/`value` for 1155 |
| `contract` | `getabi` | Verified ABI | none |
| `contract` | `getsourcecode` | Verified source + metadata (+ resolved proxy impl) | adds `Implementation` for detected proxies |
| `contract` | `getcontractcreation` | Creator + creation tx | `txHash` + `blueScore` |
| `contract` | `verifysourcecode` | Submit verification (solc ≤ 0.8.26, single/multi/standard-JSON) | none |
| `contract` | `checkverifystatus` | Poll a verification GUID | none |
| `transaction` | `getstatus` | Execution status (isError + errDescription, decoded revert) | revert decode is richer (custom errors/panics) |
| `transaction` | `gettxreceiptstatus` | Receipt status (0/1) | adds `finalized` boolean (by depth) |
| `block` | `getblockreward` | Block reward + fees | by block hash **or** blue_score; reports blue/red class |
| `block` | `getblockcountdown` | Countdown to a target | reinterpreted as **blue_score distance + finality depth**, not "blocks until height N" |
| `logs` | `getLogs` | Event logs by address/topics/range | `address` + explicit numeric `fromBlock`/`toBlock` required; span at most 10,000 blocks; at most 1,000 logs (EX-B-004). `module=proxy&action=eth_getLogs` takes one filter with one `address`, hex `fromBlock`/`toBlock` spanning at most 1,000 blocks (or a `blockHash`), and at most 4 topic positions of at most 4 alternatives each (PBA-L3c-039) |
| `proxy` | `eth_*` | JSON-RPC passthrough (`eth_blockNumber`, `eth_getBlockByNumber`, `eth_call`, `eth_getTransactionByHash`, …) | passthrough to live RPC; **also** exposes `citrate_getDagStats` |
| `stats` | `tokensupply` | ERC-20 total supply | none |
| `stats` | `ethsupply` → **`saltsupply`** | Native SALT supply | renamed to `saltsupply`; `ethsupply` aliased for client compat |
| `gastracker` | `gasoracle` | Suggested base/priority fee tiers | derived from `eth_feeHistory`; base-fee oriented (EIP-1559-style) |

**Cross-cutting deltas**

- Any endpoint that took a **block number** also accepts a **`blueScore`**; any
  response that carried `blockNumber` additionally carries `blueScore`.
- "Confirmations" fields are replaced/augmented by **`finalized`** +
  **`depth`** (`maxBlueScore − blue_score`).
- Response envelope matches Etherscan (`{ status, message, result }`) for
  drop-in client compatibility.
- A native **`citrate_*`** JSON-RPC namespace is reachable via the `proxy`
  module and the dedicated JSON-RPC proxy (notably `citrate_getDagStats`).

---

## 4. Non-functional requirements

### Performance

- **Search latency** < **300 ms** p95 over the indexer for an exact lookup
  (hash / address / block); < **800 ms** p95 for filtered/semantic search.
- **DAG visualization** streams at **60 fps** for the live graph (incremental
  add of new tips/edges; no full re-layout per block; ~1s block cadence).
- **Page TTFB** < **500 ms** p95 for cached entity pages (PPR / cached
  components where applicable); live RPC fall-through bounded by a timeout with
  a degraded-but-correct response.
- **Indexer lag** < **2 blocks** behind the tip set under normal load.

### Rate limits

- **Public unauthenticated** API: modest per-IP budget (e.g. 5 req/s burst,
  daily cap) to protect the node and DB.
- **Keyed** API (S-6): per-key tiers with usage metering; JSON-RPC proxy
  throttled separately and never exposes write methods.
- Standard Etherscan-style `{ status: "0", message: "rate limit reached" }` on
  throttle for client compatibility.

### Accessibility

- **WCAG 2.1 AA**: keyboard-navigable everywhere; the DAG viz has a
  **non-visual equivalent** (parent/child as a navigable list/table) so the
  explorer is usable without the graph.
- Color is never the *only* signal: blue/red blocks and finalized/pending also
  carry text/iconography (color-blind safe).
- Respect `prefers-reduced-motion` — the live DAG stream degrades to discrete
  updates.

### Indexer: reorg & finality handling

- The indexer is **DAG-aware from block zero**: it persists blocks, txs, logs,
  token transfers, and **`dag_edges`** (selected-parent + merge-parent).
- **Canonical order** is (re)derived from GHOSTDAG (`blue_score` + deterministic
  tie-break); a tx's `canonicalOrderIndex` is a function of DAG state, not of
  insertion order.
- **Reorg / re-ordering**: until a block is **finalized** (`maxBlueScore −
  blue_score ≥ 100`), its ordering and blue/red class may change. The indexer
  recomputes order for the **non-finalized frontier** on each new tip and marks
  affected entities `finalized: false`. Finalized history is immutable.
- **Anticone**: the indexer tracks anticone membership for non-finalized blocks
  so reorg semantics are queryable, not hidden.

### Data retention

- **Full history retained** for finalized blocks/txs/logs/transfers (explorer
  expectation: permanent, queryable history).
- Respect the network **`pruningWindow:100000`** for any raw state-dependent
  data the node itself prunes; the indexer keeps the **derived, decoded** record
  beyond the node's pruning window.
- Per-user data (watchlists, name tags, API keys) retained per account; user can
  export (CSV) and delete.

---

## Acceptance (Rule 11)

Every feature above ships with a Work Package whose acceptance criteria **name
the data source** (live RPC / indexer DB / synthesis) and assert against **real
backends — no mocks, no seed data**. The DAG deltas (§2) and the API matrix
(§3) each get conformance tests; the AI features are validated by the
regression checklist in `SYSTEM_PROMPTS.md`.
