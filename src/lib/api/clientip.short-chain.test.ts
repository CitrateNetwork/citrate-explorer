import { describe, it, expect, afterEach } from "vitest";
import { clientIp } from "./keys";
import { limitPublicRead, PUBLIC_READ_BURST } from "./publicRead";

/**
 * A forwarded-for chain SHORTER than the configured trusted-proxy count has no
 * trustworthy hop: every value in it may be caller-supplied. clientIp must then
 * use the shared sentinel, never one of those values, so rotating them cannot
 * mint fresh limiter buckets. Checked on the helper and at a limiter entry point.
 */
afterEach(() => {
  delete process.env.CITRATE_TRUSTED_PROXY_HOPS;
  delete process.env.CITRATE_TRUST_X_REAL_IP;
});

const req = (xff: string) => new Request("http://x/api/latest", { headers: { "x-forwarded-for": xff } });

describe("clientIp with fewer hops than trusted proxies", () => {
  it("returns the shared sentinel, not a caller-supplied hop", () => {
    process.env.CITRATE_TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(req("192.0.2.10"))).toBe("0.0.0.0");
    expect(clientIp(req("192.0.2.11"))).toBe("0.0.0.0");
  });

  it("still uses the trusted hop once the chain is long enough", () => {
    process.env.CITRATE_TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(req("192.0.2.10, 198.51.100.7, 10.0.0.1"))).toBe("198.51.100.7");
  });

  it("rotating a short chain does not escape the public-read budget", async () => {
    process.env.CITRATE_TRUSTED_PROXY_HOPS = "3";
    let last: Response | null = null;
    for (let i = 0; i <= PUBLIC_READ_BURST + 1; i++) {
      last = await limitPublicRead(req(`192.0.2.${i}, 198.51.100.${i}`));
      if (last) break;
    }
    expect(last?.status).toBe(429);
  });
});
