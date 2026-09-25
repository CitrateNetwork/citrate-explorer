/**
 * PBA-L3c-017 (login CSRF on /api/auth/session) and PBA-L3c-018 (cookie-auth
 * mutations without an Origin / Sec-Fetch-Site guard).
 *
 * Route-level: every cookie-authenticated mutating handler is driven with a
 * forged cross-origin request carrying the victim's auth cookie and must answer
 * 403 before doing anything. Unit-level: the guard's decision table.
 */
import { describe, it, expect, vi } from "vitest";
import { checkSameOrigin } from "./sameOrigin";

vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  requireOwner: vi.fn(async () => "victim-sub"),
}));

const jwt = (p: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(p)).toString("base64url")}.sig`;
const COOKIE = `citrate_oidc_id=${jwt({ sub: "victim-sub", exp: 9999999999 })}`;

function req(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  return new Request(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

describe("checkSameOrigin decision table", () => {
  const U = "https://explorer.citrate.ai/api/x";
  it.each([
    ["same-origin Sec-Fetch-Site", { "sec-fetch-site": "same-origin", cookie: COOKIE }, true],
    ["Sec-Fetch-Site none (user-initiated)", { "sec-fetch-site": "none", cookie: COOKIE }, true],
    ["same-site subdomain (Sec-Fetch-Site same-site)", { "sec-fetch-site": "same-site", cookie: COOKIE }, false],
    ["cross-site Sec-Fetch-Site", { "sec-fetch-site": "cross-site", cookie: COOKIE }, false],
    ["matching Origin, no Sec-Fetch-Site", { origin: "https://explorer.citrate.ai", cookie: COOKIE }, true],
    ["foreign Origin, no Sec-Fetch-Site", { origin: "https://evil.example", cookie: COOKIE }, false],
    ["sibling subdomain Origin", { origin: "https://docs.citrate.ai", cookie: COOKIE }, false],
    ["Origin: null (sandboxed iframe)", { origin: "null", cookie: COOKIE }, false],
    ["same-origin fetch but foreign Origin", { "sec-fetch-site": "same-origin", origin: "https://evil.example", cookie: COOKIE }, false],
    ["no signals + auth cookie", { cookie: COOKIE }, false],
    ["no signals + Bearer (non-browser API client)", { authorization: "Bearer abc" }, true],
    ["no signals, no credentials (nothing to forge)", {}, true],
  ])("%s", (_n, headers, allowed) => {
    expect(checkSameOrigin(req("POST", U, headers as Record<string, string>)) === null).toBe(allowed);
  });

  it("requireBrowserSignal refuses a request with neither Origin nor Sec-Fetch-Site, even without cookies", () => {
    const r = checkSameOrigin(req("POST", U, {}), { requireBrowserSignal: true });
    expect(r?.status).toBe(403);
  });

  it("requireJson refuses a CORS-simple text/plain body with 415", () => {
    const r = checkSameOrigin(req("POST", U, { "sec-fetch-site": "same-origin", "content-type": "text/plain" }), { requireJson: true });
    expect(r?.status).toBe(415);
    expect(checkSameOrigin(req("POST", U, { "sec-fetch-site": "same-origin", "content-type": "application/json; charset=utf-8" }), { requireJson: true })).toBeNull();
  });

  it("honours NEXT_PUBLIC_SITE_URL as an extra allowed origin (proxied host)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://scan.citrate.ai/");
    try {
      expect(checkSameOrigin(req("POST", "http://internal:3000/api/x", { origin: "https://scan.citrate.ai", cookie: COOKIE }))).toBeNull();
      expect(checkSameOrigin(req("POST", "http://internal:3000/api/x", { origin: "https://scan.citrate.ai.evil.example", cookie: COOKIE }))?.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("login CSRF on /api/auth/session (PBA-L3c-017)", () => {
  it("the audit PoC (text/plain, foreign Origin, no Sec-Fetch-Site) is refused and plants no cookie", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      req("POST", "http://x/api/auth/session", { "content-type": "text/plain", origin: "https://evil.example" }, { id_token: jwt({ sub: "attacker", exp: 9999999999 }) }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("no Origin and no Sec-Fetch-Site (legacy UA) is refused", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(req("POST", "http://x/api/auth/session", { "content-type": "application/json" }, { id_token: jwt({ sub: "a" }) }));
    expect(res.status).toBe(403);
  });

  it("same-origin text/plain is refused (415): only the JSON callback shape is accepted", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(req("POST", "http://x/api/auth/session", { "content-type": "text/plain", origin: "http://x" }, { id_token: jwt({ sub: "a" }) }));
    expect(res.status).toBe(415);
  });

  it("the real callback shape (same-origin JSON) still sets the cookie", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      req("POST", "http://x/api/auth/session", { "content-type": "application/json", origin: "http://x", "sec-fetch-site": "same-origin" }, { id_token: jwt({ sub: "a", exp: 9999999999 }) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("citrate_oidc_id=");
  });

  it("refresh refuses a foreign Origin without Sec-Fetch-Site", async () => {
    const { POST } = await import("@/app/api/auth/refresh/route");
    const res = await POST(req("POST", "http://x/api/auth/refresh", { origin: "https://evil.example", cookie: "citrate_oidc_refresh=r" }));
    expect(res.status).toBe(403);
  });
});

describe("cookie-auth mutations refuse forged cross-origin requests (PBA-L3c-018)", () => {
  const forged = { origin: "https://evil.example", cookie: COOKIE, "content-type": "application/json" };
  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  const cases: Array<[string, () => Promise<Response>]> = [
    ["POST /api/keys", async () => (await import("@/app/api/keys/route")).POST(req("POST", "http://x/api/keys", forged, { label: "x" }))],
    ["DELETE /api/keys", async () => (await import("@/app/api/keys/route")).DELETE(req("DELETE", "http://x/api/keys?id=1", forged))],
    ["POST /api/watchlist", async () => (await import("@/app/api/watchlist/route")).POST(req("POST", "http://x/api/watchlist", forged, {}))],
    ["DELETE /api/watchlist", async () => (await import("@/app/api/watchlist/route")).DELETE(req("DELETE", "http://x/api/watchlist?id=1", forged))],
    ["POST /api/threads", async () => (await import("@/app/api/threads/route")).POST(req("POST", "http://x/api/threads", forged, {}))],
    ["PATCH /api/threads/[id]", async () => (await import("@/app/api/threads/[id]/route")).PATCH(req("PATCH", "http://x/api/threads/t", forged, { title: "x" }), params({ id: "t" }))],
    ["DELETE /api/threads/[id]", async () => (await import("@/app/api/threads/[id]/route")).DELETE(req("DELETE", "http://x/api/threads/t", forged), params({ id: "t" }))],
    ["POST /api/chat", async () => (await import("@/app/api/chat/route")).POST(req("POST", "http://x/api/chat", forged, { messages: [] }))],
    ["PUT /api/settings", async () => (await import("@/app/api/settings/route")).PUT(req("PUT", "http://x/api/settings", forged, {}))],
    ["DELETE /api/account", async () => (await import("@/app/api/account/route")).DELETE(req("DELETE", "http://x/api/account", forged))],
    ["POST /api/relay", async () => (await import("@/app/api/relay/route")).POST(req("POST", "http://x/api/relay", forged, {}))],
    ["DELETE /api/auth/session", async () => (await import("@/app/api/auth/session/route")).DELETE(req("DELETE", "http://x/api/auth/session", forged))],
  ];
  for (const [name, call] of cases) {
    it(`${name} → 403`, async () => {
      const res = await call();
      expect(res.status).toBe(403);
    });
  }
});

describe("source tripwire: every cookie-auth mutating handler is guarded", () => {
  it("each POST/PUT/PATCH/DELETE in a route that reads the session calls checkSameOrigin", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const API = join(__dirname, "..", "..", "app", "api");
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (n === "route.ts") out.push(p);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const f of walk(API)) {
      const src = readFileSync(f, "utf8");
      if (!/requireOwner|verifySession|cookieValue\(/.test(src)) continue;
      const re = /export async function (POST|PUT|PATCH|DELETE)\b[^{]*\{([\s\S]*?)\n\}/g;
      for (const m of src.matchAll(re)) {
        if (!/checkSameOrigin\(req/.test(m[2].split("\n").slice(0, 8).join("\n"))) {
          offenders.push(`${relative(API, f)} ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
