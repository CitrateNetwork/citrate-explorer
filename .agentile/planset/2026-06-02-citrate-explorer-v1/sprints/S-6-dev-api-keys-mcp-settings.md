---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-6
status: planned
---

# Sprint S-6: Dev API + keys + MCP + settings

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-6` |
| **Sprint Name** | Dev API + keys + MCP + settings |
| **Goal** | A developer (or agent) calls an Etherscan-compatible REST API and an MCP server with a managed key, and a user controls their E2EE settings/account with full transparency. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-08-14 (target) |
| **End Date (target)** | 2026-08-31 |
| **Status** | `IN PROGRESS` placeholder → set at kickoff |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | S-1..S-5 (all surfaces this sprint exposes) |

## Why this sprint

CitrateScan's machine-first thesis: the same data humans browse should be
consumable by tools and agents. This sprint exposes the index three ways — an
Etherscan-compatible REST API (so existing tooling "just works"), a public **MCP
server** (so agents speak to Citrate natively), and managed API keys gating both
— then closes the loop on user sovereignty: E2EE settings, account export/delete,
and full transparency (system prompt + tool allowlist + audit log). It runs last
because it *exposes* every prior sprint's surface; exposing an incomplete surface
to machines is worse than not exposing it. This sprint also carries the
AUDIT_DRIVEN hardening pass.

## Deliverables

- `app/api/v1/route.ts` — Etherscan-compatible REST (`module`/`action`/`apikey`)
- `app/api/mcp/route.ts` — public MCP server (decoded, dual-unit, cursor-paginated tools)
- `app/api/keys/route.ts` + `app/settings/keys/` — API-key CRUD (hybrid storage) + per-key quotas/rate limits
- `app/settings/` — E2EE settings page
- `app/api/account/export/route.ts` + `app/api/account/route.ts` (`DELETE`)
- `app/settings/transparency/` — system prompt + tool allowlist + audit log viewer
- `lib/ratelimit/` — per-key quota + rate limiter
- Hardening: security review (Rule 8), tripwires, abuse controls

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (S-5 close count) | at kickoff | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | (S-5 close count) | at kickoff | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | (S-5 close count) | at kickoff | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (S-5 close fraction) | at kickoff | see `coverage/GATES.md` |

## Method

Per WP: BDD/Gherkin → failing test + tripwire → code → refactor → adversarial →
journal. WP-6.6 is AUDIT_DRIVEN (`.agentile/workflows/AUDIT_DRIVEN.md`). Project
close (RETRO + essay) follows WP-6.6.

## Work Packages

### WP-6.1: Etherscan-compatible REST (`/api/v1`)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/api/v1?module=&action=&apikey=` — implement the common Etherscan
actions over the indexer: `account` (`balance`, `balancemulti`, `txlist`,
`tokentx`), `block` (`getblocknobytime`-equivalent by blue_score), `logs`
(`getLogs`), `contract` (`getabi`, `getsourcecode`), `proxy` (`eth_*` pass-through),
plus the S-4 verify actions. Responses match Etherscan's `{ status, message, result }`
shape. Does NOT include the MCP server (WP-6.2). DAG-native fields are additive
(`blueScore`, `isFinal`) so existing clients ignore them.

**Acceptance Criteria** *(Rule 11)*

- [ ] `module=account&action=balance&address=` returns the live balance in grains, matching `eth_getBalance` (data source = `accounts` / live RPC).
- [ ] `module=account&action=txlist&address=` returns the same shape Etherscan does for an equivalent address; an off-the-shelf Etherscan client parses it without modification (data source = `transactions`).
- [ ] `module=logs&action=getLogs` returns indexed logs matching a live `eth_getLogs` over the same range (data source = `logs` vs live diff).
- [ ] DAG-additive fields (`blueScore`, `isFinal`) are present and correct but do not break Etherscan-shaped parsing (data source = `blocks`).
- [ ] Every action requires a valid `apikey` and is quota-counted (data source = `api_keys` + rate limiter).

**Tests added:** `v1.balance.live.test.ts`, `v1.txlist.shape.test.ts`, `v1.getlogs.diff.live.test.ts`, `v1.apikey.gate.test.ts`.

---

