import { describe, it, expect, vi } from "vitest";

// FUA-EXPLORER-03: /api/verify must bound its expensive, unauthenticated compile
// surface — per-IP rate limit, a source-size cap, and a concurrent-compile cap.
// Mock the compiler so the happy path is cheap and we can exercise the guards.
vi.mock("@/lib/verify", () => ({
  submitVerification: async () => ({ status: "pass", guid: "test-guid" }),
}));

import { POST } from "./route";

const VALID = {
  address: "0x" + "a".repeat(40),
  compilerVersion: "0.8.26",
  source: "contract X {}",
};

function verifyReq(ip: string, body: unknown): Request {
  // FWA-C12-04: identity comes from the trusted (right-most) XFF hop, not a raw
  // client header — so the limiter buckets per real client IP here.
  return new Request("http://x/api/verify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

describe("/api/verify caps (FUA-EXPLORER-03)", () => {
  it("400 when source exceeds the size cap", async () => {
    const big = { ...VALID, source: "x".repeat(3 * 1024 * 1024) };
    const res = await POST(verifyReq("198.51.100.1", big));
    expect(res.status).toBe(400);
  });

  it("429 once the per-IP rate is exceeded", async () => {
    const ip = "198.51.100.2";
    let last = 0;
    for (let i = 0; i < 7; i++) {
      last = (await POST(verifyReq(ip, VALID))).status; // 200 until the burst, then 429
    }
    expect(last).toBe(429);
  });
});
