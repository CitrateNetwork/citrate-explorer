---
created: 2026-06-21T00:00:00Z
branch: remediation/fwa-2026-06
author: RM-MISC/explorer remediation agent (Claude Opus 4.8 1M)
audit_id: 2026-06-20-federation-wide-audit
status: active
---

# FWA Remediation Log — citrate-explorer (FWA-C12-03 / 04 / 05)

Remediation under the Agentile-Audit Standard v0.2, red-test-driven close-gate
protocol. Scope: the three MEDIUM contract-verification / web-perimeter findings
owned by this agent (the supply-chain C12-01/02 are owned separately).

- **Audit source:** `citrate-security/audits/2026-06-20-federation-wide-audit/per-chunk/FWA-C12/REPORT.md`
- **Repo HEAD at remediation start:** `d1c694dabe66bc175e901af4f84b5bfa394582cb` (main)
- **Test ratchet:** 244 (222 run + 22 skipped) → **273 (251 run + 22 skipped)**, +29, monotone non-decreasing. `npx tsc --noEmit` clean. Lint: 0 errors.
- **Tripwire ratchet:** 6 → 8 Semgrep rules.

---

## FWA-C12-03 — Contract-verify compiles untrusted Solidity in-process (MEDIUM) — CLOSED

Smallest-robust in-repo fix (a full microVM/Vercel-Sandbox is the documented
follow-up, WS-2b): bound the untrusted input BEFORE it reaches the in-process
solc compiler, and pin the compiler-version string (an outbound-fetch sink).

- **RED → GREEN evidence:**
  - `src/lib/verify/inputbound.test.ts` (7 tests) — compile-bomb fan-out, total-bytes,
    optimizer-runs blowup, `urls` out-of-band source, non-Solidity language, empty
    sources all REJECTED with `InputTooLarge`.
  - `src/lib/verify/engine.bomb.test.ts` (3 tests) — a 2000-source bomb and a
    `urls`-source are rejected by the engine **without invoking the compiler**
    (`compileSolidity` spy asserted not-called); a normal input still reaches solc.
  - `src/lib/verify/compile.test.ts` (4 tests) — version-shape guard rejects
    path-traversal / embedded-host / non-hex-commit version strings before any fetch.
- **Fix (files + LOC):**
  - NEW `src/lib/verify/inputbound.ts` (+128) — `boundStandardInput()` caps source
    count (64), total content bytes (2 MB), optimizer runs (1e6); rejects `urls`
    sources, non-Solidity, empty maps; env-overridable, fail-closed parsing.
  - `src/lib/verify/engine.ts` (~+15) — `buildInput()` runs `boundStandardInput()`
    on BOTH the standard-json and single-file paths before compile; `verifyContract`
    already turns the throw into a clean `fail` outcome.
  - `src/lib/verify/compile.ts` (~+10) — `resolveCompilerVersion()` pins the version
    to strict semver / semver+commit shapes before the soljson fetch.
  - `src/app/api/verify/route.ts` (comment) — header updated to record the bound.
- **Residual (documented, not a regression):** the compile still runs in-process
  (solc-js WASM, no host access). Moving it into a Vercel Sandbox microVM remains
  the deeper hardening, tracked as WS-2b — now narrowed to a defense-in-depth step
  since the compile-bomb / out-of-band-fetch surface is bounded.

## FWA-C12-04 — Spoofable rate-limit IP + per-instance concurrency cap (MEDIUM) — CLOSED

Two parts: (a) identity must come from a trusted hop, not a raw client header;
(b) the concurrent-compile cap must be GLOBAL, not per-instance.

- **RED → GREEN evidence:**
  - `src/lib/api/clientip.test.ts` (5 tests) — a forged `x-real-ip` alone cannot set
    the bucket; forged left `x-forwarded-for` hops cannot rotate it; the trusted
    right-most hop wins; `x-real-ip` honored only under `CITRATE_TRUST_X_REAL_IP=1`;
    `CITRATE_TRUSTED_PROXY_HOPS=2` selects the 2nd-from-right hop.
  - `src/lib/api/keys.test.ts` (existing, strengthened) — now asserts raw `x-real-ip`
    is NOT trusted by default.
  - `src/lib/verify/concurrency.test.ts` (3 tests) — `CompileGate` enforces the cap
    GLOBALLY across two instances sharing one store; counter never goes negative;
    documented per-instance fallback when no shared store.
- **Fix (files + LOC):**
  - `src/lib/api/keys.ts` (~+30) — `clientIp()` rewritten to derive identity from the
    `CITRATE_TRUSTED_PROXY_HOPS`-th hop from the right of `x-forwarded-for`; raw
    `x-real-ip` only under explicit `CITRATE_TRUST_X_REAL_IP=1`; otherwise a single
    shared sentinel (`0.0.0.0`) — never a client-controlled value.
  - NEW `src/lib/verify/concurrency.ts` (+120) — `CompileGate` / `compileGateFromEnv`:
    Redis-backed INCR/DECR counter with a TTL self-heal when Upstash is configured,
    per-instance fallback otherwise; fail-open on store error.
  - `src/app/api/verify/route.ts` (~+12) — replaced the module-level `activeCompiles`
    counter with `compileGate.acquire()/release()`; corrected the stale "across
    instances" comment.
  - `src/app/api/verify/route.test.ts` — switched the test header to a trusted XFF hop.
