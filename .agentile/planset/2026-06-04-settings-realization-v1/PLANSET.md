---
created: 2026-06-04T00:00:00Z
branch: settings-realization
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# PLANSET — Settings Realization (v1)

Bring **every** control and claim in the Settings surface to life with a real
backend. The directive (from the architect, 2026-06-04): *"all UI needs to be
real… no UI should be removed… bring it all to life properly."* This planset is
the response. It supersedes nothing in
[`2026-06-03-citratescan-production-v1`](../2026-06-03-citratescan-production-v1/PLANSET.md);
it completes the P-6 "settings & persistence" surface to the Rule-11 bar.

## Why this exists (the audit that triggered it)

After the OIDC cutover (auth.citrate.ai live; PR #33 merged; prod on
`explorer.citrate.ai`), a settings review found the server **secure** (every route
auth-gated + per-user scoped, no IDOR, keys salted-hashed, messages sealed, GDPR
erasure complete) but the **UI dishonest** in four places — a Rule-11 violation
for a product whose differentiator is transparency:

| # | Finding | Reality today | Severity |
|---|---|---|---|
| F-1 | Watchlist "stored end-to-end encrypted" | `watchlist.target` stored **plaintext** | 🔴 false security claim |
| F-2 | "Settings & logins → E2EE, syncs across devices" | `/api/settings` E2EE store is **orphaned**; appearance prefs are localStorage-only | 🔴 false sync claim |
| F-3 | Security panel: "2 devices · macOS/iOS", "Passkeys 1 enrolled", "Connected wallets" + Manage/Revoke | **hardcoded mock**, dead buttons | 🟠 fabricated state |
| F-4 | Transparency provenance: License "MIT", commit `9f4a2e1`, modelHash `0x4a7c…r12`, repo `citrate/citrate-explorer` | wrong/fake (actual: Apache-2.0, real commit, org **CitrateNetwork**) | 🟠 false provenance |

Plus F-5 (hygiene): `src/scan/screens/settings.tsx` is `@ts-nocheck` +
`eslint-disable` — no type safety on the screen we're now making load-bearing.

## North star
Every row in Settings reflects a **real data source** (Rule 7 tracing below), and
every security claim in the Privacy table is **literally true**. Nothing is
deleted to achieve honesty — we build the backend up to the UI, not trim the UI
down to the backend.

## What's explorer-local vs. cross-repo

The authority (`citrate-identity`, live at `auth.citrate.ai`) today exposes:
standard OIDC (`/auth`, `/token`, `/me`, `/jwks`, introspection, revocation,
`/session/end`), plus custom `POST /logout`, `GET /sessions/events` (SSE), `/siwe/*`,
`/consent/approve`, `/kyc/*`, `/health`. It does **not** expose: list-my-sessions,
WebAuthn/passkey management, or connected-wallet management. Therefore:

- **SR-1, SR-2, SR-3** are **explorer-local** — shippable now, no authority change.
- **SR-4, SR-5, SR-6** are **federation sprints** (new `citrate-identity`
  endpoints + explorer wiring). Because `auth.citrate.ai` is **live infra**, every
  authority deploy follows the same gated-cutover discipline we used for PR #33
  (verify → deploy authority → wire explorer → smoke). Tracked via a federation
  sprint file in `citrate-federation` per AGENTILE.md.

## ⚠️ Identity model — REVISED 2026-06-04 (architect directive)

> **EW-S1 alignment (confirmed via `handoffs/EMBEDDED_WALLET_SPRINT_HANDOFF.md`,
> 2026-06-05):** the replacement is a **multi-method OIDC issuer** (email/password,
> Google, **WebAuthn passkey**, SIWE-for-power-users) that **auto-creates an
> ERC-4337 smart wallet at signup**, one address per user (CREATE2 from the user
> id), with **modular validators** (passkey P-256 / EOA secp256k1 / guardian).
> **Privy is removed from the roadmap entirely** — drop all "Privy" framing below.
> Today's deployed auth still issues `sub = <wallet address>`; EW-S1 flips `sub` to
> a **stable user id** and makes `wallet_address` the smart-wallet address, and adds
> a `signing_method` claim. The additive `subject` design (SR-0) makes that flip a
> one-time re-home (old wallet-`sub` → new `sub`), and means **SR-0 is exactly the
> prep EW-S1 needs**. SR-4..6 (sessions/passkeys/wallets) is **EW-S1 territory** —
> coordinate, do not preempt `citrate-identity`.

