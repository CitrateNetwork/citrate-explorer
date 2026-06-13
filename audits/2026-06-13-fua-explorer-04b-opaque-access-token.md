---
created: 2026-06-13T05:15:30Z
branch: fix/explorer-session-cookie-opaque-access-token
author: Claude Opus 4.8 (1M context) + Saul Loveman
sprint: SECREM-02-followup-remediation
status: active
repo: citrate-explorer
baseline_test_count: 230
---

# FUA-EXPLORER-04b — opaque access token rejected by the session route

> Regression in the FUA-EXPLORER-04 httpOnly-cookie migration (audit
> `2026-06-13` does NOT edit the immutable log `2026-06-09-followup-remediation-log.md`,
> Rule 6 — this is a new dated record).
> Protocol: re-verify (live) → red test → fix → suite green (count ↑) → mutation.

## Symptom

Every fresh OIDC sign-in on **explorer.citrate.ai** fails with
*"Sign-in failed: session cookie could not be set"* (reported on mobile; actually
platform-independent). Reported by the owner 2026-06-12.

## Root cause

`POST /api/auth/session` (added by FUA-EXPLORER-04, commit `f0f1b9b`) validated the
`access_token` with `looksLikeJwt()` and returned `400 "access_token must be a JWT"`
when it failed. But the Citrate authority (panva `oidc-provider`) issues **opaque**
access tokens by default — there is no `formats.AccessToken: 'jwt'` in
`citrate-identity/src/config.ts`. So the OIDC callback's `set.ok` was always false
on the access-token branch → it threw the user-visible error. The id_token (a JWT)
was fine; only the access-token validation was wrong.

The bug shipped because the unit test `route.test.ts` *encoded* the wrong behavior
(asserted `access_token: "junk"` → 400), so CI was green.

### Live confirmation (throwaway password user, prod)

```
access_token = "qDcR8Uz1Kisfn5q5PIDS4k0zCugIfIWHUpZdnDuLUDA"  # 43 chars, opaque, NOT a JWT
POST https://explorer.citrate.ai/api/auth/session {id_token, access_token} → 400 "access_token must be a JWT"
POST https://explorer.citrate.ai/api/auth/session {id_token}              → 200 {"ok":true} + Set-Cookie
```

## Fix

| Finding | Sev | Red test(s) | Fix (file) | Suite (≥230?) | Mutation | Disposition |
|---|---|---|---|---|---|---|
| FUA-EXPLORER-04b | High (sign-in down) | `route.test.ts` → "accepts an OPAQUE access token …" (RED pre-fix: opaque token → 400) | New `looksLikeOpaqueToken()` (RFC 6749/6750 token charset, bounded size) in `src/lib/auth/cookies.ts`; `POST /api/auth/session` validates the access token with it instead of `looksLikeJwt` — `src/app/api/auth/session/route.ts`. id_token stays `looksLikeJwt`. | 232 (210 pass / 22 skip) ✓ | revert access-token guard to `looksLikeJwt` → new opaque-accept test FAILS | **FIXED** |

The access token is still stored in its httpOnly cookie (needed for the
`DELETE` → authority `/logout` cascade and future `/userinfo`/KYC reads). The
authority was **not** changed — opaque access tokens are standard and correct.

## Notes
- Baseline pre-fix: **230** (208 pass / 22 skip). Post-fix: **232** (210 / 22).
  Rule 3 ratchet satisfied (count up). Typecheck + lint clean.
- Durable lesson: the OAuth **access token is opaque to the client by design**
  (RFC 6749). Never require JWT shape on an access token; only the id_token (the
  verified session credential) is a JWT. A test that asserts the buggy behavior
  hides the bug — pin behavior to the real token shape (Rule 11, no mocks).
