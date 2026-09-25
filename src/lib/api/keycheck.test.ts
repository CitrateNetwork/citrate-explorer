/**
 * The API-key KDF must never run on malformed input, and a single IP's well-formed guesses are
 * throttled before hashing (verify2 blocker). hashApiKey is wrapped with a counting mock so the
 * assertions observe the real call sites in lib/api/keys.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.API_KEY_PEPPER ??= "unit-test-pepper-not-a-secret-0000000000";
  return { calls: 0, selects: 0 };
});

vi.mock("@/lib/crypto", async (orig) => {
  const real = await orig<typeof import("@/lib/crypto")>();
  return {
    ...real,
    hashApiKey: (k: string) => {
      h.calls += 1;
      return real.hashApiKey(k);
    },
  };
});

vi.mock("@/lib/db/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "set"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res);
  chain.catch = () => Promise.resolve();
  return {
    getDb: () => ({
      select: () => {
        h.selects += 1;
        return chain;
      },
      update: () => chain,
    }),
    isDbEnabled: () => true,
  };
});

import { validateApiKey, KEY_CHECK_BURST } from "./keys";

const K = (c: string) => `cscan_${c.repeat(32).slice(0, 32)}`;

beforeEach(() => {
  h.calls = 0;
  h.selects = 0;
});

describe("API-key KDF gating", () => {
  it("malformed keys (incl. a 1 MB key) never reach the KDF or the DB", async () => {
    for (const k of ["nope", "cscan_short", `cscan_${"A".repeat(33)}`, "x".repeat(1_000_000), `Bearer ${K("a")}`, `${K("a")} `]) {
      expect(await validateApiKey(k, "7.7.2.1")).toEqual({ valid: false, anonymous: false, id: "bad:7.7.2.1", perSec: 0 });
    }
    expect(h.calls).toBe(0);
    expect(h.selects).toBe(0);
  });

  it("a well-formed key is hashed exactly once", async () => {
    await validateApiKey(K("w"), "7.7.2.2");
    expect(h.calls).toBe(1);
  });

  it("repeated well-formed bad keys from one IP stop being hashed after the budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    try {
      const ip = "7.7.3.9";
      for (let i = 0; i < KEY_CHECK_BURST; i++) {
        expect((await validateApiKey(K(String.fromCharCode(97 + (i % 26))), ip)).id).toBe(`bad:${ip}`);
      }
      for (let i = 0; i < 5; i++) {
        expect(await validateApiKey(K("q"), ip)).toMatchObject({ valid: false, throttled: true, id: `throttle:${ip}` });
      }
      expect(h.calls).toBe(KEY_CHECK_BURST);
      // A different IP still gets its own budget.
      await validateApiKey(K("q"), "7.7.3.10");
      expect(h.calls).toBe(KEY_CHECK_BURST + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("key-check budget fails closed; missing pepper is a clean 503", () => {
  it("M2: a shared-store error on the key-check budget refuses the key and skips the KDF", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("store down");
    }));
    vi.resetModules();
    try {
      const { validateApiKey: fresh } = await import("./keys");
      expect(await fresh(K("s"), "7.7.5.1")).toMatchObject({ valid: false, throttled: true, id: "throttle:7.7.5.1" });
      expect(h.calls).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("no API_KEY_PEPPER: a well-formed key is reported unavailable, not thrown, and never hashed", async () => {
    const saved = process.env.API_KEY_PEPPER;
    delete process.env.API_KEY_PEPPER;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await validateApiKey(K("p"), "7.7.6.1")).toMatchObject({ valid: false, unavailable: true, id: "unavailable:7.7.6.1" });
      expect(h.calls).toBe(0);
      const { GET } = await import("@/app/api/v1/route");
      const v1 = await GET(new Request(`http://x/api/v1?module=foo&action=bar&apikey=${K("p")}`, { headers: { "x-forwarded-for": "7.7.6.2" } }));
      expect(v1.status).toBe(503);
      expect(await v1.json()).toEqual({ status: "0", message: "API key service unavailable", result: null });
      const { POST: MCP } = await import("@/app/api/mcp/route");
      const mcp = await MCP(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${K("p")}`, "x-forwarded-for": "7.7.6.3" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }));
      expect(mcp.status).toBe(503);
      expect((await mcp.json()).error).toEqual({ code: -32000, message: "API key service unavailable" });
      // Anonymous traffic is unaffected.
      const anon = await GET(new Request("http://x/api/v1?module=foo&action=bar", { headers: { "x-forwarded-for": "7.7.6.4" } }));
      expect(anon.status).toBe(200);
    } finally {
      process.env.API_KEY_PEPPER = saved;
      err.mockRestore();
    }
  });
});
