/**
 * OIDC nonce binding for the public-client login (PBA-L3c-033).
 *
 * PKCE + state stop code injection and CSRF on the redirect, but without a
 * `nonce` an id_token issued for some other authorization request (replayed or
 * injected) is indistinguishable from ours. The login stores a fresh nonce and
 * sends it; the callback accepts ONLY an id_token whose `nonce` claim equals the
 * stored value, and never substitutes the access_token for a missing id_token
 * (the session is keyed on id_token claims; an opaque access token is not one).
 *
 * The signature, iss, aud and exp are still verified server-side on every
 * request (verifySession); this check is the RP's replay binding.
 */

export const OIDC_NONCE_KEY = "citrate.auth.oidc.nonce";

/** 32 random bytes, base64url. */
export function newNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function payloadNonce(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { nonce?: unknown };
    return typeof json.nonce === "string" ? json.nonce : null;
  } catch {
    return null;
  }
}

/**
 * The id_token to hand to /api/auth/session. Throws unless the token response
 * has an id_token whose `nonce` matches `expectedNonce`.
 */
export function idTokenFromTokenResponse(
  tok: { id_token?: unknown; access_token?: unknown },
  expectedNonce: string | null,
): string {
  const idToken = typeof tok.id_token === "string" && tok.id_token ? tok.id_token : null;
  if (!idToken) throw new Error("no id_token in the token response");
  const nonce = payloadNonce(idToken);
  if (!expectedNonce || !nonce || nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch; sign-in aborted");
  }
  return idToken;
}
