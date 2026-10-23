// /api/agents/[tokenId]: when the node cannot serve a Transfer-log window yet (an exhausted
// retryable -32002), the route says "temporarily unavailable" with a 503, so the agent screen shows
// an error rather than an agent with an empty transfer history.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/harness/agentSbt", async (orig) => {
  const real = await orig<typeof import("@/lib/harness/agentSbt")>();
  const { LogsUnavailableError } = await import("@/lib/harness/logPaging");
  return {
    ...real,
    agentSbtSource: () => ({ client: {}, address: "0x00000000000000000000000000000000000a6e70" }),
    readAgent: async () => {
      throw new LogsUnavailableError(1_000n, 1_999n, 5);
    },
  };
});

import { GET as one } from "./[tokenId]/route";

describe("GET /api/agents/[tokenId] when transfer logs are unavailable", () => {
  it("is a 503 'temporarily unavailable' with retry-after", async () => {
    const res = await one(new Request("http://x/api/agents/0", { headers: { "x-forwarded-for": "10.72.0.1" } }), {
      params: Promise.resolve({ tokenId: "0" }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect((await res.json()).error).toMatch(/temporarily unavailable/);
  });
});