- **SWEEP:** all SIX rate-limited endpoints (`/api/v1`, `/api/verify`, `/api/chat`,
  `/api/dag/stream`, `/api/mcp`, `/api/relay`) derive identity **only** through
  `clientIp()` — the single fixed point; no raw header read used as identity remains
  outside `keys.ts`. Fixing `clientIp()` covers the whole fleet at once. The
  concurrency cap applies to `/api/verify`, the only inline-compile endpoint.

## FWA-C12-05 — Partial match grants the "verified" badge (MEDIUM) — CLOSED

A partial (metadata-stripped) match must never be presented as "verified".
Centralized the badge decision so `verified: true` is granted only on a full match.

- **RED → GREEN evidence:**
  - `src/lib/verify/badge.test.ts` (4 tests) — `verificationBadge("partial")` is
    `verified:false` / `status:"partial-match"`; full is verified; null/none/unknown
    fail closed.
  - `src/app/api/contract/[addr]/route.test.ts` (3 tests) — the contract API returns
    `verified:false` + `status:"partial-match"` for a partial row, `verified:true`
    only for full, and fail-closed for a legacy null `matchType`.
- **Fix (files + LOC):**
  - NEW `src/lib/verify/badge.ts` (+60) — `verificationBadge(matchType)`: only `full`
    → `{verified:true,status:"verified"}`; `partial` → distinct `partial-match`
    (not verified); everything else fails closed.
  - `src/app/api/contract/[addr]/route.ts` (~+20) — derives the verification block via
    `verificationBadge()`; partial carries an explicit not-verified note + source.
  - `src/scan/screens/contract.tsx` — green shield only on `verified===true`; a
    distinct amber "partial match · not verified" badge + reference-only source panel
    for partial.
  - `src/scan/screens/verify.tsx` — verify result distinguishes `fullMatch`
    (green/"verified") from `partialMatch` (amber/"NOT verified") instead of treating
    any `pass` as verified.
- **SWEEP:** the only live sources of the contract verified-badge are the contract
  API route and the verify result screen — both now match-type-aware. The static
  demo-data harness `verified:true` (decoded-read indicator) is unrelated to a
  bytecode match and out of scope.

---

## Tripwires (permanent)

- `scripts/semgrep/no-client-header-as-ratelimit-id.yaml` (ERROR) — flags any
  `x-real-ip`/`x-forwarded-for` header read fed into a rate-limit/bucket key
  outside the sanctioned `clientIp()` helper (FWA-C12-04).
- `scripts/semgrep/no-partial-match-verified.yaml` (ERROR, 2 rules) — flags
  `verified:true` derived from mere match-row presence, and any "partial" match-type
  mapped to a verified status, outside `badge.ts` (FWA-C12-05).
- Both YAML rules validated for syntax; wired into the existing `scripts/semgrep/`
  set consumed by `.github/workflows/tripwires.yml`.
- **BLOCK:** the `semgrep` binary is not installed locally, so the rules were not
  executed against the tree here — validated by YAML parse + the existing CI job
  runs them. The 30 vitest tests are the hard floor; Semgrep is the AST-grade upgrade.

## Mutation (manual sampling — Stryker not configured in this repo)

8 mutants seeded on the touched decision functions; **8/8 killed**:

| # | Function (file) | Mutation | Killed by |
|---|-----------------|----------|-----------|
| M1 | `verificationBadge` partial branch | partial → `verified:true` | badge + contract-route tests |
| M2 | `verificationBadge` fallback | null/unknown → `verified:true` | badge tests |
| M3 | `clientIp` opt-in guard | honor raw `x-real-ip` unconditionally | clientip test |
| M4 | `clientIp` hop index | use left hop (idx 0) | clientip + keys tests |
| M5 | `boundStandardInput` maxSources | skip the count check | inputbound test |
| M6 | `boundStandardInput` urls reject | allow `urls` sources | inputbound test (strengthened) |
| M7 | `CompileGate.acquire` cap | never refuse | concurrency tests |
| M8 | `resolveCompilerVersion` guard | drop the version-shape check | compile test |

**BLOCK:** no JS/TS mutation framework (Stryker) is configured in this repo, so the
≥90% target is met by manual mutant sampling on the touched decision functions
rather than an automated campaign.

## Honesty / ratchet

- Test count monotone non-decreasing: 244 → 273. No existing test weakened — the
  `keys.test.ts` change is a STRENGTHENING (raw `x-real-ip` is now correctly
  asserted untrusted by default), consistent with the corrected trust model.
- `npx tsc --noEmit` exits 0; `pnpm lint` 0 errors.
