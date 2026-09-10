---
created: 2026-06-03T00:00:00Z
branch: citratescan-production-planset
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CitrateScan — BDD feature specs

The behavioural source of truth for CitrateScan's path to a world-class,
production-ready release. **347 scenarios across 17 features.** The production
planset [`2026-06-03-citratescan-production-v1`](../../planset/2026-06-03-citratescan-production-v1/PLANSET.md)
executes against these; the [`EVALUATION.md`](../../planset/2026-06-03-citratescan-production-v1/EVALUATION.md)
explains the current-state gap.

## Tag legend

**Status** (where the capability stands today):
- `@wired` — frontend + backend both done (19). Example: the live ChainBadge.
- `@backend-ready` — the `/api/*` route is real, but the scan UI is not wired to it (123).
- `@todo` — neither exists yet (207).

**Sprint** — `@P-0` … `@P-9`, the production sprint that delivers the scenario.

**Topic** — `@gdpr` `@a11y` `@security` `@wagmi` `@gasless` `@auth` `@mobile`.

## Features

| File | Covers | Lead sprint(s) |
|---|---|---|
| `app-shell.feature` | header, logo, omni-search, ⌘K palette, ChainBadge, banners, **footer** | P-1, P-3 |
| `authentication.feature` | real Privy login/logout, header identity, session, auth-gating | P-0 |
| `home.feature` | hero, prompt chips, DAG mini-strip, latest blocks/txns | P-1 |
| `search.feature` | omni-search resolution, NL→agent | P-1 |
| `transaction.feature` | the "Explain this tx" marquee, tabs, error/stuck copilots | P-1, P-2 |
| `entity-pages.feature` | block / address / token pages | P-1 |
| `live-dag.feature` | GHOSTDAG viz, WSS stream, linear/a11y fallback | P-1, P-5 |
| `contracts.feature` | read (`useReadContract`), write (`useWriteContract`), **gasless EIP-2771**, verification | P-4 |
| `ai-agent.feature` | Ask-CitrateScan drawer → `/api/chat`, tool traces, cited answers | P-2 |
| `developer-api.feature` | Etherscan-compat `/api/v1`, API keys, MCP server | P-6, P-7 |
| `data-privacy-storage.feature` | hybrid encryption, export, erasure | P-6 |
| `cookie-consent-gdpr.feature` | region-aware consent banner, GDPR/CCPA | P-3 |
| `legal-pages.feature` | /privacy, /terms, /cookies, footer, security.txt | P-3 |
| `settings.feature` | every settings section wired to a real backend | P-0, P-3, P-6 |
| `reliability-states.feature` | loading / empty / error / not-found / offline | P-1, P-8 |
| `accessibility.feature` | WCAG 2.1 AA, keyboard, DAG a11y, axe CI | P-8 |
| `production-platform.feature` | CSP/headers, SEO/OG, rate-limit, monitoring, deploy | P-8, P-9 |

## How to use
Each scenario is a unit of acceptance for its sprint's work packages. When a
sprint closes, its scenarios should move `@todo`/`@backend-ready` → `@wired`.
The status-tag counts are a release burndown: **production-ready = 0 `@todo`
and 0 `@backend-ready` on launch-blocking features** (auth, reads, agent,
consent/legal, contracts, reliability, platform).
