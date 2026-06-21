import { describe, it, expect, afterEach } from "vitest";
import { clientIp } from "./keys";

/**
 * FWA-C12-04 (RED→GREEN): the rate-limit identity must be derived from a TRUSTED
 * hop, never an arbitrary client-supplied header. An attacker who forges
 * `x-real-ip` (or prepends fake `x-forwarded-for` hops) must NOT be able to mint a
 * fresh limiter bucket per request.
 *
 * Trust model (env-configurable, defaults to one trusted proxy — e.g. Vercel):
 *  - `CITRATE_TRUSTED_PROXY_HOPS` = number of trusted proxies in front of the app.
 *    The client IP is the Nth-from-the-right XFF hop (each trusted proxy appends
 *    exactly one hop on the right; the client can only forge left-hops).
 *  - raw `x-real-ip` is honored ONLY when `CITRATE_TRUST_X_REAL_IP=1` (a deploy
 *    where the platform guarantees x-real-ip is set/overwritten by it).
 */
afterEach(() => {
  delete process.env.CITRATE_TRUSTED_PROXY_HOPS;
  delete process.env.CITRATE_TRUST_X_REAL_IP;
});

function req(headers: Record<string, string>): Request {
  return new Request("http://x", { headers });
}

describe("clientIp — trusted-hop derivation (FWA-C12-04)", () => {
  it("a forged x-real-ip alone CANNOT set the limiter bucket (default trust model)", () => {
    // Default deploy: x-real-ip is NOT blindly trusted. With no XFF, a forged
    // x-real-ip per request must not yield a fresh, attacker-chosen bucket id.
    const a = clientIp(req({ "x-real-ip": "1.1.1.1" }));
    const b = clientIp(req({ "x-real-ip": "2.2.2.2" }));
    // Both forged values collapse to the same non-attacker-controlled sentinel.
    expect(a).toBe(b);
    expect(a).not.toBe("1.1.1.1");
    expect(a).not.toBe("2.2.2.2");
  });

  it("keys on the trusted (right-most) XFF hop the proxy appended, ignoring forged left hops", () => {
    // Attacker prepends fake hops; the real client IP is the right-most one the
    // single trusted proxy appended.
    const id = clientIp(
      req({ "x-forwarded-for": "evil-1, evil-2, 203.0.113.9" }),
    );
    expect(id).toBe("203.0.113.9");
  });

  it("forged left XFF hops cannot rotate the bucket (same trusted hop ⇒ same id)", () => {
    const a = clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }));
    const b = clientIp(req({ "x-forwarded-for": "8.8.8.8, 203.0.113.9" }));
    expect(a).toBe(b);
    expect(a).toBe("203.0.113.9");
  });

  it("honors raw x-real-ip ONLY when the deploy opts in (CITRATE_TRUST_X_REAL_IP=1)", () => {
    process.env.CITRATE_TRUST_X_REAL_IP = "1";
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("respects CITRATE_TRUSTED_PROXY_HOPS=2 (two proxies ⇒ 2nd-from-right hop)", () => {
    process.env.CITRATE_TRUSTED_PROXY_HOPS = "2";
    // chain: client, proxyA-appended-client, proxyB-appended-A → real client is
    // the 2nd-from-the-right hop. Forged left hops still cannot reach it.
    const id = clientIp(
      req({ "x-forwarded-for": "spoof, 203.0.113.42, 10.0.0.1" }),
    );
    expect(id).toBe("203.0.113.42");
  });
});