The auth direction changed mid-planset: the team is replacing **SIWE/wallet-first**
login with a **multi-method OIDC + passkey-signed ERC-4337 smart wallet** (EW-S1;
no Privy) plus **full KYC** for binary downloads and financial operations.
Consequences that reshape this planset:

- **The principal is NOT a wallet address.** It is the stable OIDC `sub`. A user may
  have **no wallet** (email-only) or an embedded wallet provisioned lazily. Wallet
  becomes an **optional linked attribute** (for financial ops / receiving), not the
  identity and not the storage key.
- **Bug this exposes (already latent in prod):** every settings route scopes by
  `auth.walletAddress` and **401s without a wallet claim**. Under the new portal,
  email users would find *all settings broken*. The ownership key must move to `sub`.
- **E2EE key source must be provider-agnostic** (behind the auth seam): for a
  Privy-like provider the **embedded wallet signs invisibly** (no scary popup) →
  signature-derived key still works for everyone; for a truly wallet-less account,
  the fallback is **WebAuthn PRF** (passkey-derived key). The seam exposes
  `identity.getEncryptionKeyMaterial()`; SR-2/SR-3 never call wagmi/an external
  connector directly.
- **KYC-aware.** The ID token already carries `kyc_status`/`kyc_verified_at`/
  `kyc_expires_at` (confirmed in discovery `claims_supported`). The Account/Security
  panels surface **real KYC status**, and sensitive actions gate on it.

This adds a foundational **SR-0** (ownership-key migration) that must land **before**
SR-2/SR-3, and revises SX-1, SR-2, SR-3, SR-5 below.

## SR-0 — Ownership key: `wallet_address` → stable `subject` · explorer-local + migration
**Goal:** all per-user data is keyed by the stable identity (`sub`), with wallet as
an optional attribute — so email/social/passkey users work and a wallet rotation
never orphans data.
- **WP-0.1** Auth seam: `AuthSession` gains `subject` (the `sub` claim) as the
  canonical owner; `walletAddress` stays as optional metadata. `resolveUser()`
  across `settings|keys|watchlist|account|threads|audit` returns `subject`, not
  wallet; 401 only when unauthenticated (not when wallet-less).
- **WP-0.2** Schema: rename/add the owner column (`userAddress` → `subject`/`owner`)
  on `settings,api_keys,watchlist,threads,audit_log,provider_keys`; Drizzle
  migration with a backfill (existing wallet-keyed rows map via the authority's
  sub↔wallet mapping, or are re-homed on next authenticated load).
- **WP-0.3** Tests: a wallet-less session (sub only, no `wallet_address`) can
  read/write settings, keys, watchlist; ownership isolation by `sub` holds (no IDOR).
**Acceptance:** an email-only identity (no wallet claim) uses every settings surface;
data follows the `sub`, not the wallet. **This unblocks SR-2/SR-3.**

## Data-source tracing (Rule 7) — one row, one real source

| Settings row | Real data source | Storage class |
|---|---|---|
| Account: identity (`sub`), KYC status, linked wallet | OIDC ID-token claims (`sub`, `kyc_status`, `wallet_address?`) | session (no storage) |
| Appearance (theme/verbosity/motion) | localStorage **+** E2EE `/api/settings` sync | E2EE (class 1) |
| Watchlist | E2EE ciphertext in `watchlist` + keyed blind-index for alerts | E2EE (class 1) + HMAC index |
| API keys | `api_keys` (salted SHA-256 + pepper, copy-once) | hash (class 2) |
| Transparency: system prompt / tool allowlist | `buildSystemPrompt()` / harness allowlist (code) | static (real) |
| Transparency: audit log | `audit_log` (per-user) | server, deletable |
| Transparency: provenance (license/commit/model) | `/api/version` (build env + pkg) + gateway `/v1/models` + ModelRegistry | static/live read |
| Security: active sessions | **NEW** authority `GET /sessions` (panva session store) | authority |
| Security: connected wallets | **NEW** authority `GET /account/wallets` (SIWE links) | authority |
| Security: passkeys | **NEW** authority WebAuthn credential store | authority |

