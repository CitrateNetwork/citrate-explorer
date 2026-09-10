---
created: 2026-06-04T00:00:00Z
branch: settings-realization
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
sprint: settings-realization
---

# Sprint — Settings Realization

Executes [`planset/2026-06-04-settings-realization-v1/PLANSET.md`](../../planset/2026-06-04-settings-realization-v1/PLANSET.md):
make every Settings surface real (no UI removed) and honest, and re-key all
per-user data to the stable OIDC `subject` ahead of the Web2/Privy-like portal.

## Status

| ID | Item | Status |
|----|------|--------|
| SR-1 | Real provenance (Transparency) | ✅ done — `/api/version` + UI; LICENSE→Apache-2.0; `package.json` license; repo `CitrateNetwork`; +2 tests |
| SR-0 | Ownership key `wallet_address` → `subject` | ✅ done — seam `sessionOwner`/`requireOwner`; 6 owner tables additive `subject` + dual-write (verbatim, no lower-casing); GDPR erasure/export match legacy; migration `0002` + backfill; +4 tests |
| SR-2 | E2EE settings sync (provider-agnostic key) | ✅ done — seam `getKeyMaterial` (embedded/external wallet signature; mock dev secret; connect-if-needed); `crypto-client` subject-bound key; `useSettingsKey`/`useSyncedSettings`; Appearance "Encrypted sync" control; +4 crypto tests |
| SR-3 | E2EE watchlist + blind-index | ✅ done — `deriveBlindIndexKey`/`blindIndex`; route accepts encrypted envelope or plaintext-with-disclosure; client encrypts on add + decrypts on render + locked-row UI; privacy copy corrected (E2EE-when-unlocked; client-side alerts) |
| SR-4..6 | Security panel (sessions/wallets/passkeys) | ⏳ federation — needs `citrate-identity` endpoints (see planset); the team is concurrently reworking the portal — coordinate |

**Tests ratchet:** 86 → **96** (baseline.json updated). Typecheck + lint clean.

### Honest deferrals (tracked, not silently dropped)
- **SX-4 (`@ts-nocheck` on `settings.tsx`):** not removed this pass — the file is
  ~400 lines of dense untyped JSX with no UI test coverage; removing it safely is a
  standalone task. The new *logic* (key/sync/crypto) lives in typed modules
  (`src/lib/settings/sync.ts`, `crypto-client.ts`) that DO typecheck. Do SX-4 next.
- **SR-3 legacy migrate-on-read:** legacy plaintext watchlist rows are shown with a
  red "plaintext" badge and can be re-added encrypted; no fragile auto-migrate
  (prod watchlist is ~empty). Revisit if real plaintext rows accumulate.
- **SR-3 alert engine:** with zero-knowledge E2EE the server can't evaluate alerts
  (no key); alerts are client-side and the evaluation loop is a separate feature —
  copy now says "evaluated client-side" (honest), the loop is not yet built.
- **Walletless E2EE today:** non-crypto users with no signer can't unlock E2EE until
  WebAuthn-PRF lands (EW-S1); the seam already accepts it, and the UI degrades
  honestly (plaintext-with-disclosure for watchlist; local-only for settings).

### EW-S1 alignment (read `handoffs/EMBEDDED_WALLET_SPRINT_HANDOFF.md`)
The federation's **EW-S1** sprint (kicked off 2026-06-05) replaces SIWE with a
multi-method OIDC issuer + **passkey-signed ERC-4337 smart wallet** (one address
per user; modular validators). **Privy is removed entirely.** Impacts:
- **SR-0 is the right prep.** Today `sub = <wallet address>`; EW-S1 flips `sub` to a
  stable user id. When that lands, do a one-time re-home `UPDATE ... SET subject=<new
  sub> WHERE subject=<old wallet-sub>` per owner table — trivial thanks to the
  additive `subject` column. Until then SR-0 keys by the wallet-`sub` (works now).
- **SR-2 signer:** shipped path = EOA signature (fine for the current SIWE user base);
  **PRF becomes primary** once EW-S1's WebAuthn ships — same seam, no app changes.
- **SR-4..6 (Security panel) = EW-S1 territory.** The handoff says do NOT preempt
  `citrate-identity`. Fold sessions/passkeys/linked-wallets/guardians into EW-S1;
  the explorer only WIRES to the authority endpoints EW-S1 produces.
- Explorer read paths are explicitly unaffected by EW-S1 (per the handoff), so this
  sprint can ship in parallel.

## Decisions locked (from the architect, 2026-06-04)
- License = **Apache-2.0** (was MIT in file; CONFIG/CLAUDE already said Apache).
- Owner key = stable OIDC **`sub`**; wallet is an optional attribute.
- Migration = **additive + cutover** (add `subject`, backfill, switch reads/writes,
  drop `user_address` later).
- E2EE key source = **embedded-wallet signature + WebAuthn-PRF fallback**, behind
  the auth seam (works for non-crypto users; no external-wallet assumption).
- Auth direction: SIWE → Web2 portal (Google/email/passkey), embedded wallets,
  full KYC. The `subject` re-key (SR-0) is the prerequisite that keeps Settings
  working for wallet-less users.

## ⚠️ GO-LIVE RUNBOOK (gated — do NOT auto-run against prod)

SR-0/SR-1 are code-complete on branch `settings-realization`. Shipping needs a
**live Neon migration + deploy**, which is an irreversible prod action and is left
for human approval (same discipline as the auth cutover). Steps:

1. **Review the PR** for `settings-realization` (SR-0 + SR-1).
2. **Apply the additive migration to prod Neon FIRST** (it only ADDs columns +
   indexes + backfills — drops nothing, safe/reversible):
   ```bash
   cd citrate-explorer
   vercel env pull .env.prod --environment=production   # gets DATABASE_URL
   DATABASE_URL="$(grep ^DATABASE_URL .env.prod | cut -d= -f2-)" pnpm db:migrate
   rm .env.prod
   ```
   Migration: `src/lib/db/migrations/0002_amused_black_knight.sql`.
3. **Merge the PR to `main`** → Vercel auto-deploys the code that reads/writes
   `subject`. (Order matters: migration before deploy, since the new code expects
   the `subject` column. Old code tolerates the extra column, so step 2 before
   step 3 is safe with zero downtime.)
4. **Smoke on `explorer.citrate.ai`:** sign in; confirm Settings → Account shows
   identity; create an API key, add a watchlist entry, confirm both persist and are
   scoped to your `sub`; Transparency shows real Apache-2.0 / commit / model.
5. **(Later) cutover migration** to drop `user_address` + make `subject` NOT
   NULL/PK once all rows carry a subject and no old code remains.

## Notes / tech-debt ledger (keep empty)
- `settings.tsx` is `@ts-nocheck` — to be removed in SR-2/SR-3 when the file is
  reworked (SX-4). Tracked, not forgotten.
- SR-4..6 require new `citrate-identity` endpoints (`GET /sessions`,
  `DELETE /sessions/:id`, `GET /account/wallets`, WebAuthn). Federation sprint to
  open in `citrate-federation`. The team is concurrently reworking the portal;
  coordinate so the explorer wires to the final endpoints.
