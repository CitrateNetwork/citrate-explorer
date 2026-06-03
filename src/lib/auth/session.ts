/**
 * Server-side session verification — the server half of the auth seam.
 *
 * `verifySession(req)` is the ONLY identity check API routes call. It returns a
 * normalized {@link AuthSession} regardless of the concrete issuer:
 *  - `oidc`  — verify a Citrate-issued JWT against the authority's JWKS (jose),
 *    checking issuer + audience, then read the (provisional) sub + wallet claims.
 *  - `mock`  — dev only: decode an unsigned mock token / dev header. `required:false`
 *    so the app runs locally without an authority.
 *  - `privy` — optional: the existing Privy flow, dynamically imported so no
 *    Privy code is referenced unless explicitly selected (the engineer's rule:
 *    zero Privy-specific calls outside this module).
 *
 * Data source (Rule 11): the Bearer JWT verified against the configured JWKS.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthSession } from "./types";

const MODE = process.env.NEXT_PUBLIC_AUTH_MODE || "mock";

const claimSub = () =>
  process.env.AUTH_CLAIM_SUB || process.env.NEXT_PUBLIC_AUTH_CLAIM_SUB || "sub";
const claimWallet = () =>
  process.env.AUTH_CLAIM_WALLET ||
  process.env.NEXT_PUBLIC_AUTH_CLAIM_WALLET ||
  "wallet_address";

function bearer(req: Request): string | null {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
}

// --- OIDC (real authority) --------------------------------------------------

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwkSet() {
  const url = process.env.OIDC_JWKS_URL;
  if (!url) throw new Error("OIDC_JWKS_URL is not set");
  if (!jwks) jwks = createRemoteJWKSet(new URL(url));
  return jwks;
}

async function verifyOidc(req: Request): Promise<AuthSession> {
  const token = bearer(req);
  if (!token) return { required: true, authenticated: false };
  try {
    const { payload } = await jwtVerify(token, jwkSet(), {
      issuer: process.env.OIDC_ISSUER || undefined,
      audience: process.env.OIDC_AUDIENCE || undefined,
    });
    const sub = payload[claimSub()] as string | undefined;
    const walletAddress = (payload[claimWallet()] as string | undefined)?.toLowerCase();
    return { required: true, authenticated: Boolean(sub), sub, walletAddress };
  } catch {
    return { required: true, authenticated: false };
  }
}

// --- Mock issuer (dev) ------------------------------------------------------

function verifyMock(req: Request): AuthSession {
  // Accept either the client mock token (unsigned base64url JSON) or a dev header.
  const token = bearer(req);
  if (token) {
    try {
      const json = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
      const sub = json[claimSub()] ?? json.sub;
      const walletAddress = (json[claimWallet()] ?? json.wallet_address)?.toLowerCase();
      if (sub || walletAddress) {
        return { required: false, authenticated: true, sub, walletAddress };
      }
    } catch {
      /* fall through to header */
    }
  }
  const devAddr = req.headers.get("x-citrate-dev-address")?.toLowerCase();
  if (devAddr) {
    return { required: false, authenticated: true, sub: `dev:${devAddr}`, walletAddress: devAddr };
  }
  // Dev gate is open: unauthenticated calls are allowed (no enforcement).
  return { required: false, authenticated: false };
}

export async function verifySession(req: Request): Promise<AuthSession> {
  if (MODE === "oidc") return verifyOidc(req);
  if (MODE === "privy") {
    const { verifyPrivy } = await import("./adapters/privy.server");
    return verifyPrivy(req);
  }
  return verifyMock(req);
}

/** Convenience for routes: the caller's wallet address, or null when unauthenticated. */
export function sessionAddress(s: AuthSession): string | null {
  return s.walletAddress ?? null;
}
