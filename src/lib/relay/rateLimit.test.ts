import { describe, it, expect, afterEach } from "vitest";
import {
  slidingWindowLimit,
  checkRelayRateLimit,
  parseLimit,
  relayLimits,
  DEFAULT_MAX_PER_FROM_PER_HOUR,
  DEFAULT_MAX_PER_IP_PER_HOUR,
  RELAY_WINDOW_MS,
} from "./rateLimit";

// SECREM-01 WEB-2 (pre-audit 2026-06-09): red-test coverage for the relay
// rate limiter. Keys are unique per test (the Map is module-global) and `now`
// is injected so no test ever sleeps.

const T0 = 1_750_000_000_000; // arbitrary fixed epoch ms

describe("slidingWindowLimit — hourly window core", () => {
  it("allows requests under the limit", () => {
    const id = `t:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      expect(slidingWindowLimit(id, 5, T0 + i).ok).toBe(true);
    }
  });

  it("rejects the request that exceeds the limit, with a retryAfter", () => {
    const id = `t:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) slidingWindowLimit(id, 3, T0 + i);
    const blocked = slidingWindowLimit(id, 3, T0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // Oldest hit was at T0 → frees up one window-length later.
    expect(blocked.retryAfter).toBeLessThanOrEqual(RELAY_WINDOW_MS / 1000);
  });

  it("resets after the window expires", () => {
    const id = `t:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) slidingWindowLimit(id, 3, T0 + i);
    expect(slidingWindowLimit(id, 3, T0 + 10).ok).toBe(false);
    // Just past the window from the oldest hit — slot frees up again.
    expect(slidingWindowLimit(id, 3, T0 + RELAY_WINDOW_MS + 1).ok).toBe(true);
  });

  it("slides rather than hard-resets: only expired hits free slots", () => {
    const id = `t:${crypto.randomUUID()}`;
    slidingWindowLimit(id, 2, T0); // expires at T0 + window
    slidingWindowLimit(id, 2, T0 + 1000); // expires later
    const t = T0 + RELAY_WINDOW_MS + 1; // first hit expired, second still live
    expect(slidingWindowLimit(id, 2, t).ok).toBe(true); // takes freed slot
    expect(slidingWindowLimit(id, 2, t).ok).toBe(false); // window full again
  });

  it("counts keys independently", () => {
    const a = `t:${crypto.randomUUID()}`;
    const b = `t:${crypto.randomUUID()}`;
    expect(slidingWindowLimit(a, 1, T0).ok).toBe(true);
    expect(slidingWindowLimit(a, 1, T0 + 1).ok).toBe(false);
    expect(slidingWindowLimit(b, 1, T0 + 1).ok).toBe(true);
  });
});

describe("checkRelayRateLimit — dual from+IP gate", () => {
  const addr = () => `0x${crypto.randomUUID().replaceAll("-", "").slice(0, 40)}`;
  const ip = () => `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}:${crypto.randomUUID()}`;

  it("under-limit requests pass", () => {
    const res = checkRelayRateLimit(addr(), ip(), T0);
    expect(res.ok).toBe(true);
    expect(res.scope).toBeUndefined();
  });

  it("blocks the per-from cap (default 30/hour) even across rotating IPs", () => {
    const from = addr();
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) {
      expect(checkRelayRateLimit(from, ip(), T0 + i).ok).toBe(true);
    }
    const blocked = checkRelayRateLimit(from, ip(), T0 + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.scope).toBe("from");
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("blocks the per-IP cap (default 60/hour) even across rotating from-addresses", () => {
    const sharedIp = ip();
    for (let i = 0; i < DEFAULT_MAX_PER_IP_PER_HOUR; i++) {
      expect(checkRelayRateLimit(addr(), sharedIp, T0 + i).ok).toBe(true);
    }
    const blocked = checkRelayRateLimit(addr(), sharedIp, T0 + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.scope).toBe("ip");
  });

  it("treats from-addresses case-insensitively (no cap bypass via checksum casing)", () => {
    const from = addr();
    expect(checkRelayRateLimit(from.toLowerCase(), ip(), T0).ok).toBe(true);
    // Same address, different casing, fresh IP, limit of 30 → still counted
    // against the same from-key. Exhaust it:
    for (let i = 1; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) {
      checkRelayRateLimit(from.toUpperCase().replace("0X", "0x"), ip(), T0 + i);
    }
    const blocked = checkRelayRateLimit(from, ip(), T0 + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.scope).toBe("from");
  });

  it("a blocked from-address frees up after the window expires", () => {
    const from = addr();
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) {
      checkRelayRateLimit(from, ip(), T0 + i);
    }
    expect(checkRelayRateLimit(from, ip(), T0 + 1000).ok).toBe(false);
    expect(checkRelayRateLimit(from, ip(), T0 + RELAY_WINDOW_MS + DEFAULT_MAX_PER_FROM_PER_HOUR).ok).toBe(true);
  });
});

describe("limit configuration — fail-closed env parsing", () => {
  afterEach(() => {
    delete process.env.RELAY_MAX_PER_FROM_PER_HOUR;
    delete process.env.RELAY_MAX_PER_IP_PER_HOUR;
  });

  it("uses defaults when env is unset", () => {
    expect(relayLimits()).toEqual({
      fromLimit: DEFAULT_MAX_PER_FROM_PER_HOUR,
      ipLimit: DEFAULT_MAX_PER_IP_PER_HOUR,
    });
  });

  it("honors valid positive-integer overrides", () => {
    process.env.RELAY_MAX_PER_FROM_PER_HOUR = "5";
    process.env.RELAY_MAX_PER_IP_PER_HOUR = "7";
    expect(relayLimits()).toEqual({ fromLimit: 5, ipLimit: 7 });
  });

  it("falls back to the conservative default on malformed values (never unlimited)", () => {
    expect(parseLimit("banana", 30)).toBe(30);
    expect(parseLimit("0", 30)).toBe(30);
    expect(parseLimit("-5", 30)).toBe(30);
    expect(parseLimit("3.5", 30)).toBe(30);
    expect(parseLimit("Infinity", 30)).toBe(30);
    expect(parseLimit("NaN", 30)).toBe(30);
    expect(parseLimit("", 30)).toBe(30);
    expect(parseLimit("  ", 30)).toBe(30);
  });

  it("an env override actually tightens the live gate", () => {
    process.env.RELAY_MAX_PER_FROM_PER_HOUR = "2";
    const from = `0x${crypto.randomUUID().replaceAll("-", "").slice(0, 40)}`;
    expect(checkRelayRateLimit(from, `ip:${from}`, T0).ok).toBe(true);
    expect(checkRelayRateLimit(from, `ip:${from}`, T0 + 1).ok).toBe(true);
    const blocked = checkRelayRateLimit(from, `ip:${from}`, T0 + 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.scope).toBe("from");
  });
});
