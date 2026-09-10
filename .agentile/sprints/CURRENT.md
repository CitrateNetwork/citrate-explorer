---
created: 2026-06-02T00:00:00Z
branch: citratescan-production-planset
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CURRENT — Status

## Shipped
| Item | Status |
|---|---|
| S-0 Bootstrap | ✅ merged to main |
| S-1 Indexer + AI foundation | ✅ merged to main (live RPC reads, indexer, AI agent backend, hybrid crypto, TLA+ spec) |
| CitrateScan UI (design handoff port) | ✅ merged to main — the product UI, on sample data |
| P-0 providers + auth seam (OIDC RP) | ✅ merged to main |
| P-1 wire live reads | ✅ merged to main (tx/address/chain/agent live) |
| P-5 live DAG stream | 🔄 in review — `/api/dag/stream` SSE (real RPC polling), DAG view + mini-strip + home latest wired to live; FINDINGS-001 RESOLVED on RPC |
| P-2 live AI agent | ✅ merged to main |
| P-3 legal + consent (GDPR/CCPA) | ✅ merged to main |
| P-4 contract read/write + verify (gasless rail) | ✅ merged to main (forwarder built+tested; deploy gated — HANDOFF-P4) |
| P-6 settings + persistence (E2EE) | ✅ merged to main |
| P-7 dev API + keys + MCP | ✅ merged to main (#10) — Etherscan-compat `/api/v1`, hashed API keys, JSON-RPC MCP server at `/api/mcp` |
| P-8 production hardening | ✅ merged to main (#11) — CSP/security headers, Upstash-backed rate limiter, `/api/health`, robots/sitemap/OG, a11y |
| P-5 live DAG stream | ✅ merged to main (#12) — `/api/dag/stream` SSE, DAG view + mini-strip + home latest live; FINDINGS-001 RESOLVED |
| P-9 deploy | ✅ **LIVE** — https://citrate-explorer.vercel.app (Vercel prod, GitHub auto-deploy), Neon `citratescan` migrated, prod env set, `/api/health` green. Pending: indexer worker on a DO droplet (INDEXER_DROPLET_HANDOFF.md on citrate-labs trunk) + custom domain `explorer.citrate.ai` (owner). |

## Next plan (planned — documented, not yet kicked off)
**[`planset/2026-06-08-citratescan-research-agent-v1/PLANSET.md`](../planset/2026-06-08-citratescan-research-agent-v1/PLANSET.md)**
— take the "Ask CitrateScan" agent from *working* to *wow* (fast + reads the chain
well + connects logic) for newcomers and natives **without requiring a tx hash**.
One comprehensive planset, **eval-first**: RA-1 eval harness + golden benchmark +
Gemma baseline → RA-2 thin slice (hash-free "30k SALT" value query) → RA-3 full
indexed value/transfer backbone → RA-4 research tool suite (one shared registry) →
RA-5 Citrate knowledge pack + system prompt → RA-6 reasoning + clarifying questions
+ tables → RA-7 MCP resources/prompts → RA-8 **Citrate-expert LoRA** on Gemma
(registered on-chain in LoRAFactory, served via gateway). Decisions:
[`ADR-001`](../planset/2026-06-08-citratescan-research-agent-v1/ADR-001-small-model-lora-strategy.md)
(small-model+LoRA strategy),
[`ADR-002`](../planset/2026-06-08-citratescan-research-agent-v1/ADR-002-value-transfer-backbone.md)
(value/transfer backbone),
[`ADR-003`](../planset/2026-06-08-citratescan-research-agent-v1/ADR-003-one-tool-registry.md)
(one shared tool registry). Gap analysis:
[`EVALUATION.md`](../planset/2026-06-08-citratescan-research-agent-v1/EVALUATION.md).
Detailed RA-1 plan:
[`sprints/RA-1-eval-harness.md`](../planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-1-eval-harness.md).

## Active plan
**[`sprints/active/2026-06-04-settings-realization.md`](active/2026-06-04-settings-realization.md)**
(plan: [`planset/2026-06-04-settings-realization-v1/PLANSET.md`](../planset/2026-06-04-settings-realization-v1/PLANSET.md))
— make every Settings surface real + honest and re-key per-user data to the stable
OIDC `subject` ahead of the Web2/Privy-like portal. **SR-1/SR-0/SR-2/SR-3 done**
(branch `settings-realization`, 96 tests, typecheck+lint clean); ships via the
gated migration+deploy runbook in the sprint file. SR-4..6 (Security panel) is a
`citrate-identity` federation follow-up. Auth OIDC cutover to `auth.citrate.ai` is
**LIVE** (PR #33 merged; prod on `explorer.citrate.ai`).

**Hotfix (2026-06-13) — FUA-EXPLORER-04b:** fresh sign-in was failing with
"session cookie could not be set" because `POST /api/auth/session` required the
**access token** to be a JWT, but the authority issues **opaque** access tokens.
Fixed by accepting opaque tokens (`looksLikeOpaqueToken`); branch
`fix/explorer-session-cookie-opaque-access-token`, suite 230→232. See
`audits/2026-06-13-fua-explorer-04b-opaque-access-token.md`.

**Feature (2026-06-13) — TD-9 refresh-token renewal:** silent, rotating refresh so
sessions outlive the 1h id token (re-login only after the 14d refresh token
expires/revokes). `login()` requests `offline_access`+`prompt=consent`; refresh
token stored in a 3rd httpOnly cookie; new `POST /api/auth/refresh` swaps it
(rotated) via discovery; client schedules refresh ~60s pre-exp + on tab-focus;
logout revokes. Branch `feat/explorer-refresh-token-renewal`, suite 232→244. See
`audits/2026-06-13-td9-refresh-token-renewal.md`. **TD-9 discharged.**

Prior plan —
**[`planset/2026-06-03-citratescan-production-v1/PLANSET.md`](../planset/2026-06-03-citratescan-production-v1/PLANSET.md)** —
take CitrateScan to a world-class, GDPR-compliant, deployed release by wiring the
design to the live backend (wagmi/viem), adding the legal/consent/ops layer, and
deploying. See [`EVALUATION.md`](../planset/2026-06-03-citratescan-production-v1/EVALUATION.md)
for the current-state gap and [`specs/features/`](../specs/features/README.md)
for the 347 BDD acceptance scenarios.

**SHIPPED.** CitrateScan is live in production at
**https://citrate-explorer.vercel.app** — Vercel (prod env set, `NEXT_PUBLIC_DEMO=0`,
GitHub auto-deploy on `main`), Neon `citratescan` migrated, `/api/health` green
(chain 40204, live DAG stream + `/api/v1` + MCP serving). Two items remain, both
external: (1) the always-on **indexer worker** on a DigitalOcean droplet — full
runbook at `INDEXER_DROPLET_HANDOFF.md` on the citrate-labs trunk; until it runs,
history/aggregate surfaces are empty but live-RPC reads work; (2) the custom
domain `explorer.citrate.ai` (owner points DNS at Vercel). Fast-follows: gasless
writes (deploy forwarder + fund relayer, HANDOFF-P4), App Router per-entity SSR
URLs, Sentry APM.

**Deferred from P-8 (own follow-ups, by design):** the hash-route → App Router
per-entity SSR migration (deep WP-8.2 — changes every entity URL; isolated so it
can't regress the pixel-perfect port), Sentry APM wiring at the app boundary
(structured-log substrate + `/api/health` shipped), and an axe/Lighthouse CI gate
(needs a headless browser in CI).

```
P-0 providers+auth → P-1 wire reads → P-2 live agent  ──► DEMO-READY
   ├ P-3 legal+consent (EU-safe)  ├ P-4 contract read/write (wagmi/gasless)
   ├ P-5 live DAG stream  ├ P-6 settings/persistence  ├ P-7 dev API+MCP
   └ P-8 hardening (CSP/SEO/a11y/monitoring) → P-9 deploy ──► PRODUCTION
```

The earlier `2026-06-02-citrate-explorer-v1` feature sprints (DAG viz, verification,
read/write, dev API) are folded into P-3…P-7.
