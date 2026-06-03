/**
 * Auth seam — provider-agnostic identity contract.
 *
 * CitrateScan is built as a GENERIC OIDC relying party behind this single seam
 * (see .agentile memory + the identity planset). The rest of the app depends ONLY
 * on these types + `useAuth()` (client) and `verifySession()` (server). The
 * concrete backend — mock issuer now, the Citrate authority (auth.citrate.ai) via
 * Authorization Code + PKCE later, or Privy as an optional adapter — is swappable
 * with zero changes outside `src/lib/auth/`.
 *
 * NOTE: the claim names (`sub`, `wallet_address`) and issuer/endpoint URLs are
 * PROVISIONAL — they lock in the identity planset's ADR. They live in one place
 * (`config.ts` + server env) so a rename is trivial.
 */

/** The verified identity, normalized away from any provider's claim shape. */
export interface AuthSession {
  /** Whether this deployment enforces auth (false in local/mock dev). */
  required: boolean;
  /** Whether the caller presented a valid session. */
  authenticated: boolean;
  /** OIDC subject (stable user id). Provisional claim. */
  sub?: string;
  /** The user's wallet address. Provisional claim (`wallet_address`). */
  walletAddress?: string;
}

/** Client-side auth state + actions exposed by `useAuth()`. */
export interface AuthContextValue {
  /** True once the adapter has resolved its initial state. */
  ready: boolean;
  authenticated: boolean;
  sub?: string;
  /** Lower-cased wallet address, or undefined when logged out. */
  address?: `0x${string}`;
  /** Begin login (mock: instant dev session; oidc: PKCE redirect). */
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  /** A bearer token for `Authorization` on API calls, or null when logged out. */
  getToken: () => Promise<string | null>;
}

export type AuthMode = "mock" | "oidc" | "privy";
