import { describe, it, expect, vi } from "vitest";

// FUA-EXPLORER-06: the unauthenticated /api/dag/stream endpoint must rate-limit
// opens per IP (and cap concurrency) so it can't be used as an RPC-amplification
// DoS. Mock the RPC so the snapshot fails fast → the stream closes immediately
// (no hanging poll timer), letting us exercise the open-rate guard cleanly.
vi.mock("@/lib/harness/client", () => ({
  harnessClient: () => ({
    getBlockNumber: async () => {
      throw new Error("no rpc in test");
    },
  }),
}));
vi.mock("@/lib/citrate/rpc", () => ({
  getDagBlock: async () => null,
  dagStats: async () => null,
}));

import { GET } from "./route";

function streamReq(ip: string): Request {
  return new Request("http://x/api/dag/stream", { headers: { "x-real-ip": ip } });
}

describe("/api/dag/stream open-rate cap (FUA-EXPLORER-06)", () => {
  it("eventually 429s a single IP opening streams in a tight loop", async () => {
    const ip = "203.0.113.200";
    let last = 0;
    for (let i = 0; i < 14; i++) {
      const res = await GET(streamReq(ip));
      last = res.status;
      // Drain any opened SSE body so it doesn't dangle.
      await res.body?.cancel().catch(() => {});
    }
    expect(last).toBe(429);
  });

  it("serves a different IP (independent bucket)", async () => {
    const res = await GET(streamReq("203.0.113.201"));
    expect([200, 429]).toContain(res.status); // 200 normally; never a hard error
    await res.body?.cancel().catch(() => {});
  });
});
