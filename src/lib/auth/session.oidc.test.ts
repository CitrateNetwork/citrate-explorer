/**
 * OIDC relying-party verification seam — the deliverable gate for wiring
 * citrate-explorer as a registered RP of the Citrate identity authority.
 *
 * This is a HERMETIC, headless proof that `verifySession` (oidc mode) correctly
 * verifies authority-shaped ID tokens against a JWKS:
 *  - mint an RS256 keypair with `jose`,
 *  - serve its public half as a JWKS over a real loopback HTTP endpoint (exactly
 *    what `createRemoteJWKSet` fetches in production — no mock of jose internals),
 *  - point the verifier at that JWKS via the production env seam
 *    (OIDC_JWKS_URL / OIDC_ISSUER / OIDC_AUDIENCE) with NO change to the public API,
 *  - assert ACCEPT on a valid token and REJECT on wrong aud / wrong iss / bad
 *    signature / expired.
 *
 * `session.ts` reads NEXT_PUBLIC_AUTH_MODE at module load and caches the JWKS at
 * module scope, so each scenario sets env and dynamically re-imports a fresh module
 * copy via `vi.resetModules()` — the real verifier is exercised end-to-end, untouched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

const ISSUER = "http://localhost:3000";
const AUDIENCE = "citrate-explorer";
const WALLET = "0xF78C4B2091Ad55E0A7c0E3b8F4a1D9C62B0d2915"; // mixed case on purpose
const KID = "citrate-authority-test-1";

let privateKey: CryptoKey; // the authority's signing key (its public half is in the JWKS)
let foreignKey: CryptoKey; // signs tokens the JWKS cannot validate (bad-signature case)
let jwksServer: Server;
let jwksUrl: string;
let jwksBody: { keys: Record<string, unknown>[] };

/** Mint an authority-shaped ID token signed by the authority's (test) key. */
async function mintToken(
  opts: {
    iss?: string;
    aud?: string;
    sub?: string;
    wallet?: string;
    expSec?: number; // relative to now; negative = already expired
    signer?: CryptoKey;
  } = {},
): Promise<string> {
  const {
    iss = ISSUER,
    aud = AUDIENCE,
    sub = WALLET,
    wallet = WALLET,
    expSec = 300,
    signer = privateKey,
  } = opts;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ wallet_address: wallet })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + expSec)
    .sign(signer);
}

function bearerReq(token: string): Request {
  return new Request("http://explorer.local/api/whoami", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Load a fresh copy of session.ts bound to oidc mode and the local JWKS endpoint.
 * Resetting modules re-reads NEXT_PUBLIC_AUTH_MODE and re-creates the cached JWKS,
 * so we drive the real verifier without altering its public surface.
 */
async function loadVerifier() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AUTH_MODE = "oidc";
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  process.env.OIDC_JWKS_URL = jwksUrl;
  return import("./session");
}

beforeAll(async () => {
  // Authority keypair (the JWKS publishes its public half) + a foreign key whose
  // signatures the JWKS cannot verify (drives the bad-signature rejection).
  ({ privateKey } = await generateKeyPair("RS256", { extractable: true }));
  ({ privateKey: foreignKey } = await generateKeyPair("RS256", {
    extractable: true,
  }));

  // Build the JWKS from the authority public key: export the full JWK, then keep
  // only the public RSA components (n, e). This is exactly the document an OIDC
  // authority publishes at /jwks.
  const jwk = await exportJWK(privateKey);
  const publicJwk = {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: "RS256",
    use: "sig",
    kid: KID,
  };
  jwksBody = { keys: [publicJwk] };

  jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(jwksBody));
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = jwksServer.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${port}/jwks`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

describe("OIDC RP verification — citrate-explorer ⇄ Citrate authority", () => {
  it("ACCEPTS a valid authority-shaped ID token (sub + wallet extracted, lowercased)", async () => {
    const { verifySession, sessionAddress } = await loadVerifier();
    const token = await mintToken();
    const s = await verifySession(bearerReq(token));

    expect(s.required).toBe(true);
    expect(s.authenticated).toBe(true);
    expect(s.sub).toBe(WALLET); // sub preserved as-issued
    expect(s.walletAddress).toBe(WALLET.toLowerCase()); // wallet normalized
    expect(sessionAddress(s)).toBe(WALLET.toLowerCase());
  });

  it("REJECTS a token with the wrong audience", async () => {
    const { verifySession } = await loadVerifier();
    const token = await mintToken({ aud: "some-other-rp" });
    const s = await verifySession(bearerReq(token));
    expect(s.required).toBe(true);
    expect(s.authenticated).toBe(false);
    expect(s.walletAddress).toBeUndefined();
  });

  it("REJECTS a token with the wrong issuer", async () => {
    const { verifySession } = await loadVerifier();
    const token = await mintToken({ iss: "https://evil.example" });
    const s = await verifySession(bearerReq(token));
    expect(s.authenticated).toBe(false);
  });

  it("REJECTS a token with a bad signature (signed by a foreign key)", async () => {
    const { verifySession } = await loadVerifier();
    const token = await mintToken({ signer: foreignKey });
    const s = await verifySession(bearerReq(token));
    expect(s.authenticated).toBe(false);
  });

  it("REJECTS an expired token", async () => {
    const { verifySession } = await loadVerifier();
    const token = await mintToken({ expSec: -120 }); // expired 2 min ago
    const s = await verifySession(bearerReq(token));
    expect(s.authenticated).toBe(false);
  });

  it("REJECTS when no Bearer credential is presented", async () => {
    const { verifySession } = await loadVerifier();
    const s = await verifySession(new Request("http://explorer.local/api/whoami"));
    expect(s.required).toBe(true);
    expect(s.authenticated).toBe(false);
  });
});
