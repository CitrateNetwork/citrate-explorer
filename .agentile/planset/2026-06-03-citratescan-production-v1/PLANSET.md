---
created: 2026-06-03T00:00:00Z
branch: citratescan-production-planset
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# PLANSET — CitrateScan to Production (v1)

The step-by-step plan to take CitrateScan from "beautiful design on a real read
backend, running on sample data" to a **world-class, GDPR-compliant, deployed
release** the team can pick apart. Grounded in [`EVALUATION.md`](./EVALUATION.md);
acceptance lives in [`../../specs/features/`](../../specs/features/README.md)
(347 BDD scenarios). Supersedes the *sequencing* of `2026-06-02-citrate-explorer-v1`
(whose feature content — DAG viz, verification, read/write, dev API — is folded in).

## North star
The design the team signed off on (`src/scan/**`) **is** the product. We wire it
to the live backend (leaning on **wagmi + viem** for every chain interaction),
add the legal/consent/ops layer a public EU-facing product requires, and ship it
to Vercel with the indexer running. **No visual change** to the approved design
unless objectively better (responsive, a11y, real states).

## Cross-cutting decisions (apply to every sprint)

- **X-1 Providers are the foundation.** Mount `<Providers>` (Privy → React Query →
  `@privy-io/wagmi`) inside the client boundary in `src/app/page.tsx`/the scan app.
  Every chain interaction goes through **wagmi/viem hooks** — `useAccount`,
  `useBalance`, `useReadContract`, `useWriteContract`, `useSignTypedData`,
  `useWatchContractEvent`, `usePublicClient` — never ad-hoc fetch to a node.
- **X-2 Sample data becomes the offline fallback, not the default.** Each screen
  fetches live `/api/*`; on success it renders live, on failure it shows a real
  error/empty state. Sample `SD` is retained only as an explicit
  `NEXT_PUBLIC_DEMO=1` fallback (never silently masking an outage — a Rule-11 line).
- **X-3 Consent gates non-essential cookies.** Privy and any analytics mount only
  after consent for EU/region-flagged visitors. Essential auth works; analytics
  is opt-in.
- **X-4 CSP allowlist is explicit.** Privy, `rpc.citrate.ai` (+ `wss`),
  `infer.citrate.ai`, Neon, fonts. Defined once in `next.config.ts` + `vercel.json`.
- **X-5 Shareable, indexable URLs.** The hash router (`#/tx/..`) becomes real
  paths (`/tx/..`) with SSR `generateMetadata` + OG, preserving the exact SPA
  components/visuals (P-8). Until then, in-app nav keeps working.
- **X-6 Honest states everywhere.** Loading skeletons, empty states, error
  boundaries, not-found, offline/RPC-down banners — no fabricated success.
- **X-7 Auth-scoped writes.** Saving settings, issuing keys, writing contracts,
  per-user audit all require a verified Privy session server-side.

## Critical path & demo milestones
```
P-0 providers+auth ─► P-1 wire reads ─► P-2 live agent     ──► DEMO-READY (team can pick apart)
                          │                  │
                          ├─► P-3 legal+consent ─────────────► PUBLIC-SAFE (EU/GDPR)
                          ├─► P-4 contract read/write (wagmi) ─► WRITE-CAPABLE
                          ├─► P-5 live DAG stream
                          ├─► P-6 settings/persistence
                          ├─► P-7 dev API + MCP
                          └─► P-8 hardening (CSP/SEO/a11y/monitoring) ─► P-9 deploy ─► PRODUCTION
```
P-0..P-2 are strictly sequential (each unblocks the next). P-3..P-7 can run in
parallel once P-0/P-1 land. P-8/P-9 close the release.

---

## P-0 — Providers + auth foundation
**Goal:** mount the provider tree and replace hardcoded `alice.ctr` with real
Privy auth, so every wagmi/viem hook and the logged-in identity work.
**Features:** `authentication.feature`, parts of `settings.feature`, `app-shell.feature`.

- **WP-0.1** Mount `<Providers>` (Privy + QueryClient + `@privy-io/wagmi`) wrapping
  the scan app; gate on `NEXT_PUBLIC_PRIVY_APP_ID` (dev runs wallet-less). Verify
  `useAccount()`/`useBalance()` resolve on chain 40204.
