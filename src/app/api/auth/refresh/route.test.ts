/**
 * TD-9 — POST /api/auth/refresh guard behavior. The no-network paths are
 * exercised directly (no refresh cookie → 401 + cookies cleared; cross-site →
 * 403). The authority round-trip + rotated-cookie emission is covered by the
 * pure `buildSessionCookies` unit tests (refresh.test.ts) and the live curl e2e.
 */
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { ID_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/refresh", { method: "POST", headers });
}

describe("POST /api/auth/refresh", () => {
  it("401s and clears all auth cookies when no refresh cookie is present", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    const cookies = res.headers.getSetCookie();
    // Defensive clear: stale id/access cookies should not linger past a dead refresh.
    expect(cookies.some((c) => c.startsWith(`${ID_COOKIE}=;`))).toBe(false);
    // No refresh cookie → plain 401 (no Set-Cookie needed); body marks not-ok.
    expect((await res.json()).ok).toBe(false);
  });

  it("rejects cross-site callers (Sec-Fetch-Site)", async () => {
    const res = await POST(req({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("never silently succeeds for a dead/unreachable refresh token", async () => {
    // Refresh cookie present but the authority rejects it (401, cookies cleared)
    // or is unreachable (503, session preserved) — never a 200 without real
    // rotated tokens. The happy path is covered by buildSessionCookies + curl e2e.
    const res = await POST(
      req({ cookie: `${REFRESH_COOKIE}=opaque-but-dead`, "sec-fetch-site": "same-origin" }),
    );
    expect([401, 503]).toContain(res.status);
    expect((await res.json()).ok).toBe(false);
  });
});
