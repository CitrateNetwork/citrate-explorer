import { describe, it, expect } from "vitest";
import { rateLimit } from "./ratelimit";

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
