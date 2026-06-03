import { describe, it, expect } from "vitest";
import { verifySession, sessionAddress } from "./session";

// Default mode is `mock` (NEXT_PUBLIC_AUTH_MODE unset). The mock issuer keeps the
// dev gate OPEN (required:false) but resolves an identity from a mock token or a
// dev header — the same normalized shape the OIDC path will produce from a
// JWKS-verified Citrate JWT. Provider-agnostic by construction.

const ADDR = "0xf78c4b2091ad55e0a7c0e3b8f4a1d9c62b0d2915";

function mockToken(sub: string, wallet: string): string {
  return Buffer.from(JSON.stringify({ sub, wallet_address: wallet })).toString("base64url");
}

describe("auth seam — verifySession (mock mode)", () => {
  it("opens the dev gate when no credential is presented", async () => {
    const s = await verifySession(new Request("http://x"));
    expect(s.required).toBe(false);
    expect(s.authenticated).toBe(false);
    expect(sessionAddress(s)).toBeNull();
  });

  it("resolves identity from a mock bearer token", async () => {
    const req = new Request("http://x", {
      headers: { authorization: `Bearer ${mockToken("mock:" + ADDR, ADDR)}` },
    });
    const s = await verifySession(req);
    expect(s.authenticated).toBe(true);
    expect(s.walletAddress).toBe(ADDR.toLowerCase());
    expect(sessionAddress(s)).toBe(ADDR.toLowerCase());
  });

  it("resolves identity from the dev header", async () => {
    const req = new Request("http://x", { headers: { "x-citrate-dev-address": ADDR } });
    const s = await verifySession(req);
    expect(s.authenticated).toBe(true);
    expect(s.walletAddress).toBe(ADDR.toLowerCase());
  });
});
