/**
 * FUA-EXPLORER-04 (SECREM-02 WP 7.1) — /api/auth/session route behavior.
 * The handlers are plain web-standard Request→Response functions, exercised
 * directly: POST must set httpOnly SameSite=Strict cookies (and never echo the
 * token), DELETE must clear them server-side, GET must hydrate UI state from
 * the caller's own cookie, and cross-site mutating calls must be rejected.
 */
import { describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "./route";
import { ID_COOKIE, ACCESS_COOKIE } from "@/lib/auth/cookies";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function mintToken(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256" })}.${b64url(payload)}.signature`;
}
const NOW = Math.floor(Date.now() / 1000);

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/session", () => {
  it("sets httpOnly SameSite=Strict cookies for id + access tokens", async () => {
    const id = mintToken({ sub: "user-1", exp: NOW + 3600 });
    const access = mintToken({ scope: "openid", exp: NOW + 3600 });
    const res = await POST(post({ id_token: id, access_token: access }));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const idCookie = cookies.find((c) => c.startsWith(`${ID_COOKIE}=`));
    const accessCookie = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    expect(idCookie).toBeDefined();
    expect(accessCookie).toBeDefined();
    for (const c of cookies) {
      expect(c).toContain("HttpOnly");
      expect(c).toContain("SameSite=Strict");
    }
    // Body never echoes the token back.
    expect(await res.text()).not.toContain(id);
  });

  it("accepts an OPAQUE access token (the authority issues opaque, not JWT)", async () => {
    // Real-world panva opaque access token: base64url-ish, no dots, ~43 chars.
    const id = mintToken({ sub: "user-1", exp: NOW + 3600 });
    const opaqueAccess = "qDcR8Uz1Kisfn5q5PIDS4k0zCugIfIWHUpZdnDuLUDA";
    const res = await POST(post({ id_token: id, access_token: opaqueAccess }));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${ID_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
  });

  it("caps the cookie lifetime at the token exp (and at 24h)", async () => {
    const res = await POST(post({ id_token: mintToken({ sub: "u", exp: NOW + 120 }) }));
    const [cookie] = res.headers.getSetCookie();
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(121);

    const far = await POST(post({ id_token: mintToken({ sub: "u", exp: NOW + 10 * 86400 }) }));
    const farAge = Number(/Max-Age=(\d+)/.exec(far.headers.getSetCookie()[0])?.[1]);
    expect(farAge).toBeLessThanOrEqual(24 * 3600);
  });

  it("rejects a non-JWT or missing id_token", async () => {
    expect((await POST(post({ id_token: "not a jwt" }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
  });

  it("rejects a malformed access token (whitespace / oversize), not an opaque one", async () => {
    const id = mintToken({ sub: "u", exp: NOW + 3600 });
    // Whitespace is outside the opaque-token charset.
    expect((await POST(post({ id_token: id, access_token: "has space" }))).status).toBe(400);
    // Oversize (>8192) is rejected.
    expect(
      (await POST(post({ id_token: id, access_token: "a".repeat(8193) }))).status,
    ).toBe(400);
  });

  it("rejects cross-site callers (Sec-Fetch-Site)", async () => {
    const res = await POST(
      post({ id_token: mintToken({ sub: "u" }) }, { "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/auth/session", () => {
  it("returns authenticated:false with no cookie", async () => {
    const res = await GET(new Request("http://localhost/api/auth/session"));
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("hydrates sub + lower-cased wallet from the cookie's claims", async () => {
    const token = mintToken({
      sub: "did:cit:User-1",
      wallet_address: "0xABCDEF0000000000000000000000000000000001",
      exp: NOW + 3600,
    });
    const res = await GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: `${ID_COOKIE}=${encodeURIComponent(token)}` },
      }),
    );
    const j = await res.json();
    expect(j.authenticated).toBe(true);
    expect(j.sub).toBe("did:cit:User-1"); // verbatim — sub is case-sensitive (SR-0)
    expect(j.walletAddress).toBe("0xabcdef0000000000000000000000000000000001");
  });
});

describe("DELETE /api/auth/session", () => {
  it("clears both cookies server-side (Max-Age=0, still HttpOnly)", async () => {
    const res = await DELETE(new Request("http://localhost/api/auth/session", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${ID_COOKIE}=;`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=;`))).toBe(true);
    for (const c of cookies) {
      expect(c).toContain("Max-Age=0");
      expect(c).toContain("HttpOnly");
    }
  });

  it("rejects cross-site callers", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/auth/session", {
        method: "DELETE",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