### WP-6.2: Public MCP server (`/api/mcp`)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/api/mcp` — an MCP server exposing the read harness + indexer tools
(`getChainStatus, getBlock, getTransaction, getAddress, getBalance, getLogs,
readContract, isContract, exploreDag, searchTransactions, addressActivity,
topHolders, tokenTransfers, semanticSearch`) with **decoded, dual-unit, cursor-
paginated** results. Auth via API key. Does NOT expose write tools (no relay over
MCP in v1). 

**Acceptance Criteria** *(Rule 11)*

- [ ] An MCP client lists the tools and calls `getChainStatus`, receiving live DAG stats (tips, blue score, finality depth) (data source = live `citrate_getDagStats`).
- [ ] `exploreDag` over MCP returns selected-parent spine + merge parents + finality for a real block — merge parents present (data source = `dag_edges` + live header).
- [ ] All SALT values are dual-unit (SALT + grains); list results are cursor-paginated by blue_score (data source = decoded tool output).
- [ ] Calls require a valid API key and count against the key's quota; an over-quota call is rejected (data source = `api_keys` + rate limiter).
- [ ] No write/relay tool is exposed over MCP (data source = MCP tool manifest) — Rule 8.

**Tests added:** `mcp.list.test.ts`, `mcp.chainstatus.live.test.ts`, `mcp.exploredag.live.test.ts`, `mcp.quota.test.ts`.

---

### WP-6.3: API-key management + quotas (hybrid storage)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/api/keys` CRUD + `/settings/keys` UI. Our issued keys are **hashed**
(salted SHA-256, shown once — S-1 `crypto.ts`). Per-key rate limits + monthly
quotas in `lib/ratelimit/`. Does NOT store third-party provider keys here (those
are AES-256-GCM at-rest, WP-6.4 settings).

**Acceptance Criteria** *(Rule 11)*

- [ ] Creating a key returns the plaintext **exactly once**; storage holds only the salted SHA-256 hash; the plaintext is unrecoverable thereafter (data source = `api_keys` row — hash only).
- [ ] A request authenticates by hashing the presented key and matching the stored hash (constant-time compare) (data source = `api_keys`).
- [ ] Each key has a configurable rate limit + monthly quota; exceeding either returns 429 with quota headers (data source = rate limiter state).
- [ ] Revoking a key immediately rejects subsequent requests (data source = `api_keys` revoked flag).

**Tests added:** `keys.showonce.test.ts`, `keys.hash.auth.test.ts`, `keys.quota.429.test.ts`, `keys.revoke.test.ts`.

---

### WP-6.4: E2EE settings page

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/settings` — user preferences + the agent's third-party provider keys.
Settings blobs are **E2EE** (client-side key from wallet signature → HKDF → AES;
server stores ciphertext only — S-1 `crypto.ts`). Third-party provider keys the
agent uses server-side are **AES-256-GCM at-rest** under `HKDF(master, wallet)`.
Does NOT cover account export/delete (WP-6.5).

**Acceptance Criteria** *(Rule 11)*

- [ ] Saving a setting encrypts it in-browser from a wallet signature; the server-stored `settings` value is ciphertext (no plaintext) and decrypts only client-side (data source = `settings` row inspection).
- [ ] A third-party provider key the agent uses server-side is AES-256-GCM encrypted at rest under `HKDF(master, wallet)`; ciphertext differs per user (data source = encrypted column inspection).
- [ ] The server cannot read E2EE settings without the client key — a server-side read returns ciphertext (data source = direct DB read test).

**Tests added:** `settings.e2ee.roundtrip.test.ts`, `settings.providerkey.atrest.test.ts`, `settings.server.blind.test.ts`.

---

### WP-6.5: Account export / delete + transparency

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/api/account/export` (full user-data export) + `DELETE /api/account`
(hard delete of all user rows: settings, api_keys, watchlist, audit_log, threads,
messages, thread_memory). `/settings/transparency` showing the agent's **system
prompt**, **tool allowlist**, and a viewer over the user's **audit_log** (every
tool call the agent made on their behalf). Does NOT alter indexer (public) data.

**Acceptance Criteria** *(Rule 11)*

