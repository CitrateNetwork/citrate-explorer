---
created: 2026-06-10T00:00:00Z
branch: audit/secrem02-explorer-oidc
author: Fable 5 (Claude Code)
sprint: SECREM-02-followup-remediation
status: active
repo: citrate-explorer
baseline_test_count: 196
---

# citrate-explorer — SECREM-02 Remediation Log

> Coverage matrix: `citrate-security/planset/2026-06-10-followup-remediation.md`.
> Protocol: re-verify → red test → fail-closed fix → suite green (count ≥ baseline)
> → mutation pass → row complete.

## Phase 1 — OIDC consumer (relying-party) side

| Finding | Sev | WP | Red test(s) | Fix (file) | Suite (≥196?) | Mutation | Disposition |
|---|---|---|---|---|---|---|---|
| FUA-EXPLORER-01 | Med | 1.4 | `session.oidc.test.ts` → "FAILS CLOSED when OIDC_AUDIENCE/ISSUER unset" | `verifyOidc` now requires `OIDC_ISSUER`+`OIDC_AUDIENCE` via `requiredOidcConfig()`, fails closed (rejects all tokens, logs once) when either is missing — never passes `undefined` to `jwtVerify` — `src/lib/auth/session.ts` | 198 (176 pass / 22 skip) ✓ | killed (revert to `\|\| ""` silent-skip → both new tests FAIL) | **FIXED** |
| WEB-1 | High | 1.5 | `session.web1.test.ts` + `resolveServerAuthMode` matrix | Already fixed under SECREM-01: `resolveServerAuthMode` defaults to `oidc`, disables `mock` in production unless `ALLOW_MOCK_AUTH=1` — `src/lib/auth/session.ts` | — | — | **FIXED-VERIFIED (prior)** |

## Notes
- Baseline (Phase 0): **196** total (174 pass / 22 skip), `vitest run`. Post-fix: **198** (176 / 22). Rule 3 ratchet satisfied (count up).
- Typecheck clean (`tsc --noEmit`).
- Mutation: reverting `requiredOidcConfig` to the old fail-open behavior makes the two new red tests fail → property is tested. Stryker automation = Phase-8 follow-up.
- Semgrep tripwire (`process.env.X || undefined` into a security decision) = Phase 8.
- Branch: `audit/secrem02-explorer-oidc`.

## Phase 7 — Token storage + CSP (WP 7.1, 2026-06-11, branch `audit/secrem02-tokens-csp`)

| Finding | Sev | WP | Red test(s) | Fix (file) | Suite (≥205?) | Mutation | Disposition |
|---|---|---|---|---|---|---|---|
| FUA-EXPLORER-04 (tokens) | Med | 7.1 | `src/lib/auth/token-storage.guard.test.ts` (3 tests, all RED pre-fix: localStorage held `citrate.auth.oidc.idtoken`/`accesstoken`) | OIDC id/access tokens moved to **httpOnly SameSite=Strict cookies** (`citrate_oidc_id`, `citrate_oidc_access`) set/cleared server-side by new `src/app/api/auth/session/route.ts` (POST set / GET hydrate / DELETE logout+authority-/logout); cookie plumbing in `src/lib/auth/cookies.ts`; `verifySession` gained `tokenFromRequest` (Authorization header wins, cookie fallback) in `src/lib/auth/session.ts`; client adapter `src/lib/auth/client.tsx` no longer touches web storage for tokens (`getToken()` → null in oidc mode; session state hydrates from GET /api/auth/session); callback `src/app/auth/callback/page.tsx` POSTs tokens to the session route | 230 (208 pass / 22 skip) ✓ | killed (re-added `localStorage.setItem("citrate.auth.oidc.idtoken", …)` to callback → 2 guard tests FAIL; restored) | **FIXED** |
| FUA-EXPLORER-04 (CSP) | Med | 7.1 | `src/lib/security/csp.guard.test.ts` (4 tests, all RED pre-fix: static next.config CSP with `script-src 'self' 'unsafe-inline'`, no proxy) | Nonce-based CSP: per-request nonce minted in new `src/proxy.ts` (Next 16 proxy), policy built in new `src/lib/security/csp.ts` — `script-src 'self' 'nonce-…' 'strict-dynamic'`, **no `'unsafe-inline'`**; CSP removed from `next.config.ts` (static header can't carry a nonce; other headers stay); inline theme-bootstrap script in `src/app/layout.tsx` carries the nonce via `x-nonce` header (forces dynamic rendering — required for nonce'd CSP) | 230 ✓ | killed (re-added `'unsafe-inline'` to script-src in csp.ts → 2 guard tests FAIL; restored) | **FIXED** |

### Token-storage sites located (Phase 7 step 2)
1. `src/lib/auth/client.tsx:137` — `localStorage.getItem(OIDC_TOKEN_KEY)` (id token read) → **migrated** (cookie; key removed)
2. `src/lib/auth/client.tsx:171-172` — `localStorage.removeItem(OIDC_TOKEN_KEY/OIDC_ACCESS_KEY)` (logout) → **migrated** (DELETE /api/auth/session clears cookies server-side)
3. `src/lib/auth/client.tsx:181` — `localStorage.getItem(OIDC_ACCESS_KEY)` (authority logout) → **migrated** (server makes the authority /logout call from the httpOnly access cookie)
4. `src/app/auth/callback/page.tsx:54-55` — `localStorage.setItem` id + access tokens → **migrated** (POST /api/auth/session)
5. ALLOWED (documented, not tokens): PKCE `verifier` + CSRF `state` in sessionStorage (one-shot flow artifacts, consumed and removed by the callback); mock adapter `citrate.auth.mock` dev identity (not an authority credential; mock is hard-disabled in production per WEB-1); `citrate.tweaks` theme + consent prefs (non-auth).

### Notes
- Baseline: **205** total (183 pass / 22 LIVE_RPC-skip). Post-fix: **230** (208 / 22), +25. Ratchet satisfied.
- Final CSP (per request): `default-src 'self'; script-src 'self' 'nonce-<rnd>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' <rpc/ws/oidc[/privy] from env>; frame-src 'self' [privy]; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`.
- Documented residual: `style-src 'unsafe-inline'` remains — the design uses inline `style=` ATTRIBUTES + a dynamic `--accent` custom property; nonces cannot apply to style attributes. Style injection ≠ script execution; the script-src lockdown is the XSS-relevant half. Not silent: asserted in csp.ts doc + this log.
- CSRF posture for the cookie migration: SameSite=Strict on both cookies + Sec-Fetch-Site rejection on the mutating session-route verbs. API consumers keep their conditional `Authorization` headers (mock mode still uses them; oidc `getToken()` returns null → cookie auth).
- Typecheck clean; `next build` green (proxy registered, all pages dynamic); lint: 1 pre-existing unrelated warning.
- WP 1.4/1.5 invariants intact: `session.oidc.test.ts`, `session.web1.test.ts`, `resolveServerAuthMode` matrix all green.
