import { describe, it, expect } from "vitest";
import { extractApiKey, clientIp, validateApiKey } from "./keys";

describe("extractApiKey", () => {
  it("reads ?apikey= from the query string", () => {
    const req = new Request("http://x/api/v1?module=proxy&apikey=ABC123");
    expect(extractApiKey(req)).toBe("ABC123");
  });

  it("reads a Bearer authorization header", () => {
    const req = new Request("http://x/api/mcp", {
      headers: { authorization: "Bearer secret-key" },
    });
    expect(extractApiKey(req)).toBe("secret-key");
  });

  it("prefers the query param over the header", () => {
    const req = new Request("http://x/api/v1?apikey=fromquery", {
      headers: { authorization: "Bearer fromheader" },
    });
    expect(extractApiKey(req)).toBe("fromquery");
  });

  it("returns null when no key is present", () => {
    expect(extractApiKey(new Request("http://x/api/v1"))).toBeNull();
  });
});

describe("clientIp (FUA-EXPLORER-02 / FWA-C12-04 — trusted IP)", () => {
  it("does NOT trust a raw x-real-ip by default (it is client-forgeable)", () => {
    // FWA-C12-04: x-real-ip is only honored under CITRATE_TRUST_X_REAL_IP=1.
    // Default deploy: with XFF present, the trusted right-most hop wins; the
    // forged x-real-ip is ignored.
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9", "x-real-ip": "6.6.6.6" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("uses the RIGHT-most x-forwarded-for hop (the one the trusted proxy appended)", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("10.0.0.1");
  });

  it("does NOT trust the spoofable left-most hop", () => {
    // An attacker prepends a fake IP to rotate the limiter bucket; the trusted
    // (appended) hop is what we key on.
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "evil-spoof, 9.9.9.9" },
    });
    expect(clientIp(req)).not.toBe("evil-spoof");
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to a sentinel when no IP headers are present", () => {
    expect(clientIp(new Request("http://x"))).toBe("0.0.0.0");
  });
});

describe("validateApiKey — no key / no store", () => {
  it("treats a missing key as anonymous with the public limit", async () => {
    const res = await validateApiKey(null, "203.0.113.7");
    expect(res.valid).toBe(false);
    expect(res.anonymous).toBe(true);
    expect(res.perSec).toBe(2);
  });

  it("falls back to anonymous when the store is unprovisioned (does not fail closed)", async () => {
    // No DATABASE_URL in the test env → getDb() is null.
    const res = await validateApiKey("some-unverifiable-key", "203.0.113.7");
    expect(res.valid).toBe(false);
    expect(res.anonymous).toBe(true);
  });
});
