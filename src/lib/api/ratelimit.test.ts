import { describe, it, expect, vi, afterEach } from "vitest";
import { rateLimit, checkRateLimit, isDistributed } from "./ratelimit";

// The bucket is keyed by id; using a unique id per test keeps them independent
// of one another and of any other caller in the process.
describe("rateLimit — in-memory token bucket", () => {
  it("allows up to `burst` requests, then blocks with a retryAfter", () => {
    const id = "test:burst:1";
    const perSec = 2; // burst defaults to max(perSec*2, 5) = 5
    const allowed = Array.from({ length: 5 }, () => rateLimit(id, perSec).ok);
    expect(allowed.every(Boolean)).toBe(true);

    const blocked = rateLimit(id, perSec);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("buckets independently per id", () => {
    const a = rateLimit("test:iso:a", 1, 1);
    const b = rateLimit("test:iso:b", 1, 1);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // a's only token is spent; b is untouched.
    expect(rateLimit("test:iso:a", 1, 1).ok).toBe(false);
    expect(rateLimit("test:iso:b", 1, 1).ok).toBe(false);
  });

  it("honors an explicit burst argument", () => {
    const id = "test:explicit-burst";
    expect(rateLimit(id, 1, 3).ok).toBe(true);
    expect(rateLimit(id, 1, 3).ok).toBe(true);
    expect(rateLimit(id, 1, 3).ok).toBe(true);
    expect(rateLimit(id, 1, 3).ok).toBe(false);
  });
});

describe("checkRateLimit — backend selection", () => {
  it("reports not-distributed when no store is configured (test env)", () => {
    // UPSTASH_REDIS_REST_URL/_TOKEN are unset in the test env.
    expect(isDistributed()).toBe(false);
  });

  it("falls back to the in-memory bucket and tags the backend", async () => {
    const id = "test:check:fallback";
    const first = await checkRateLimit(id, 1, 2);
    expect(first.ok).toBe(true);
    expect(first.backend).toBe("memory");
    await checkRateLimit(id, 1, 2); // spend the 2nd token
    const blocked = await checkRateLimit(id, 1, 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});

// EX-B-008: when a distributed store IS configured but errors, the default is
// fail-open (degrade to memory) but the money/expensive paths must fail CLOSED.
describe("checkRateLimit — fail-closed on store error (EX-B-008)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithStore() {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    // Every Upstash call rejects → simulate a store blip.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    vi.resetModules();
    return await import("./ratelimit");
  }

  it("default (fail-open): a store error degrades to the in-memory bucket", async () => {
    const mod = await loadWithStore();
    expect(mod.isDistributed()).toBe(true);
    const res = await mod.checkRateLimit("test:failopen", 5, 5);
    expect(res.ok).toBe(true);
    expect(res.backend).toBe("memory"); // degraded, not denied
  });

  it("failClosed: a store error DENIES the request (no per-instance downgrade)", async () => {
    const mod = await loadWithStore();
    expect(mod.isDistributed()).toBe(true);
    const res = await mod.checkRateLimit("test:failclosed", 5, 5, { failClosed: true });
    expect(res.ok).toBe(false);
    expect(res.backend).toBe("redis");
  });
});