- **WP-0.2** Header auth: logged-out state (a real "Log in" entry point) ↔
  logged-in (connected address + account menu); replace the static `alice.ctr`
  button (`src/scan/app.tsx:111`). Embedded wallet via Privy; email/passkey login.
- **WP-0.3** A `useAuth()`/Privy context the scan screens read for the current
  address; thread it into the agent's per-user audit and the sample→live identity
  (tx From, watchlist, account settings).
- **WP-0.4** `src/lib/citrate/abi.ts` — bundle the system-contract ABIs
  (ModelRegistry, InferenceRouter, CitrateForwarder) so read/write hooks have types.
**Acceptance:** logging in shows the real address in the header (not `alice.ctr`);
`useBalance` shows the account's SALT; logout clears it; `/api/chat` auth gate
passes with the Privy token. **Done = `authentication.feature` @P-0 green.**

## P-1 — Wire reads (scan SPA → live `/api/*`)
**Goal:** every read screen shows real chain data with real loading/empty/error
states; sample data demoted to offline fallback (X-2).
**Features:** `home`, `search`, `transaction`, `entity-pages`, `live-dag` (snapshot),
`reliability-states`.

- **WP-1.1** A typed `live/` data layer (extend `src/scan/live.ts`): `useLiveTx`,
  `useLiveBlock`, `useLiveAddress`, `useLiveSearch`, `useLiveDag`, `useLiveLatest`
  — each fetches `/api/*`, returns `{data, loading, error, live}`, maps the route
  shape → the design's render shape, falls back to `SD` only under demo flag.
- **WP-1.2** Wire Home (chain status, latest blocks/txns, DAG mini-strip),
  Transaction (`/api/tx/[hash]` + receipt; tabs), Block (`/api/blocks/[id]`),
  Address (`/api/address/[addr]` + indexed activity), omni-search (`/api/search`).
- **WP-1.3** Real states: `loading.tsx` skeletons per screen, empty states (incl.
  the unpopulated `token_transfers`), `error.tsx` + `global-error.tsx`,
  `not-found.tsx` (fix the dead `nav("verify")`), an offline/RPC-down banner that
  is NOT masked by sample data.
- **WP-1.4** Token holders/transfers need the indexer to decode Transfer logs into
  `token_transfers` (currently empty) — land that ingestion or show an honest
  "indexing" empty state.
**Acceptance:** pasting a real tx hash / address / block height shows live data;
killing the RPC shows an honest error, not stale sample. **Done = `home`,
`search`, `transaction`, `entity-pages` @backend-ready scenarios → @wired.**

## P-2 — AI agent live
**Goal:** the Ask-CitrateScan drawer answers from `/api/chat` (real LLM + tools),
not the scripted `SD.AGENT`.
**Features:** `ai-agent.feature`, the agent parts of `transaction`/`contracts`.

- **WP-2.1** Replace the scripted drawer with the AI SDK `useChat` transport →
  `POST /api/chat`; stream tokens; render the real tool-call traces and cited
  entity chips (clickable to routes).
- **WP-2.2** Wire "Explain this transaction", "explain this contract", failure
  diagnosis, and inline "Explain / Ask about this" to seed the agent with context.
- **WP-2.3** Auth + audit: pass the Privy token; the per-user `audit_log` powers
  the Transparency settings panel. Honest 503 UI when inference is unconfigured.
**Acceptance:** a free-text question triggers real tool calls whose results drive a
cited answer; the tool-trace reflects actual `/api/chat` tool invocations.
**Done = `ai-agent.feature` @backend-ready → @wired.**

## P-3 — Legal, consent & footer
**Goal:** the site is safe to put in front of EU/public traffic.
**Features:** `cookie-consent-gdpr`, `legal-pages`, footer scenarios in `app-shell`,
privacy/erasure in `settings`/`data-privacy-storage`.

- **WP-3.1** Footer: brand/version/build commit, network (Citrate testnet 40204 /
  SALT), nav (explorer, developer hub, status), legal links, source.
- **WP-3.2** Legal pages — SSR `/privacy`, `/terms`, `/cookies`, `/.well-known/
  security.txt`; last-updated dates; the privacy policy enumerates the hybrid
  storage model and data rights.
- **WP-3.3** Cookie-consent banner (region-aware): first-visit gate; granular
  essential/analytics/preferences; Privy/wallet cookie disclosure; persisted +
  re-promptable on policy-version bump; GDPR vs CCPA ("Do Not Sell") variants;
  reject-all still works. Privy/analytics mount only post-consent (X-3).