## Cross-cutting decisions

- **SX-1 One E2EE key, sign-once, provider-agnostic.** The class-1 key is derived
  once per tab session and held **in memory only** (never localStorage/sessionStorage).
  Settings sync and watchlist share it. The **key material comes from the auth seam**,
  not a hardcoded wallet path: `identity.getEncryptionKeyMaterial()` resolves to a
  signer's secret. **EW-S1 makes WebAuthn-PRF the PRIMARY source** (most users sign
  with a passkey-backed smart wallet, not an EOA `personal_sign`); an **EOA wallet
  signature** over `E2EE_KEY_MESSAGE` is the secondary path for power users.
  *Shipped today:* the EOA-signature path (works for the current SIWE/EOA user base);
  PRF lands with EW-S1's WebAuthn work and slots into the same seam.
  `crypto-client.deriveSettingsKey()` is salted by the **`sub`**, not the wallet. When no key source is available, the UI shows a real "unlock encrypted
  settings" affordance; wallet-less local use still works unencrypted on-device.
- **SX-2 Blind index for E2EE search.** Server-side alerting on an E2EE watchlist
  uses `blindIndex = HMAC-SHA256(serverPepper, normalizedAddress)`. The server can
  match on-chain activity to a blind index without ever reading the user's list and
  cannot enumerate it; the privacy copy discloses this tradeoff exactly.
- **SX-3 Honest unavailable states.** When the authority hasn't shipped an endpoint
  (SR-4..6 mid-rollout) or a wallet isn't connected, the panel shows a **real**
  state ("0 passkeys enrolled", "connect a wallet", "sessions unavailable") — never
  fabricated counts. No `alert()`-only buttons; every action hits a real route.
- **SX-4 Type safety restored.** Remove `@ts-nocheck`/`eslint-disable` from
  `settings.tsx`; type the new hooks. Lint/typecheck are CI ratchets.
- **SX-5 Ratchets hold.** Tests up (`coverage/baseline.json`), ≥1 spec touched,
  Rule-12 frontmatter on every new doc, tripwires intact.

---

## SR-1 — Real provenance (Transparency panel) · explorer-local
**Goal:** every provenance value is true and sourced.
**Features:** `settings.feature` (transparency provenance scenarios).

- **WP-1.1** `GET /api/version` — returns `{ version (package.json), commit
  (VERCEL_GIT_COMMIT_SHA), ref (VERCEL_GIT_COMMIT_REF), builtAt, repo, license }`.
  Pure env/file read; cached.
- **WP-1.2** Real agent-model provenance: server reads the gateway `GET
  {CITRATE_GATEWAY_URL}/v1/models` (the configured model id) and, when registered,
  the on-chain **ModelRegistry** hash via `eth_call`; honest "unregistered on
  ModelRegistry" state when the inference network is empty (chain-facts: listModels
  may be `[]`). Exposed through `/api/version` (or `/api/provenance`).
- **WP-1.3** Wire the panel: License **Apache-2.0**, repo
  `github.com/CitrateNetwork/citrate-explorer`, real commit/build, real model id +
  hash/state. Remove the literal fakes.
**Acceptance:** the Transparency provenance card matches `git rev-parse HEAD`,
`LICENSE`, and the live gateway model — verifiable by inspection. **Tests:**
`/api/version` shape + license/repo constants; a provenance render test.

## SR-2 — E2EE settings sync · explorer-local
**Goal:** appearance/preferences sync across devices, encrypted; the orphaned
`/api/settings` store becomes the source of truth (localStorage = device cache).
**Features:** `settings.feature`, `data-privacy-storage.feature`.

- **WP-2.1** `useSettingsKey()` — calls `identity.getEncryptionKeyMaterial()` (auth
  seam: embedded-wallet signature or WebAuthn PRF, SX-1) → `deriveSettingsKey`
  (salted by `sub`, in-memory). Exposes `{ key, unlock(), locked }`. No direct
  wagmi/external-connector calls.
- **WP-2.2** `useSyncedSettings()` — on unlock: `GET /api/settings` → `decryptSettings`
  → merge into the scan tweaks; on change: debounce → `encryptSettings` → `PUT
  /api/settings`. localStorage remains the no-flash device cache.
