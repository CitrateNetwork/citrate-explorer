/**
 * EXP-AGENT step 1: pin /api/chat's gates and wiring before the contract tools
 * land: same-origin, the auth gate, the per-identity rate limit, the registry it
 * hands the model, the step cap and the guardrailed system prompt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { required: boolean; authenticated: boolean; sub?: string; rateOk: boolean; streamArgs: Record<string, unknown> | null } = {
  required: false,
  authenticated: false,
  sub: undefined,
  rateOk: true,
  streamArgs: null,
};

vi.mock("@/lib/auth/session", () => ({
  verifySession: async () => ({ required: state.required, authenticated: state.authenticated, sub: state.sub }),
}));
vi.mock("@/lib/api/ratelimit", () => ({
  checkRateLimit: async () => (state.rateOk ? { ok: true } : { ok: false, retryAfter: 3 }),
}));
vi.mock("@/lib/ai/provider", () => ({
  getInferenceProvider: () => ({ mode: "local", modelId: "m", languageModel: () => ({}) }),
}));
vi.mock("ai", async (orig) => {
  const real = await orig<typeof import("ai")>();
  return {
    ...real,
    convertToModelMessages: async (m: unknown) => m,
    streamText: (args: Record<string, unknown>) => {
      state.streamArgs = args;
      return { toUIMessageStreamResponse: () => new Response("stream", { status: 200 }) };
    },
  };
});

import { POST } from "./route";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "192.0.2.77", ...headers },
    body: JSON.stringify(body),
  });
const msg = (text: string) => ({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text }] }] });

beforeEach(() => {
  state.required = false;
  state.authenticated = false;
  state.sub = undefined;
  state.rateOk = true;
  state.streamArgs = null;
});

describe("/api/chat gates (pinned)", () => {
  it("rejects a cross-site POST", async () => {
    const res = await POST(req(msg("hi"), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("401s when auth is required and missing", async () => {
    state.required = true;
    const res = await POST(req(msg("hi")));
    expect(res.status).toBe(401);
  });

  it("429s when the per-identity limit is spent", async () => {
    state.rateOk = false;
    const res = await POST(req(msg("hi")));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3");
  });
});

describe("/api/chat wiring (pinned)", () => {
  it("hands the model the shared registry, a step cap and the guardrailed prompt", async () => {
    const res = await POST(req(msg("what is block 5")));
    expect(res.status).toBe(200);
    const a = state.streamArgs!;
    const names = Object.keys(a.tools as object);
    for (const n of ["getTransaction", "callView", "getVerifiedSource", "ledger"]) expect(names).toContain(n);
    expect(String(a.system)).toContain("Untrusted data");
    expect(a.temperature).toBe(0.3);
    expect(a.stopWhen).toBeDefined();
  });
});
