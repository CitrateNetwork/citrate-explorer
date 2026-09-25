/**
 * PBA-L3c-012 tripwire: the distributed (Upstash) limiter must enforce the SAME
 * sustained rate as the in-memory token bucket. It used a 1-second window with
 * `burst` as the per-second cap, so /api/verify (0.2/s, burst 5) admitted 5/s in
 * production — 25x the intended rate.
 *
 * Parity rule: over any horizon T of continuous hammering, the Redis backend
 * admits at most what the token bucket admits (burst + perSec*T) plus one extra
 * window of burst (fixed-window edge effect).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

/** In-process Upstash REST fake: honours INCR/INCRBY + EXPIRE NX with TTLs. */
function fakeUpstash() {
  const store = new Map<string, { n: number; exp: number }>();
  const calls: unknown[][][] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://upstash.invalid/pipeline");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const cmds = JSON.parse(String(init.body)) as unknown[][];
    calls.push(cmds);
    const now = Date.now();
    const out: Array<{ result: number }> = [];
    for (const c of cmds) {
      const key = String(c[1]);
      let e = store.get(key);
      if (e && e.exp <= now) {
        store.delete(key);
        e = undefined;
      }
      if (c[0] === "INCR" || c[0] === "INCRBY") {
        const by = c[0] === "INCR" ? 1 : Number(c[2]);
        const n = (e?.n ?? 0) + by;
        store.set(key, { n, exp: e?.exp ?? Infinity });
        out.push({ result: n });
      } else if (c[0] === "EXPIRE") {
        expect(c[3]).toBe("NX");
        const cur = store.get(key);
        if (cur && cur.exp === Infinity) cur.exp = now + Number(c[2]) * 1000;
        out.push({ result: 1 });
      } else {
        throw new Error(`unexpected command ${String(c[0])}`);
      }
    }
    return new Response(JSON.stringify(out), { status: 200 });
  });
  return { fn, calls };
}

async function hammer(backend: "redis" | "memory", perSec: number, burst: number, seconds: number, stepMs = 100) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T00:00:00.300Z"));
  if (backend === "redis") {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", fakeUpstash().fn);
  }
  vi.resetModules();
  const { checkRateLimit } = await import("./ratelimit");
  const id = `parity:${backend}:${perSec}:${burst}:${Math.random()}`;
  let ok = 0;
  for (let t = 0; t < seconds * 1000; t += stepMs) {
    const r = await checkRateLimit(id, perSec, burst);
    expect(r.backend).toBe(backend);
    if (r.ok) ok++;
    vi.setSystemTime(Date.now() + stepMs);
  }
  return ok;
}

describe("Upstash limiter parity with the token bucket (PBA-L3c-012)", () => {
  // /api/verify, anon v1/mcp, keyed v1, chat-ish, fractional.
  const cases: Array<[number, number]> = [
    [0.2, 5],
    [2, 5],
    [5, 10],
    [1, 2],
    [0.5, 3],
  ];

  for (const [perSec, burst] of cases) {
    it(`perSec=${perSec} burst=${burst}: redis admits no more than the bucket (+1 window) over 30s`, async () => {
      const T = 30;
      const redis = await hammer("redis", perSec, burst, T);
      const ceiling = burst + perSec * T + burst;
      expect(redis).toBeLessThanOrEqual(ceiling);
      // …and is not pathologically stricter either (at least the sustained rate).
      expect(redis).toBeGreaterThanOrEqual(Math.floor(perSec * T * 0.5));
    });
  }

  it("the audit PoC: /api/verify (0.2/s, burst 5) admits at most 6 in 5s via redis", async () => {
    const redis = await hammer("redis", 0.2, 5, 5, 200);
    expect(redis).toBeLessThanOrEqual(6);
  });

  it("a denied redis request reports the seconds left in its window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const { fn, calls } = fakeUpstash();
    vi.stubGlobal("fetch", fn);
    vi.resetModules();
    const { checkRateLimit } = await import("./ratelimit");
    // perSec 0.2, burst 5 → a 25 s window.
    for (let i = 0; i < 5; i++) expect((await checkRateLimit("win:1", 0.2, 5)).ok).toBe(true);
    vi.setSystemTime(Date.now() + 10_000);
    const denied = await checkRateLimit("win:1", 0.2, 5);
    expect(denied).toEqual({ ok: false, retryAfter: 15, backend: "redis" });
    // The window key and TTL match the window length.
    const [incr, expire] = calls[0];
    expect(incr[0]).toBe("INCRBY");
    expect(incr[2]).toBe(1);
    expect(String(incr[1])).toMatch(/^rl:win:1:\d+$/);
    expect(expire).toEqual(["EXPIRE", incr[1], 25, "NX"]);
  });
});
