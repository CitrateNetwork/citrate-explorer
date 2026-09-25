/**
 * PBA-L3c-033: the OIDC login sent no `nonce`, and the callback fell back to the
 * access_token as the session credential when the token response had no
 * id_token. Now the login binds a nonce, and the callback accepts only an
 * id_token whose `nonce` claim matches the one it stored.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idTokenFromTokenResponse, newNonce } from "./oidcNonce";

const jwt = (p: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(p)).toString("base64url")}.sig`;

describe("idTokenFromTokenResponse", () => {
  it("returns the id_token when its nonce matches", () => {
    const t = jwt({ sub: "a", nonce: "n-1" });
    expect(idTokenFromTokenResponse({ id_token: t, access_token: "opaque" }, "n-1")).toBe(t);
  });
  it("never falls back to the access_token", () => {
    expect(() => idTokenFromTokenResponse({ access_token: jwt({ sub: "a", nonce: "n-1" }) }, "n-1")).toThrow(/no id_token/);
  });
  it("refuses a missing, different, or unbound nonce", () => {
    expect(() => idTokenFromTokenResponse({ id_token: jwt({ sub: "a" }) }, "n-1")).toThrow(/nonce/);
    expect(() => idTokenFromTokenResponse({ id_token: jwt({ sub: "a", nonce: "other" }) }, "n-1")).toThrow(/nonce/);
    expect(() => idTokenFromTokenResponse({ id_token: jwt({ sub: "a", nonce: "n-1" }) }, null)).toThrow(/nonce/);
    expect(() => idTokenFromTokenResponse({ id_token: jwt({ sub: "a", nonce: "" }) }, "")).toThrow(/nonce/);
  });
  it("refuses a non-JWT id_token", () => {
    expect(() => idTokenFromTokenResponse({ id_token: "not-a-jwt" }, "n-1")).toThrow(/nonce/);
  });
  it("newNonce is unguessable-length and unique", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("nonce encoding details (mutation kills)", () => {
  it("newNonce is 32 random bytes in unpadded base64url (43 chars, no + / =)", () => {
    for (let i = 0; i < 200; i++) {
      const n = newNonce();
      expect(n).toHaveLength(43);
      expect(n).not.toMatch(/[+/=]/);
    }
  });
  it("decodes base64url payloads that contain - and _", () => {
    // "?>?" and "~~~" produce '_' and '-' in base64url.
    const nonce = "?>?~~~?>?";
    const t = jwt({ sub: "a", nonce });
    expect(t.split(".")[1]).toMatch(/[-_]/);
    expect(idTokenFromTokenResponse({ id_token: t }, nonce)).toBe(t);
  });
  it("refuses a 2-part or 4-part token and a non-string id_token", () => {
    const [h, p] = jwt({ nonce: "n" }).split(".");
    expect(() => idTokenFromTokenResponse({ id_token: `${h}.${p}` }, "n")).toThrow(/nonce/);
    expect(() => idTokenFromTokenResponse({ id_token: `${h}.${p}.s.x` }, "n")).toThrow(/nonce/);
    expect(() => idTokenFromTokenResponse({ id_token: 5 }, "n")).toThrow(/no id_token/);
  });
  it("refuses a token whose payload is not JSON", () => {
    const junk = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from("not json").toString("base64url")}.sig`;
    expect(() => idTokenFromTokenResponse({ id_token: junk }, "n")).toThrow(/nonce/);
  });

  it("uses a namespaced storage key", async () => {
    const { OIDC_NONCE_KEY } = await import("./oidcNonce");
    expect(OIDC_NONCE_KEY).toBe("citrate.auth.oidc.nonce");
  });
});

describe("source tripwire (PBA-L3c-033)", () => {
  const root = join(__dirname, "..", "..");
  it("the login request carries a nonce", () => {
    const client = readFileSync(join(root, "lib/auth/client.tsx"), "utf8");
    expect(client).toMatch(/searchParams\.set\("nonce",/);
  });
  it("the callback validates the nonce and has no access_token fallback", () => {
    const cb = readFileSync(join(root, "app/auth/callback/page.tsx"), "utf8");
    expect(cb).toMatch(/idTokenFromTokenResponse\(/);
    expect(cb).not.toMatch(/id_token\s*\|\|\s*tok\.access_token/);
  });
});
