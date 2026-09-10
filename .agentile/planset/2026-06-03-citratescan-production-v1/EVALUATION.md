---
created: 2026-06-03T00:00:00Z
branch: citratescan-production-planset
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CitrateScan — Production Readiness Evaluation

A code-grounded assessment of where CitrateScan stands today and what stands
between it and a world-class, deployable, GDPR-compliant release. Backed by a
full read of the frontend (`src/scan/**`), backend (`src/app/api/**`,
`src/lib/**`, `scripts/indexer/**`), and the existing planset
(`2026-06-02-citrate-explorer-v1`). The plan that closes these gaps is
[`PLANSET.md`](./PLANSET.md); the acceptance specs are
[`../../specs/features/`](../../specs/features/README.md) (347 scenarios).

## The one fact that reframes everything

**The shipped product UI is the ported design at `src/scan/**` — a client-only
SPA — and it runs almost entirely on bundled sample data.** The original planset
(S-2…S-6) was written to build *new* `app/*` route pages; that predates the
design handoff. We are NOT building parallel pages. **The work is to wire the
design the team signed off on to the live backend** (which is largely real),
add the production/compliance layer it never had, and deploy it.

Two structural blockers fall out of this:

1. **`<Providers>` (Privy + Wagmi + QueryClient) is not mounted.** It exists at
   `src/components/providers.tsx` but nothing imports it — it was dropped when the
   scan layout replaced the placeholder. Until it wraps the app, **no wagmi/viem
   hook works**: no `useAccount`, `useBalance`, `useReadContract`,
   `useWriteContract`, `useSignTypedData`. This blocks real login and all chain
   read/write. It is the first thing to fix (P-0).
2. **The UI is sample-data-driven.** Only `ChainBadge` is wired (to `/api/dag`).
   The agent drawer is scripted (never calls `/api/chat`). Login is a hardcoded
   `alice.ctr`. Contract Write is a fake modal. The DAG is a random generator.

## Current state — backend (mostly real)

| Capability | Route | Status |
|---|---|---|
| Chain status / GHOSTDAG snapshot | `GET /api/dag` | ✅ real (wired) |
| Omni-search resolve | `GET /api/search` | ✅ real (UI not wired) |
| Transaction + receipt | `GET /api/tx/[hash]` | ✅ real (UI not wired) |
| Blocks / block detail | `GET /api/blocks` `/[id]` | ✅ real (UI not wired) |
| Address (balance/nonce/code + indexed activity) | `GET /api/address/[addr]` | ✅ real (UI not wired) |
| AI agent (streaming, 13 read-only tools, auth gate, audit) | `POST /api/chat` | ✅ real (UI scripted instead) |
| API-key create/list (hashed, shown-once) | `GET/POST /api/keys` | ✅ real (needs Neon+auth; UI not wired) |
| GDPR data export | `GET /api/account/export` | ✅ real (UI not wired) |
| Contract page | `GET /api/contract/[addr]` | ⚠️ bytecode only; no ABI/source |
| Contract verification | `POST /api/verify` `/[guid]` | ⛔ stub (no persist, no engine) |
| Gasless write relay | `POST /api/relay` | ⛔ stub (no forwarder contract) |
| Etherscan-compat REST | `GET /api/v1` | ⚠️ 3 actions; no key-gating/rate-limit |
| MCP server | `/api/mcp` | ⚠️ discovery only; no JSON-RPC |
| Settings / watchlist / threads write | — | ⛔ schema + crypto exist; **no routes** |
| Erasure | `DELETE /api/account` | ⛔ spec'd, **route missing** |

Backend strengths: honest-stub discipline (501/503 with a sprint pointer, never
fake data), the RPC-first read harness works before Neon, the hybrid crypto
(`crypto.ts`/`crypto-client.ts`) is fully built. Indexer gaps: `token_transfers`
is never populated (so token holders/transfers are empty), no WS subscription
(HTTP polling), `accounts`/`contracts`/`tokens` tables unpopulated. The
**`contracts/` directory is empty** — the `CitrateForwarder` (EIP-2771) the
gasless relay needs does not exist, `forge-std` is unvendored, and
`src/lib/citrate/abi.ts` is missing.

