import { describe, it, expect, vi } from "vitest";
import { logoutUrl, sessionEventsUrl, oidcEndpoints } from "./discovery";

// Spec (AUTH_HANDOFF §3): never hardcode endpoints; panva's authorization
// endpoint is /auth, NOT /authorize. These guard against the exact regression.
describe("auth/discovery", () => {
  it("derives the Citrate session endpoints from the issuer origin", () => {
    expect(logoutUrl().endsWith("/logout")).toBe(true);
    expect(sessionEventsUrl().endsWith("/sessions/events")).toBe(true);
  });

  it("falls back to /auth (panva), NOT /authorize, when discovery is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
    const ep = await oidcEndpoints();
    expect(ep.authorization.endsWith("/auth")).toBe(true);
    expect(ep.authorization.endsWith("/authorize")).toBe(false);
    expect(ep.token.endsWith("/token")).toBe(true);
    vi.unstubAllGlobals();
  });
});
