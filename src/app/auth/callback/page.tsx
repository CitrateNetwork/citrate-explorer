"use client";

/**
 * OIDC Authorization Code + PKCE callback (auth seam). Active only in AUTH_MODE=oidc:
 * the Citrate authority redirects here with `?code&state`; we verify the CSRF
 * state, exchange the code (with the stored PKCE verifier) for tokens at the
 * discovered token endpoint, then hand the id_token + access_token to
 * POST /api/auth/session, which sets httpOnly SameSite=Strict cookies
 * (FUA-EXPLORER-04 — tokens never touch web storage; page script can't read
 * them). Public-client exchange (no client secret). Inert in mock mode.
 */
import { useEffect, useState } from "react";
import { OIDC_PUBLIC } from "@/lib/auth/config";
import { oidcEndpoints } from "@/lib/auth/discovery";
import { idTokenFromTokenResponse, OIDC_NONCE_KEY } from "@/lib/auth/oidcNonce";

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get("code");
      const returnedState = params.get("state");
      const verifier = sessionStorage.getItem("citrate.auth.oidc.verifier");
      const expectedState = sessionStorage.getItem("citrate.auth.oidc.state");
      if (params.get("error")) {
        setError(params.get("error_description") || params.get("error") || "authorization denied");
        return;
      }
      if (!code || !verifier) {
        setError("Missing authorization code or PKCE verifier.");
        return;
      }
      if (!returnedState || returnedState !== expectedState) {
        setError("State mismatch — possible CSRF; sign-in aborted.");
        return;
      }
      try {
        const ep = await oidcEndpoints();
        const res = await fetch(ep.token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: OIDC_PUBLIC.clientId,
            redirect_uri: `${location.origin}${OIDC_PUBLIC.redirectPath}`,
            code_verifier: verifier,
          }),
        });
        if (!res.ok) throw new Error("token exchange failed");
        const tok = await res.json();
        // PBA-L3c-033: only an id_token bound to OUR nonce; no access_token fallback.
        const idToken = idTokenFromTokenResponse(tok, sessionStorage.getItem(OIDC_NONCE_KEY));
        // FUA-EXPLORER-04: the server sets httpOnly cookies — no web storage.
        const set = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id_token: idToken,
            access_token: tok.access_token || undefined,
            // TD-9: present when the authority granted offline_access — enables
            // silent rotating renewal so the session outlives the 1h id token.
            refresh_token: tok.refresh_token || undefined,
          }),
        });
        if (!set.ok) throw new Error("session cookie could not be set");
        sessionStorage.removeItem("citrate.auth.oidc.verifier");
        sessionStorage.removeItem("citrate.auth.oidc.state");
        sessionStorage.removeItem(OIDC_NONCE_KEY);
        location.replace("/");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", color: "#0e0f0c" }}>
      {error ? `Sign-in failed: ${error}` : "Completing sign-in…"}
    </main>
  );
}
