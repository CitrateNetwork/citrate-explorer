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
