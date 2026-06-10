import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// Mock mode must now be selected EXPLICITLY (WEB-1: the default is oidc,
// fail-closed). These tests exercise the dev-mode mock issuer: gate OPEN
// (required:false), identity resolved from a mock token or a dev header —
// the same normalized shape the OIDC path produces from a JWKS-verified
// Citrate JWT. Provider-agnostic by construction.
//
// `session.ts` reads NEXT_PUBLIC_AUTH_MODE at module load, so each test
// re-imports a fresh module copy after setting env (same pattern as
// session.oidc.test.ts).

const ADDR = "0xf78c4b2091ad55e0a7c0e3b8f4a1d9c62b0d2915";

function mockToken(sub: string, wallet: string): string {
  return Buffer.from(JSON.stringify({ sub, wallet_address: wallet })).toString("base64url");
}

async function freshSession() {
  vi.resetModules();
  return await import("./session");
}

describe("auth seam — verifySession (explicit mock mode, dev)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.mode = process.env.NEXT_PUBLIC_AUTH_MODE;
    process.env.NEXT_PUBLIC_AUTH_MODE = "mock";
  });

  afterEach(() => {
    if (saved.mode === undefined) delete process.env.NEXT_PUBLIC_AUTH_MODE;
    else process.env.NEXT_PUBLIC_AUTH_MODE = saved.mode;
  });

  it("opens the dev gate when no credential is presented", async () => {
    const { verifySession, sessionAddress } = await freshSession();
    const s = await verifySession(new Request("http://x"));
    expect(s.required).toBe(false);
    expect(s.authenticated).toBe(false);
    expect(sessionAddress(s)).toBeNull();
  });

  it("resolves identity from a mock bearer token", async () => {
    const { verifySession, sessionAddress } = await freshSession();
    const req = new Request("http://x", {
      headers: { authorization: `Bearer ${mockToken("mock:" + ADDR, ADDR)}` },
    });
    const s = await verifySession(req);
    expect(s.authenticated).toBe(true);
    expect(s.walletAddress).toBe(ADDR.toLowerCase());
    expect(sessionAddress(s)).toBe(ADDR.toLowerCase());
  });

  it("resolves identity from the dev header", async () => {
    const { verifySession } = await freshSession();
    const req = new Request("http://x", { headers: { "x-citrate-dev-address": ADDR } });
    const s = await verifySession(req);
    expect(s.authenticated).toBe(true);
    expect(s.walletAddress).toBe(ADDR.toLowerCase());
  });
});
