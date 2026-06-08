import { describe, it, expect } from "vitest";
import { DefaultChatTransport } from "ai";

// Regression (explorer "session expired" on every device, 2026-06-08):
//
// The agent panel (`agent.tsx`) drives @ai-sdk/react's useChat, which captures
// its Chat — and therefore its transport — EXACTLY ONCE (a useRef; rebuilt only
// on chat/id change, never when the transport object changes). The OIDC bearer
// token resolves asynchronously one tick after mount (`auth.getToken().then(...)`),
// so a transport that baked the token into a STATIC header at construction time
// would freeze `Authorization: undefined` and send EVERY /api/chat request
// unauthenticated → 401 → "session expired", deterministically, on every browser
// and phone. The fix passes header/body FUNCTIONS that read live refs; the SDK
// re-resolves them on each request (HttpChatTransport.sendMessages →
// `await resolve(this.headers)`), so the freshly-minted token always rides along.
//
// These tests pin that behavior against the real `ai` package transport.

const REQ = {
  chatId: "t",
  messageId: "m",
  trigger: "submit-message",
  messages: [{ id: "m", role: "user", parts: [{ type: "text", text: "hi" }] }],
};

/** Capturing fetch: records the outgoing headers (lower-cased) then aborts before
 *  the SDK tries to parse a stream body — we only assert on what was sent. */
function capturingFetch() {
  const calls: Array<Record<string, string>> = [];
  const fetchImpl = async (_url: string, init: { headers?: Record<string, string> }) => {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) lower[k.toLowerCase()] = v;
    calls.push(lower);
    throw new Error("captured");
  };
  return { calls, fetchImpl };
}

describe("scan agent chat transport — auth header attachment", () => {
  it("attaches a token that resolves AFTER the transport is constructed (live header fn)", async () => {
    const tokenRef: { current: string | null } = { current: null };
    const { calls, fetchImpl } = capturingFetch();

    // Built exactly like agent.tsx: stable transport, header reads a live ref.
    const transport = new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchImpl as unknown as typeof fetch,
      headers: () => (tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}),
    });

    // Token arrives one tick later (mirrors auth.getToken().then(setToken)).
    tokenRef.current = "JWT123";

    await transport.sendMessages(REQ as never).catch(() => {});

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer JWT123");
  });

  it("the OLD static-header capture would have sent NO token (documents the bug)", async () => {
    // At construction the async token has not resolved yet, so the old code's
    // `token ? { Authorization } : undefined` froze an unauthenticated transport.
    const tokenAtConstruction: string | null = null;
    const { calls, fetchImpl } = capturingFetch();

    const transport = new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchImpl as unknown as typeof fetch,
      headers: tokenAtConstruction ? { Authorization: `Bearer ${tokenAtConstruction}` } : undefined,
    });

    await transport.sendMessages(REQ as never).catch(() => {});

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeUndefined();
  });
});
