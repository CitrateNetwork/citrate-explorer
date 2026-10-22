/**
 * Operation-cost accounting on the DISTRIBUTED limiter path.
 *
 * The in-memory bucket's cost handling is covered in ratelimit.test.ts; this
 * suite pins the shared-store path (the one production uses when Upstash is
 * configured): a request that fans out into N operations must add N to the
 * shared counter, and the cost is clamped to a positive integer so a caller
 * can never make a request free. The store is an in-process fake counter
 * reached through a stubbed `fetch`; no network is touched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

type Cmd = [string, ...unknown[]];
let counters: Map<string, number>;
let pipelines: Cmd[][];

function fakeUpstash() {
  counters = new Map();
  pipelines = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const cmds = JSON.parse(String(init?.body)) as Cmd[];
      pipelines.push(cmds);
      const out = cmds.map(([op, key, arg]) => {
        if (op === "INCRBY") {
          const n = (counters.get(String(key)) ?? 0) + Number(arg);
          counters.set(String(key), n);
          return { result: n };
        }
        if (op === "INCR") {
          const n = (counters.get(String(key)) ?? 0) + 1;
          counters.set(String(key), n);
          return { result: n };
        }
        return { result: 1 };
      });
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
}

async function load() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.resetModules();
  return await import("./ratelimit");
}

beforeEach(() => fakeUpstash());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const incrby = () => pipelines.flat().filter((c) => c[0] === "INCRBY" || c[0] === "INCR");

describe("checkRateLimit — shared-store operation cost", () => {
  it("adds the full operation cost to the shared counter in one INCRBY", async () => {
    const mod = await load();
    expect(mod.isDistributed()).toBe(true);
    const res = await mod.checkRateLimit("test:dist:cost", 2, 40, { cost: 20 });
    expect(res).toMatchObject({ ok: true, backend: "redis" });
    expect(incrby()).toHaveLength(1);
    expect(incrby()[0][0]).toBe("INCRBY");
    expect(incrby()[0][2]).toBe(20);
  });

  it("a batch costing more than the shared budget is denied on the first request", async () => {
    const mod = await load();
    const res = await mod.checkRateLimit("test:dist:over", 2, 5, { cost: 20 });
    expect(res.ok).toBe(false);
    expect(res.backend).toBe("redis");
  });

  it("N single-cost calls and one N-cost call consume the same shared budget", async () => {
    const mod = await load();
    for (let i = 0; i < 5; i++) {
      expect((await mod.checkRateLimit("test:dist:singles", 2, 5)).ok).toBe(true);
    }
    expect((await mod.checkRateLimit("test:dist:singles", 2, 5)).ok).toBe(false);

    expect((await mod.checkRateLimit("test:dist:batch", 2, 5, { cost: 5 })).ok).toBe(true);
    expect((await mod.checkRateLimit("test:dist:batch", 2, 5)).ok).toBe(false);
  });

  it("clamps zero, negative and fractional costs to a positive integer", async () => {
    const mod = await load();
    await mod.checkRateLimit("test:dist:zero", 2, 5, { cost: 0 });
    await mod.checkRateLimit("test:dist:neg", 2, 5, { cost: -7 });
    await mod.checkRateLimit("test:dist:frac", 2, 5, { cost: 1.2 });
    expect(incrby().map((c) => c[2])).toEqual([1, 1, 2]);
  });
});

describe("rateLimit — in-memory cost clamp via checkRateLimit", () => {
  it("a zero-cost request still spends a token (no free requests)", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.resetModules();
    const mod = await import("./ratelimit");
    expect(mod.isDistributed()).toBe(false);
    expect((await mod.checkRateLimit("test:mem:zero", 1, 1, { cost: 0 })).ok).toBe(true);
    expect((await mod.checkRateLimit("test:mem:zero", 1, 1, { cost: 0 })).ok).toBe(false);
  });
});
