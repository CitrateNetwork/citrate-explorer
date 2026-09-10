---
created: 2026-06-03T00:00:00Z
branch: p0-auth-seam-providers
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# ADR-001 — Auth as a generic OIDC relying party behind one seam

## Status
Accepted (P-0). Claim contract PROVISIONAL pending the identity planset's ADR.

## Context
Citrate is unifying auth across web + native via a real authority
(`auth.citrate.ai`, not yet shipped): OIDC Authorization Code + PKCE for web
clients, JWKS verification, discovery at `/.well-known/openid-configuration`,
and enterprise SSO/SAML + RFC 8252 device flows at the authority layer. The
explorer must not provision its own Privy app or scatter provider-specific code.

## Decision
The explorer is a **generic OIDC relying party behind a single auth seam**
(`src/lib/auth/`). Everything else depends only on:
- `useAuth()` (client, `client.tsx`) → `{ ready, authenticated, sub, address,
  login, logout, getToken }`.
- `verifySession(req)` (server, `session.ts`) → normalized `AuthSession`
  `{ required, authenticated, sub, walletAddress }`.

Concrete backend selected by `NEXT_PUBLIC_AUTH_MODE`:
- **mock** (default) — instant dev login; server decodes an unsigned mock token
  / `x-citrate-dev-address`. Unblocks development now.
- **oidc** — PKCE redirect (`login()`), `/auth/callback` exchanges the code, and
  the server verifies the JWT against the authority's JWKS (`jose`), reading the
  `sub` + `wallet_address` claims. Ready for `auth.citrate.ai`.
- **privy** — optional adapter (`adapters/privy.server.ts`) — the ONLY file that
  may import Privy. Default path uses none.

The chain layer (wagmi/viem) is **decoupled** from auth: `src/lib/citrate/config.ts`
is plain wagmi (injected connector + http), so `useAccount`/`useReadContract`/
`useWriteContract`/`useSignTypedData` work regardless of identity provider.

## Provisional (treat as a moving target)
Claim names (`sub`, `wallet_address`), scope vocabulary, and issuer/endpoint URLs
are NOT ratified. They live in `config.ts` + server env (`AUTH_CLAIM_*`,
`OIDC_*`) so a rename is a one-line change. No code outside `src/lib/auth/`
references these strings.

## Consequences
- Switching mock → the Citrate authority is config-only; institutional SSO later
  needs zero explorer changes.
- Privy can be dropped entirely (only an optional adapter remains).
- The mock path must never run in production (`NEXT_PUBLIC_AUTH_MODE=oidc` is a
  go-live checklist item).

## References
Memory `citrate-explorer-auth-seam`; production planset P-0; the forthcoming
identity planset ADR (ratifies the claim contract).
