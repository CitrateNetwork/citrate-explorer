/**
 * Mutation-kill tests for the R2 hardening (PBA-L3c-012/-013/-016/-019/-034):
 * each case pins one decision in ratelimit.ts, errors.ts, publicRead.ts and
 * keys.ts that a surviving Stryker mutant showed was otherwise unobserved.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("ratelimit.ts", () => {
  it("default burst is 2x perSec (floor 5): perSec=5 admits exactly 10 at once", async () => {
    const { checkRateLimit } = await import("./ratelimit");
    const id = `burst-one-${Math.random()}`;
    let ok = 0;
    for (let i = 0; i < 12; i++) if ((await checkRateLimit(id, 5)).ok) ok++;
    expect(ok).toBe(10);
  });

  it("refills perSec tokens per second (not 1/perSec)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
    const { rateLimit } = await import("./ratelimit");
    const id = `refill-${Math.random()}`;
    for (let i = 0; i < 4; i++) expect(rateLimit(id, 4, 4).ok).toBe(true);
    expect(rateLimit(id, 4, 4).ok).toBe(false);
    vi.setSystemTime(Date.now() + 1000);
    let ok = 0;
    for (let i = 0; i < 5; i++) if (rateLimit(id, 4, 4).ok) ok++;
    expect(ok).toBe(4);
  });

  it("a memory denial reports the memory backend and a whole-second retry", async () => {
    const { rateLimit } = await import("./ratelimit");
    const id = `deny-${Math.random()}`;
    rateLimit(id, 1, 1);
    expect(rateLimit(id, 1, 1)).toEqual({ ok: false, retryAfter: 1, backend: "memory" });
  });

  it("isDistributed needs BOTH the URL and the token", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://u.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const { isDistributed } = await import("./ratelimit");
    expect(isDistributed()).toBe(false);
  });

  it.each([
    ["a non-2xx store response", () => new Response("no", { status: 500 })],
    ["a malformed store body", () => new Response(JSON.stringify([{}]), { status: 200 })],
    ["an empty store body", () => new Response(JSON.stringify(null), { status: 200 })],
  ])("%s degrades to the memory bucket (fail open) and denies when failClosed", async (_n, make) => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://u.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => make()));
    const { checkRateLimit } = await import("./ratelimit");
    expect(await checkRateLimit(`deg-${Math.random()}`, 5, 5)).toEqual({ ok: true, backend: "memory" });
    expect(await checkRateLimit(`deg-${Math.random()}`, 5, 5, { failClosed: true })).toEqual({ ok: false, retryAfter: 1, backend: "redis" });
  });
});

describe("errors.ts (PBA-L3c-016)", () => {
  it("a PublicError's own text is returned and nothing is logged", async () => {
    const { PublicError, publicMessage } = await import("./errors");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new PublicError("bad range");
    expect(e.name).toBe("PublicError");
    expect(publicMessage(e, "evt")).toBe("bad range");
    expect(spy).not.toHaveBeenCalled();
  });

  it("any other error is replaced by the fallback and logged with its detail", async () => {
    const { publicMessage } = await import("./errors");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicMessage(new Error("URL: http://secret-node"), "api.x")).toBe("upstream error; please retry");
    expect(publicMessage("raw string", "api.y", "custom")).toBe("custom");
    const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines[0]).toEqual({ level: "error", event: "api.x", error: "URL: http://secret-node" });
    expect(lines[1]).toEqual({ level: "error", event: "api.y", error: "raw string" });
  });
});

describe("publicRead.ts (PBA-L3c-019)", () => {
  it("buckets by IP under the read: prefix and answers a JSON 429 with the limiter's retry", async () => {
    const { publicReadBucket, limitPublicRead, PUBLIC_READ_BURST } = await import("./publicRead");
    expect(publicReadBucket("1.2.3.4")).toBe("read:1.2.3.4");
    const ip = `198.19.0.${Math.floor(Math.random() * 250)}`;
    const req = new Request("http://x", { headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < PUBLIC_READ_BURST; i++) expect(await limitPublicRead(req)).toBeNull();
    const res = await limitPublicRead(req);
    expect(res?.status).toBe(429);
    expect(await res!.json()).toEqual({ error: "rate limit exceeded" });
    expect(res!.headers.get("retry-after")).toBe("1");
  });
});

describe("extractApiKey", () => {
  it("strips exactly a leading 'Bearer <ws>+' prefix", async () => {
    const { extractApiKey } = await import("./keys");
    const h = (v: string) => new Request("http://x", { headers: { authorization: v } });
    expect(extractApiKey(h("Bearer  two-spaces"))).toBe("two-spaces");
    expect(extractApiKey(h("Token Bearer abc"))).toBe("Token Bearer abc");
  });

  it("allowQuery:false ignores ?apikey= but still reads the header", async () => {
    const { extractApiKey } = await import("./keys");
    const r = new Request("http://x/api/mcp?apikey=QK", { headers: { authorization: "Bearer HK" } });
    expect(extractApiKey(r, { allowQuery: false })).toBe("HK");
    expect(extractApiKey(new Request("http://x/api/mcp?apikey=QK"), { allowQuery: false })).toBeNull();
    expect(extractApiKey(new Request("http://x/api/mcp?apikey=QK"), { allowQuery: true })).toBe("QK");
  });
});