- **WP-3.4** GDPR rights: wire `GET /api/account/export` to the Privacy panel;
  build the missing `DELETE /api/account` (erasure) + a confirm flow honest about
  on-chain permanence.
**Acceptance:** an EU visitor is gated until consent; analytics is blocked on
reject; export downloads the user's data; erasure deletes account-scoped rows.
**Done = `cookie-consent-gdpr` + `legal-pages` @P-3 green.**

## P-4 — Contract read/write via wagmi/viem (+ CitrateForwarder)
**Goal:** read contract state and submit writes — wallet-paid and **gasless** —
straight from the verified-contract UI. Lean fully into wagmi/viem.
**Features:** `contracts.feature` (@wagmi, @gasless).

- **WP-4.1** Read tab: decoded reads via `useReadContract` over a verified ABI
  (from P-4 verification or bundled system ABIs); typed inputs/outputs.
- **WP-4.2** Write tab (wallet-paid): `useWriteContract` + `useAccount`;
  `useWaitForTransactionReceipt` for status; `useWatchContractEvent` for emitted
  events; surface the tx in the explorer.
- **WP-4.3** **Gasless write (EIP-2771):** build the `CitrateForwarder` contract
  (Foundry, EIP-712 `ForwardRequest` + nonce/replay protection, Rule-8 review +
  TLA+ per the methodology), vendor `forge-std`, deploy via a ceremony; the UI
  signs the ForwardRequest with `useSignTypedData` → `POST /api/relay` → the
  Foundation relayer submits and pays. Implement the real `/api/relay` (verify
  signature, check forwarder nonce, submit).
- **WP-4.4** Contract verification: real `POST /api/verify` (persist a
  `contract_verifications` row; recompile-and-diff engine in a sandbox; proxy
  detection); the verified source + Code/Read/Write/Events tabs render from it.
**Acceptance:** a user reads a contract value live; a wallet write lands on-chain
and shows its receipt; a **gasless** write succeeds with "gas paid by the
Foundation" and the user pays nothing. **Done = `contracts.feature` @wagmi/@gasless green.**

## P-5 — Live DAG stream
**Goal:** the DAG view streams the real GHOSTDAG over WebSocket.
**Features:** `live-dag.feature` (@P-5).

- **WP-5.1** Indexer subscribes `wss://rpc.citrate.ai eth_subscribe("newHeads")`
  (the `wsClient()` already exists) and emits compact deltas; a `/api/dag` stream
  endpoint (SSE/WS) pushes `{newVertices, newEdges, statusChanges}`.
- **WP-5.2** The DAG view + mini-strip consume the stream (RAF-batched, last-N
  window), drawing selected-parent spine vs merge edges, blue/red, ringed tips,
  finality-by-depth — replacing the random generator; keep the accessible list.
**Acceptance:** new blocks appear in the DAG as they're produced; pausing/resuming
works; the linear/a11y fallback mirrors the stream. **Done = `live-dag` @P-5 green.**

## P-6 — Settings & persistence
**Goal:** every settings control is wired to a real backend.
**Features:** `settings.feature`, `data-privacy-storage.feature`.

- **WP-6.1** Appearance → localStorage (theme/verbosity/reduced-motion) + a no-flash
  theme bootstrap; fix the hardcoded `data-theme="light"` SSR flash.
