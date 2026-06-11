import { describe, it, expect, vi } from "vitest";

// FUA-EXPLORER-05: /api/chat must not reflect raw upstream/config error text to
// the client. Force the inference provider to throw a secret-bearing error and
// assert the 503 body is a generic message.
vi.mock("@/lib/auth/session", () => ({
  verifySession: async () => ({ required: false, authenticated: false, sub: undefined }),
}));

const SECRET = "INTERNAL_GATEWAY=https://user:supersecretkey@internal.host";
vi.mock("@/lib/ai/provider", () => ({
  getInferenceProvider: () => {
    throw new Error(SECRET);
  },
}));

import { POST } from "./route";

describe("/api/chat error sanitization (FUA-EXPLORER-05)", () => {
  it("503 returns a generic message, never the raw upstream/config error", async () => {
    const req = new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
      headers: { "content-type": "application/json", "x-real-ip": "192.0.2.50" },
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("supersecretkey");
    expect(text.toLowerCase()).toContain("not available");
  });
});
