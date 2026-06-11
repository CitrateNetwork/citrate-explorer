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
        const idToken = tok.id_token || tok.access_token;
        if (!idToken) throw new Error("no id_token in response");
        // FUA-EXPLORER-04: the server sets httpOnly cookies — no web storage.
        const set = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id_token: idToken,
            access_token: tok.access_token || undefined,
          }),
        });
        if (!set.ok) throw new Error("session cookie could not be set");
        sessionStorage.removeItem("citrate.auth.oidc.verifier");
        sessionStorage.removeItem("citrate.auth.oidc.state");
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