## Current state — frontend (design-complete, data-incomplete)

All 10 screens are a faithful, internally-consistent design. Functionally:
- **Wired:** ChainBadge → `/api/dag`. That is the only live wire.
- **Functional (in-memory):** Appearance settings (theme/verbosity/reduced-motion)
  — not persisted, resets on reload.
- **Mock/scripted/fake:** every other screen (sample `SD` data), the agent drawer
  (regex + `setTimeout`), contract read (simulated) and write (fake modal), the
  DAG stream (random), CSV exports (no download), all Account/Privacy/Security/
  Watchlist/API-key controls (no-ops).
- **Absent:** any footer; any cookie-consent banner; any legal pages; any real
  auth (hardcoded `alice.ctr`); `error.tsx`/`loading.tsx`/`not-found.tsx`
  boundaries; SSR/SEO (the app is `ssr:false`, so crawlers see an empty shell);
  security headers/CSP (`next.config.ts` is empty); monitoring.

## Coverage gap — what the existing planset (S-2…S-6) does NOT account for

| User requirement | In old planset? | Gap |
|---|---|---|
| Footer + legal pages (privacy/terms/cookies) | ❌ | new (P-3) |
| **Cookie consent + GDPR/CCPA** | ❌ | new — launch blocker (P-3) |
| Real Privy login replacing `alice.ctr` | 🟡 backend gate only | UI wiring new (P-0) |
| Wire the **scan SPA** off sample data → live `/api` | ❌ | the single biggest hidden scope (P-1, P-2) |
| Agent drawer → `/api/chat` | ❌ | new (P-2) |
| Settings/watchlist persistence | 🟡 design only | wiring + routes new (P-6) |
| GDPR erasure (`DELETE /api/account`) | 🟡 spec'd, unbuilt | new (P-3) |
| Contract read/write via wagmi/viem + forwarder | ✅ S-5 | reorient onto scan UI (P-4) |
| Security headers / CSP | ❌ | new (P-8) |
| SEO / OG / robots / sitemap | ❌ | new (P-8) |
| Error / loading / not-found states | ❌ | new (P-1, P-8) |
| Accessibility enforcement (WCAG, axe CI) | 🟡 aspirational | new gate (P-8) |
| Monitoring / health / observability | ❌ | new (P-8) |
| Deploy (Vercel, domain, env, indexer host) | 🟡 handoff note | new sprint (P-9) |

The original S-1…S-6 remain valid as the *feature* backbone (DAG viz, verification,
read/write, dev API) — they are **folded into** the production sprints below
rather than discarded.

## Prioritized gaps

**P0 — launch blockers**
1. Mount `<Providers>`; real Privy login replacing `alice.ctr`.
2. Wire the scan SPA to live `/api/*` (reads + agent), with real error/loading states.
3. Legal + consent: footer, /privacy /terms /cookies, GDPR/CCPA cookie banner, erasure route.
4. Security headers + CSP.

**P1 — production hardening**
5. Contract read/write via wagmi/viem + the CitrateForwarder contract (gasless).
6. Live DAG WSS stream; indexer `token_transfers` + WS.
7. Settings/watchlist/API-key persistence wired to routes.
8. SEO (SSR entity pages), error boundaries, monitoring, `/api/health`.

**P2 — quality + scale**
9. Accessibility pass + axe/Lighthouse CI gate.
10. Dev API completeness + key-gating + rate-limit + MCP JSON-RPC.
11. CI build/test workflow; deploy automation; provisioning (Neon/Privy/inference/indexer host).

## Bottom line
CitrateScan is a beautiful design on top of a genuinely real read backend, with
a clean honest-stub discipline. The path to production is **wiring + a compliance/
ops layer**, not a rewrite. The plan sequences it so the app is demoable to the
team after P-2 (live reads + live agent) and production-deployable after P-9.
