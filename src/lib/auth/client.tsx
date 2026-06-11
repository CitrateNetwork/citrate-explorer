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
  useState,
  type ReactNode,
} from "react";
import { WagmiProvider, useAccount, useConnect, useSignMessage } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/citrate/config";
import { AUTH_MODE, OIDC_PUBLIC, MOCK_DEV_ADDRESS } from "./config";
import { oidcEndpoints, sessionEventsUrl } from "./discovery";
import { E2EE_KEY_MESSAGE } from "@/lib/crypto-client";
import type { AuthContextValue } from "./types";

/** Hex-encode bytes (no 0x). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

  // Dev-only deterministic key material (no wallet popup): a digest of the subject.
  // Honest — this is the mock adapter; production E2EE uses a real wallet signature
  // (oidc adapter). Deterministic so encrypt/decrypt round-trips locally.
  const getKeyMaterial = useCallback(async () => {
    if (!session) return null;
    const data = new TextEncoder().encode(`citrate-mock-e2ee-v1:${session.sub}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(new Uint8Array(digest));
  }, [session]);

  return {
    ready,
    authenticated: Boolean(session),
    sub: session?.sub,
    address: session?.address,
    login,
    logout,
    getToken,
    getKeyMaterial,
  };
}

// --- oidc adapter (Authorization Code + PKCE, public client) ----------------

// FUA-EXPLORER-04 (SECREM-02): tokens are NOT stored in web storage anymore.
// The /auth/callback page hands them to POST /api/auth/session, which sets
// httpOnly SameSite=Strict cookies that page script can never read. Only the
// one-shot PKCE verifier + CSRF state (non-bearer flow artifacts) remain in
// sessionStorage for the redirect round-trip.
const OIDC_STATE_KEY = "citrate.auth.oidc.state";
const OIDC_VERIFIER_KEY = "citrate.auth.oidc.verifier";

interface OidcSessionInfo {
  authenticated: boolean;
  sub?: string;
  walletAddress?: string;
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
  // Session state hydrates from GET /api/auth/session (claims decoded from the
  // httpOnly cookie server-side). The token itself never reaches page script.
  const [session, setSession] = useState<OidcSessionInfo | null>(null);
  const [ready, setReady] = useState(false);
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { authenticated: false }))
      .then((j: OidcSessionInfo) => {
        if (!cancelled) setSession(j);
      })
      .catch(() => {
        if (!cancelled) setSession({ authenticated: false });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sub = session?.sub;

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
    // Server-side logout: DELETE clears the httpOnly cookies (the client
    // cannot — it can't even read them) and best-effort ends the session at
    // the authority with the access token, which also lives only server-side.
    void fetch("/api/auth/session", { method: "DELETE", keepalive: true }).catch(
      () => {},
    );
    setSession({ authenticated: false });
  }, []);

  const logout = useCallback(() => {
    clearLocal();
  }, [clearLocal]);

  // Logout cascade (TD-5b): subscribe to the authority's SSE bus and drop the
  // local session when a `logout` event for THIS subject arrives (logout elsewhere
  // — another tab, the dashboard, or an admin revoke — signs us out here too).
  useEffect(() => {
    if (!session?.authenticated || !sub || typeof EventSource === "undefined") return;
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
  }, [session?.authenticated, sub, clearLocal]);

  // FUA-EXPLORER-04: there is no client-readable token anymore. The httpOnly
  // cookie rides along on every same-origin fetch automatically, and the
  // server's `verifySession` reads it when no Authorization header is present.
  // Callers already attach headers conditionally, so null = "cookie auth".
  const getToken = useCallback(async () => null, []);

  // E2EE key material = a deterministic wallet signature over the fixed message
  // (the established sign-to-derive-key pattern; secp256k1/RFC-6979 makes it stable
  // for a given key). Works for any wagmi signer — external wallet today, the
  // Privy-like embedded wallet once it's exposed through wagmi. Returns null when
  // no signer is connected (the honest "locked" state — never a fabricated key).
  const getKeyMaterial = useCallback(async () => {
    try {
      // Ensure a signer (explicit user action: they clicked "unlock"). Connects the
      // available wallet — the injected wallet today, the Privy-like embedded wallet
      // once it's registered as a wagmi connector. Honest null when none exists.
      if (!isConnected) {
        const connector = connectors[0];
        if (!connector) return null;
        await connectAsync({ connector });
      }
      return await signMessageAsync({ message: E2EE_KEY_MESSAGE });
    } catch {
      return null;
    }
  }, [isConnected, connectAsync, connectors, signMessageAsync]);

  return {
    ready,
    authenticated: Boolean(session?.authenticated),
    sub,
    address: session?.walletAddress?.toLowerCase() as `0x${string}` | undefined,
    login,
    logout,
    getToken,
    getKeyMaterial,
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