- **WP-2.3** Appearance UI: an "Encrypted sync: on/off (this device)" indicator +
  "Connect wallet to sync" when locked. No behavior change when wallet-less (still
  works locally).
**Acceptance:** change theme on device A (signed) → it appears on device B after
unlock; the server row is opaque ciphertext (cannot be read without the wallet).
**Tests:** encrypt→decrypt round-trip; merge precedence (server vs local); PUT body
is ciphertext only.

## SR-3 — E2EE watchlist + blind-index alerts · explorer-local + migration
**Goal:** watched addresses are genuinely E2EE, and the panel claim becomes true,
while server-side alerts still work.
**Features:** `settings.feature` (watchlist), `data-privacy-storage.feature`.

- **WP-3.1** Schema/migration: add `ciphertext`, `iv`, `blindIndex` to `watchlist`;
  keep `label` optional-plaintext only if the user opts out (default E2EE). Drizzle
  `db:generate` + migration; backfill plan for existing plaintext rows (re-encrypt
  on next authenticated load, or one-shot migrate-on-read).
- **WP-3.2** Route: `POST` accepts `{ciphertext, iv, blindIndex}` (server computes
  nothing about the address); `GET` returns ciphertext; `DELETE` by id, user-scoped.
  Server pepper for HMAC from env (`WATCHLIST_INDEX_PEPPER`), distinct from
  `API_KEY_PEPPER`.
- **WP-3.3** Client: encrypt target/label with the SX-1 key; compute `blindIndex`
  client-side via the same pepper? No — pepper is server-only, so the **alert
  matcher** runs server-side: store `blindIndex = HMAC(pepper, addr)` computed by a
  thin server helper that receives the address **only at write time** then discards
  it… ⚠️ that would let the server see the address at write. **Resolution:** compute
  the blind index from a *client-derived* keyed hash using a per-user index key
  derived from the same wallet signature (HKDF info `"watchlist-index-v1"`); the
  user shares only the derived **index key** with the alerts worker out-of-band? Too
  heavy. **Chosen design:** blind index = `HMAC(serverPepper, addr)` computed
  server-side at write, address sent over TLS but **never stored** (only the HMAC +
  the client ciphertext are persisted). This is "encrypted at rest, server sees
  plaintext transiently at write" — weaker than full E2EE. Document precisely; if
  the architect wants true zero-knowledge, fall back to **client-side alerts**
  (no blind index; the browser polls watched addresses) — captured as WP-3.5 option.
- **WP-3.4** Privacy-table copy: state the exact guarantee chosen in WP-3.3 (no
  overclaiming). Watchlist render decrypts client-side.
- **WP-3.5** (decision gate) — **RESOLVED: zero-knowledge.** Per the architect's
  "make it real E2EE", the blind index is **client-derived** (`deriveBlindIndexKey`
  → HMAC, key never sent to the server), so the server stores the blind index but
  cannot compute it for arbitrary addresses → it never learns the list. Consequence:
  **alerts are evaluated client-side** (the browser has the decrypted list); a
  server-side alert worker would require the user to opt into sharing the index key
  (future). Implemented in `crypto-client.ts` + the watchlist route/UI.
**Acceptance:** watchlist rows are ciphertext at rest; the list renders correctly
after unlock; the chosen alert path works and the UI claim matches it exactly.
**Tests:** encrypt/decrypt round-trip; blind-index determinism; route stores no
plaintext address (assert column null/absent).

## SR-4 — Security panel: active sessions · **federation** (citrate-identity)
**Goal:** real device/session list with working "Revoke" / "Revoke all".
**Features:** `settings.feature` (security/sessions); new
`identity:sessions.feature` in citrate-identity.

- **WP-4.1** (authority) `GET /sessions` — list the authenticated subject's active
  sessions from the panva/Redis session+grant store (id, created, lastActive,
  userAgent, ip-region). Bearer-gated like `/me`.
- **WP-4.2** (authority) `DELETE /sessions/:sid` and `POST /logout-all` — revoke one
  / all, publishing the existing `logout` bus event so the cascade (already wired in
  the explorer via `/sessions/events`) signs out those tabs.