- **WP-6.2** Account E2EE settings: a `/api/settings` read/write using the existing
  `crypto-client.ts` (wallet-signature-derived key; server stores ciphertext it
  can't read).
- **WP-6.3** Watchlist CRUD route + UI (per-user, persisted); alerts.
- **WP-6.4** API-keys panel → `GET/POST /api/keys` (+ a revoke/`DELETE` route):
  issue, copy-once, list, quota; usage.
- **WP-6.5** Transparency panel: real system prompt, the read-only tool allowlist,
  the live `audit_log`, source/commit/model provenance.
- **WP-6.6** Developer panel: `wallet_addEthereumChain` (40204), RPC URL, SDK/MCP links.
**Acceptance:** settings survive reload; a key is issued and shown once; the
watchlist persists per user; the audit log shows real agent tool calls.
**Done = `settings.feature` @P-6 green.**

## P-7 — Dev API + keys + MCP
**Goal:** programmatic access is complete and metered.
**Features:** `developer-api.feature`.

- **WP-7.1** `GET /api/v1` Etherscan-compat coverage (account/contract/transaction/
  block/logs/stats/gastracker) over the indexer; the `{status,message,result}` envelope.
- **WP-7.2** API-key gating + per-key rate limit/quota on `/api/v1` and `/api/chat`.
- **WP-7.3** MCP JSON-RPC transport (`initialize`/`tools/list`/`tools/call`) over
  the read tools, with decoded/dual-unit/cursor-paginated output.
- **WP-7.4** Developer hub UI (`#/apis`) wired to real endpoints + quickstarts (viem/SDK/MCP).
**Acceptance:** an external `curl` with a key returns Etherscan-shaped data and is
rate-limited; an MCP client lists + calls tools. **Done = `developer-api.feature` green.**

## P-8 — Production hardening
**Goal:** secure, indexable, observable, accessible.
**Features:** `production-platform.feature`, `accessibility.feature`,
`reliability-states.feature`.

- **WP-8.1** Security headers + CSP (X-4) in `next.config.ts` + `vercel.json`:
  CSP allowlist, HSTS, frame-ancestors, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy. Vet/replace the plaintext-HTTP `CITRATE_RPC_FALLBACK` node IP.
- **WP-8.2** SEO + shareable URLs (X-5): migrate hash routes → App Router paths
  with SSR `generateMetadata` + per-entity OG images, `robots.txt`, `sitemap.ts`
  — preserving the exact components/visuals.
- **WP-8.3** Monitoring: error tracking (Sentry) + structured logs + `/api/health`
  for the app and the indexer; freshness/lag alerts.
- **WP-8.4** Rate limiting / WAF on read APIs + `/api/chat` (edge).
- **WP-8.5** Accessibility pass: semantic buttons/links (not clickable divs),
  keyboard nav + focus rings, the DAG parallel accessible list, reduced-motion,
  aria-live; add an **axe/Lighthouse CI gate**.
**Acceptance:** CSP/headers verified; entity pages are server-rendered + shareable
with OG; axe CI passes AA; health endpoints report status. **Done = `production-platform`
+ `accessibility` green.**

## P-9 — Deploy
**Goal:** a stable, available production deployment.
**Features:** deploy scenarios in `production-platform.feature`.

- **WP-9.1** Vercel project: preview + prod, env scoping (public vs server-only),
  domain `explorer.citrate.ai`; a CI build/typecheck/lint/test workflow on PR +
  preview-deploy.
- **WP-9.2** Provision: Neon (`pnpm db:migrate`), Privy app, inference endpoint;
  the always-on **indexer host** (Railway/Fly/VM) running `pnpm indexer` with
  health + restart.
- **WP-9.3** Go-live checklist: secrets set + rotated, consent live, legal pages
  reachable, error/monitoring active, indexer fresh (p95 lag < 3 s), smoke of the
  full FE↔BE flow on prod.
**Acceptance:** `explorer.citrate.ai` serves live data, gasless writes work, the
agent answers, consent + legal are live, monitoring is green. **Done = production.**

## Definition of done (release)
- 0 `@todo`/`@backend-ready` on launch-blocking features (auth, reads, agent,
  consent/legal, contracts, reliability, platform); the burndown in
  [`features/README.md`](../../specs/features/README.md) reaches it.
- All chain interaction goes through wagmi/viem; a gasless write works end-to-end.
- EU-safe: consent gate + legal pages + export + erasure.
- Deployed to `explorer.citrate.ai` with the indexer running and monitoring green.
- The four agentile ratchets hold (tests up, ≥1 spec, tripwires, frontmatter).

## Risks
| Risk | Mitigation |
|---|---|
| Provider mount destabilizes the SPA render | P-0 first, isolated; verify hooks before wiring screens |
| Live data sparser than the rich sample demo | X-2 honest empty/loading states; indexer populates history; demo flag for showcases |
| Routing migration (P-8) regresses visuals | preserve components verbatim; path routing only changes URLs/SSR, not DOM |
| Gasless relay / forwarder security | Rule-8 review + TLA+ on the forwarder; signature + nonce verification in `/api/relay` |
| GDPR scope creep | P-3 is a hard launch gate; consent + legal + erasure are non-negotiable |

## Execution
Sprints break out into `.agentile/sprints/active/...` at kickoff (as S-1 did),
each scenario set its acceptance. Start with **P-0** — it unblocks everything.
