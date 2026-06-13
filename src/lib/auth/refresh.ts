/**
 * Refresh-token renewal helpers (TD-9). The network call to the authority lives
 * in the route; everything here is PURE so it is unit-testable with a realistic
 * token-response object (Rule 11: the success path is also covered by the live
 * curl e2e — this is a pure transform, not a faked data source).
 */
import {
  ID_COOKIE,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  decodeJwtPayload,
  looksLikeJwt,
  looksLikeOpaqueToken,
  serializeAuthCookie,
} from "./cookies";

/** A token endpoint response (authorization_code or refresh_token grant). */
export interface TokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}

export interface BuiltSession {
  setCookies: string[];
  exp: number;
  sub?: string;
  walletAddress?: string;
}

/** Cookie lifetime from a token's own exp (capped 24h, floor 60s). */
export function cookieMaxAge(exp: number, now: number): number {
  return Math.min(Math.max(exp - now, 60), 24 * 3600);
}

/**
 * Build the Set-Cookie headers + decoded display claims for a token response.
 * `id_token` must be a JWT; `access_token`/`refresh_token` are opaque (the
 * authority issues opaque tokens). Returns null if the id_token is malformed.
 */
export function buildSessionCookies(
  tokens: TokenResponse,
  now: number,
  claimNames: { sub: string; wallet: string },
): BuiltSession | null {
  const idToken = typeof tokens.id_token === "string" ? tokens.id_token : null;
  if (!idToken || !looksLikeJwt(idToken)) return null;
  const accessToken =
    typeof tokens.access_token === "string" ? tokens.access_token : null;
  const refreshToken =
    typeof tokens.refresh_token === "string" ? tokens.refresh_token : null;

  const claims = decodeJwtPayload(idToken) ?? {};
  const exp = typeof claims.exp === "number" ? claims.exp : now + 3600;
  const maxAge = cookieMaxAge(exp, now);

  const setCookies = [serializeAuthCookie(ID_COOKIE, idToken, maxAge)];
  if (accessToken && looksLikeOpaqueToken(accessToken)) {
    setCookies.push(serializeAuthCookie(ACCESS_COOKIE, accessToken, maxAge));
  }
  if (refreshToken && looksLikeOpaqueToken(refreshToken)) {
    // Refresh cookie outlives id/access — tracks the authority RefreshToken TTL.
    setCookies.push(serializeAuthCookie(REFRESH_COOKIE, refreshToken, REFRESH_MAX_AGE));
  }

  const sub = typeof claims[claimNames.sub] === "string" ? (claims[claimNames.sub] as string) : undefined;
  const walletAddress =
    typeof claims[claimNames.wallet] === "string"
      ? (claims[claimNames.wallet] as string).toLowerCase()
      : undefined;

  return { setCookies, exp, sub, walletAddress };
}

/** Resolve the configured claim names (server env, with NEXT_PUBLIC fallback). */
export function claimNames(): { sub: string; wallet: string } {
  return {
    sub: process.env.AUTH_CLAIM_SUB || process.env.NEXT_PUBLIC_AUTH_CLAIM_SUB || "sub",
    wallet:
      process.env.AUTH_CLAIM_WALLET ||
      process.env.NEXT_PUBLIC_AUTH_CLAIM_WALLET ||
      "wallet_address",
  };
}
