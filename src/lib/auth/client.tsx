"use client";

/**
 * Auth seam — client half. `<AuthProvider>` mounts the chain layer (wagmi +
 * React Query) and the selected identity adapter; `useAuth()` exposes the
 * normalized {@link AuthContextValue}. The rest of the app imports ONLY these.
 *
 * Adapters (selected by AUTH_MODE):
 *  - `mock` (default) — a working dev login: instant session for the configured
 *    dev wallet, no authority required.
 *  - `oidc` — Authorization Code + PKCE against the Citrate authority; redirects
 *    to the issuer, the /auth/callback route exchanges the code (see callback page).
 *  - `privy` — server adapter only in P-0; the client falls back to mock here.
 */
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/citrate/config";
import { AUTH_MODE, OIDC_PUBLIC, MOCK_DEV_ADDRESS } from "./config";
import { oidcEndpoints, sessionEventsUrl, logoutUrl } from "./discovery";
import type { AuthContextValue } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

// --- mock adapter -----------------------------------------------------------

const MOCK_KEY = "citrate.auth.mock";

function useMockAuth(): AuthContextValue {
  // Client-only provider (the app mounts ssr:false), so reading localStorage in
  // a lazy initializer is safe and avoids set-state-in-effect.
  const [session, setSession] = useState<{ sub: string; address: `0x${string}` } | null>(
    () => {
      try {
        const raw = localStorage.getItem(MOCK_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
  );
  const ready = true;

  const login = useCallback(() => {
    const s = {
      sub: `mock:${MOCK_DEV_ADDRESS}`,
      address: MOCK_DEV_ADDRESS.toLowerCase() as `0x${string}`,
    };
    localStorage.setItem(MOCK_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(MOCK_KEY);
    setSession(null);
  }, []);

  const getToken = useCallback(async () => {
    if (!session) return null;
    // Unsigned mock token (dev only): base64url JSON the server's mock verifier decodes.
    const json = JSON.stringify({ sub: session.sub, wallet_address: session.address });
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }, [session]);

  return {
    ready,
    authenticated: Boolean(session),
    sub: session?.sub,
    address: session?.address,
    login,
    logout,
    getToken,
  };
}

// --- oidc adapter (Authorization Code + PKCE, public client) ----------------

const OIDC_TOKEN_KEY = "citrate.auth.oidc.idtoken";
const OIDC_ACCESS_KEY = "citrate.auth.oidc.accesstoken";
const OIDC_STATE_KEY = "citrate.auth.oidc.state";
const OIDC_VERIFIER_KEY = "citrate.auth.oidc.verifier";

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function useOidcAuth(): AuthContextValue {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OIDC_TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const ready = true;

  const claims = useMemo(() => (token ? decodeJwtClaims(token) : null), [token]);
  const sub = claims?.sub as string | undefined;

  const login = useCallback(async () => {
    // PKCE verifier + CSRF state, both stored to verify on the callback.
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const state = crypto.randomUUID();
    sessionStorage.setItem(OIDC_VERIFIER_KEY, verifier);
    sessionStorage.setItem(OIDC_STATE_KEY, state);
    const challenge = await pkceChallenge(verifier);
    // Endpoints come from discovery (panva's is /auth, not /authorize).
    const ep = await oidcEndpoints();
    const url = new URL(ep.authorization);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OIDC_PUBLIC.clientId);
    url.searchParams.set("redirect_uri", `${location.origin}${OIDC_PUBLIC.redirectPath}`);
    url.searchParams.set("scope", OIDC_PUBLIC.scope);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    location.href = url.toString();
  }, []);

  const clearLocal = useCallback(() => {
    localStorage.removeItem(OIDC_TOKEN_KEY);
    localStorage.removeItem(OIDC_ACCESS_KEY);
    setToken(null);
  }, []);

  const logout = useCallback(() => {
    // End the session AT THE AUTHORITY (revokes + publishes the logout event that
    // cascades to other RPs), then drop the local session.
    const access = (() => {
      try {
        return localStorage.getItem(OIDC_ACCESS_KEY);
      } catch {
        return null;
      }
    })();
    void fetch(logoutUrl(), {
      method: "POST",
      headers: access ? { authorization: `Bearer ${access}` } : undefined,
      keepalive: true,
    }).catch(() => {});
    clearLocal();
  }, [clearLocal]);

  // Logout cascade (TD-5b): subscribe to the authority's SSE bus and drop the
  // local session when a `logout` event for THIS subject arrives (logout elsewhere
  // — another tab, the dashboard, or an admin revoke — signs us out here too).
  useEffect(() => {
    if (!token || !sub || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(sessionEventsUrl(), { withCredentials: false });
      es.addEventListener("logout", (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as { sub?: string };
          if (ev.sub && ev.sub.toLowerCase() === sub.toLowerCase()) clearLocal();
        } catch {
          /* ignore malformed events */
        }
      });
    } catch {
      /* SSE unavailable — best-effort */
    }
    return () => es?.close();
  }, [token, sub, clearLocal]);

  const getToken = useCallback(async () => token, [token]);

  const wallet = claims?.wallet_address as string | undefined;
  return {
    ready,
    authenticated: Boolean(token),
    sub,
    address: wallet?.toLowerCase() as `0x${string}` | undefined,
    login,
    logout,
    getToken,
  };
}

// --- provider ---------------------------------------------------------------

function AuthInner({ children }: { children: ReactNode }) {
  // Adapter is fixed at build time by AUTH_MODE, so hook order is stable.
  const mock = useMockAuth();
  const oidc = useOidcAuth();
  const value = AUTH_MODE === "oidc" ? oidc : mock;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthInner>{children}</AuthInner>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