- [ ] Export returns all user-owned rows across the user tables; encrypted fields are exported as the user can decrypt them client-side (data source = user tables).
- [ ] `DELETE /api/account` removes every user-owned row; a follow-up read returns empty; public indexer data is untouched (data source = user-table row count → 0).
- [ ] The transparency page shows the exact system prompt + tool allowlist the agent runs with (data source = the live prompt/allowlist config).
- [ ] The audit log viewer lists every tool call with timestamp + tool + args summary for the user's threads (data source = `audit_log`).

**Tests added:** `account.export.test.ts`, `account.delete.test.ts`, `transparency.prompt.test.ts`, `transparency.auditlog.test.ts`.

---

### WP-6.6: Hardening + project close (AUDIT_DRIVEN)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** Security review across the public surfaces (REST, MCP, relay, verify);
add tripwires for the regression classes found (linear-chain assumption,
unverified-address-as-contract, relayer drain, plaintext-key leak); abuse controls
(bot mitigation + relayer spend bound). Project close: `RETRO.md`, final ratchets,
essay. Does NOT add new features.

**Acceptance Criteria** *(Rule 11)*

- [ ] A dated, immutable audit (`audits/YYYY-MM-DD-*/`) covers `/api/v1`, `/api/mcp`, `/api/relay`, `/api/verify`; findings resolved or accepted with rationale (data source = audit doc, Rule 6/8).
- [ ] Tripwires exist for: blue_score-vs-height ordering, `isContract` via `eth_getCode`, relayer per-user spend bound, and "no plaintext API key in storage/logs"; each cites its finding (data source = `.github/scripts/tripwires/`).
- [ ] Load test shows per-key quota enforcement and bounded relayer spend under abuse (data source = rate limiter + relayer balance).
- [ ] Project close: four ratchets recorded at final values; `RETRO.md` + essay "Building an AI-native, DAG-native explorer on Citrate with Agentile" committed (data source = `coverage/GATES.md`).

**Tests added:** `tripwire.bluescore.test.ts`, `tripwire.iscontract.test.ts`, `tripwire.relayerspend.test.ts`, `tripwire.nokeyleak.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| S-1..S-5 surfaces | Required | Nothing to expose without them |
| S-1 `crypto.ts` (hashed / E2EE / at-rest) | Required | Key + settings storage regimes |
| S-1 `audit_log` | Required | Transparency viewer source |
| Bot mitigation (e.g. Vercel BotID) | Provision in WP-6.6 | Abuse controls on public API/relay |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Public API/MCP abused to drain relayer or DB | Med | High | Per-key quotas + rate limits + bot mitigation (WP-6.3/6.6); MCP exposes no write tools |
| Plaintext key leaks into logs | Low | High | Hashed-at-rest + tripwire "no plaintext key" (WP-6.6) |
| E2EE locks user out (lost wallet key) | Med | Med | Document that E2EE settings are recoverable only with the wallet; public data unaffected; export available |
| Etherscan-shape drift breaks tooling | Med | Med | Shape-conformance tests (WP-6.1); DAG fields additive only |

## Notes

This sprint closes the loop on the machine-first and user-sovereignty pillars:
the same DAG-native, dual-unit, decoded data humans browse is consumable by
agents over MCP and by tools over the Etherscan-compatible REST, gated by hybrid-
stored keys, with the user able to see exactly what the agent did (audit log) and
take their data and leave (export/delete). Final essay published at close.

## Definition of Done

- `/api/v1` is Etherscan-shape-compatible (off-the-shelf clients parse it) with additive DAG fields; `/api/mcp` exposes decoded, dual-unit, cursor-paginated read tools — both API-key gated and quota-counted (Rule 11, 0 mocks).
- API keys are hashed (shown once), per-key rate-limited and quota'd; revocation is immediate.
- E2EE settings store ciphertext only; third-party provider keys AES-256-GCM at-rest; server is blind to E2EE data.
- Account export/delete works; transparency page shows system prompt + tool allowlist + audit log.
- AUDIT_DRIVEN hardening complete: dated immutable audit, tripwires for the named regression classes, bounded relayer spend under load.
- Four ratchets at final values; `RETRO.md` + project essay committed. **v1 complete.**