- **WP-4.3** (explorer) Wire the Security → Active sessions card to `GET /sessions`;
  Revoke/Revoke-all call the new routes with the access token; live states.
**Acceptance:** signing in on a 2nd device shows 2 sessions; "Revoke all" ends them
and the open tab is signed out via the cascade. **Gated deploy** of the authority
change per SR cross-repo discipline.

## SR-5 — Security panel: linked wallets (financial ops, not login) · **federation**
**Goal:** real list of wallets linked to the identity; link/unlink. Post-SIWE-deprecation
a wallet is an **optional attribute for financial operations / receiving**, not the
auth method — the panel framing reflects that (primary = embedded wallet; users may
link external wallets). KYC tier gates linking for financial use.
- **WP-5.1** (authority) `GET /account/wallets` from SIWE-linked accounts;
  `POST /account/wallets` (SIWE link) + `DELETE /account/wallets/:addr` (unlink,
  with a guard against removing the last/primary).
- **WP-5.2** (explorer) Wire the card; "Add wallet" runs the SIWE link flow;
  primary wallet = the `wallet_address` claim.
**Acceptance:** linking a 2nd wallet shows both; unlink removes it; the claim
reflects the primary.

## SR-6 — Security panel: passkeys (WebAuthn) · **federation** (largest)
**Goal:** real passkey enrollment/list/remove.
- **WP-6.1** (authority) WebAuthn registration/assertion + credential store
  (new to `citrate-identity`); may warrant its **own** planset there.
- **WP-6.2** (explorer) Wire the passkeys card to enroll/list/remove; honest "0
  enrolled" until shipped (SX-3).
**Acceptance:** enrolling a passkey lists it; it can authenticate; remove works.
**Note:** if WebAuthn is out of near-term scope at the authority, the card shows the
**real** count (0) and an enroll CTA that links to the authority account page — real,
not fabricated — until WP-6.1 lands.

---

## Sequencing
```
SR-1 provenance (DONE) ─────────────────────────────► honesty win, shipped
SR-0 ownership-key (sub) ─► SR-2 settings-sync ─┐
                            └─► SR-3 watchlist-e2ee ┘  (SR-3 has decision gate WP-3.5)

SR-4 sessions ─► SR-5 linked-wallets ─► SR-6 passkeys  (federation; authority-first, gated deploys)
```
**SR-0 now precedes SR-2/SR-3** — E2EE keyed/scoped on a wallet is wrong under the
new portal. Land SR-0 (and ideally before the new auth portal ships, so email users
don't hit broken settings). Open the federation sprint for SR-4..6 in
`citrate-federation`, authority-first. SR-6 (WebAuthn) also provides the PRF key
source SX-1 wants for wallet-less E2EE — so SR-6 and SR-2 are linked.

## Definition of done
- Every Settings row maps to a real source in the Rule-7 table above; **zero**
  hardcoded/mock values remain in `settings.tsx`.
- Every Privacy-table security claim is literally true (E2EE where it says E2EE,
  with the exact guarantee disclosed).
- `settings.tsx` typechecks without `@ts-nocheck`; lint clean.
- Four ratchets hold (tests up, ≥1 spec, tripwires, frontmatter).
- Authority changes (SR-4..6) deployed via the gated cutover discipline and smoked
  on `auth.citrate.ai` + `explorer.citrate.ai`.

## Risks
| Risk | Mitigation |
|---|---|
| E2EE requires a connected signer the user may not have | SX-1 honest "connect wallet" state; wallet-less still works locally |
| Blind-index weakens the E2EE promise (server sees addr at write) | SX-2 disclose exactly; WP-3.5 offers a zero-knowledge client-alert variant |
| Authority changes touch live `auth.citrate.ai` | gated cutover per PR-#33 discipline; verify→deploy→wire→smoke |
| WebAuthn is a large authority sub-project | SR-6 may spin its own citrate-identity planset; explorer shows real 0-state meanwhile |
| Existing plaintext watchlist rows | WP-3.1 migrate-on-read re-encrypt; no silent data loss |

## Execution
Kickoff sprint files land in `.agentile/sprints/active/`. Start with **SR-1**
(smallest, zero-risk), then SR-2, SR-3; open the federation sprint for SR-4..6.
