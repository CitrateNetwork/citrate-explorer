---
created: 2026-06-13T07:31:22Z
branch: feat/explorer-refresh-token-renewal
author: Claude Opus 4.8 (1M context) + Saul Loveman
sprint: SECREM-02-followup-remediation
status: active
repo: citrate-explorer
baseline_test_count: 232
---

# TD-9 — refresh-token renewal (silent, rotating)

> Discharges the open follow-up "token TTL 1h, no silent refresh" (TD-9). New
> dated record (Rule 6/12); does not edit prior immutable logs.

## Problem

Explorer OIDC sessions had a 1h id-token TTL and no refresh, forcing re-login
hourly. The authority (`citrate-identity`) was already refresh-capable for the
`citrate-explorer` client (`refresh_token` grant, `offline_access` scope,
`rotateRefreshToken: true`, RefreshToken TTL 14d) — the explorer simply never
requested a refresh token.

## Pre-implementation live findings (auth.citrate.ai)

- `offline_access` alone is **silently dropped** (granted scope `openid profile
  wallet`, no refresh_token). OIDC spec: `offline_access` requires
  **`prompt=consent`**.
- With `prompt=consent` the trusted first-party client **auto-consents** (no
  visible screen) and a `refresh_token` is issued.
- `grant_type=refresh_token` returns a fresh `id_token` + a **rotated**
  `refresh_token`.

## Implementation (explorer-only; authority unchanged)

| Area | Change |
|---|---|
| Login (`src/lib/auth/client.tsx`) | `login()` appends `offline_access` (dedupe) + sets `prompt=consent`. |
| Callback (`src/app/auth/callback/page.tsx`) | Forwards `refresh_token` to `POST /api/auth/session`. |
| Cookies (`src/lib/auth/cookies.ts`) | New `REFRESH_COOKIE` (`citrate_oidc_refresh`) + `REFRESH_MAX_AGE` (14d). httpOnly/SameSite=Strict/Secure like the others. |
| Session route (`src/app/api/auth/session/route.ts`) | POST stores the opaque refresh token (14d cookie); GET returns id-token `exp`; DELETE clears the refresh cookie **and best-effort revokes it** at the authority `revocation_endpoint`. |
| New route (`src/app/api/auth/refresh/route.ts`) | `POST` swaps the refresh cookie for fresh tokens via the discovered `token_endpoint`; re-sets all three (rotated) cookies; `401`+clear on reject, `503` (session kept) on authority blip. |
| Pure helper (`src/lib/auth/refresh.ts`) | `buildSessionCookies()` / `cookieMaxAge()` — unit-testable cookie transform. |
| Server discovery (`src/lib/auth/discovery.server.ts`) | `token_endpoint` / `revocation_endpoint` from `/.well-known/openid-configuration` (no hardcoded paths). |
| Client schedule (`src/lib/auth/client.tsx`) | Silent refresh ~60s before `exp`, **plus refresh-on-visibility** (mobile timers throttle while backgrounded — the phone case). Rotation chains via the returned `exp`. |

The id token stays JWKS-verified per request (`verifySession`); the refresh token
is opaque and never reaches page script. Logout revokes it so a 14d token cannot
outlive sign-out.

## Tests + gates

- Suite **232 → 244** (222 pass / 22 skip), Rule 3 satisfied. Typecheck + lint
  clean; `next build` clean (`/api/auth/refresh` registered).
- New/updated: `cookies.test.ts` (refresh cookie 14d + `looksLikeOpaqueToken`),
  `session/route.test.ts` (3rd cookie on POST, `exp` on GET, refresh cleared on
  DELETE, malformed refresh → 400), `refresh.test.ts` (pure builder + maxAge),
  `refresh/route.test.ts` (no-cookie → 401, cross-site → 403, dead token never
  200). Network success path covered by the live curl e2e.

## Durable lesson

`offline_access` is gated behind `prompt=consent` even for trusted auto-consent
clients — requesting the scope without the prompt silently yields no refresh
token (no error). Always assert the *granted* scope / presence of `refresh_token`,
not just what was requested.
