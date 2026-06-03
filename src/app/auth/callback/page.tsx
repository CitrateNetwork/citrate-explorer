"use client";

/**
 * OIDC Authorization Code + PKCE callback (auth seam). Active only in AUTH_MODE=oidc:
 * the Citrate authority redirects here with `?code`; we exchange it (with the
 * stored PKCE verifier) for an ID token at the token endpoint, store it, and
 * return home. Public-client exchange (no client secret). Inert in mock mode.
 */
import { useEffect, useState } from "react";
import { OIDC_PUBLIC } from "@/lib/auth/config";

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const code = new URLSearchParams(location.search).get("code");
      const verifier = sessionStorage.getItem("citrate.auth.oidc.verifier");
      if (!code || !verifier) {
        setError("Missing authorization code or PKCE verifier.");
        return;
      }
      const tokenUrl = OIDC_PUBLIC.tokenUrl || `${OIDC_PUBLIC.issuer}/token`;
      try {
        const res = await fetch(tokenUrl, {
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
        localStorage.setItem("citrate.auth.oidc.idtoken", idToken);
        sessionStorage.removeItem("citrate.auth.oidc.verifier");
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
