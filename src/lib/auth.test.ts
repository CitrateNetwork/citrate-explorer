import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyPrivySession } from "./auth";

// Unit coverage for the auth gate's env-driven behavior (WP-1.7). Live Privy
// verification needs a real app + token (provisioned in the handoff) and is
// covered by an integration test once NEXT_PUBLIC_PRIVY_APP_ID is set.
describe("verifyPrivySession (WP-1.7)", () => {
  const saved = {
    id: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    secret: process.env.PRIVY_APP_SECRET,
  };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
  });
  afterEach(() => {
    if (saved.id) process.env.NEXT_PUBLIC_PRIVY_APP_ID = saved.id;
    if (saved.secret) process.env.PRIVY_APP_SECRET = saved.secret;
  });

  it("is not required when Privy is unconfigured (open gate in local dev)", async () => {
    const res = await verifyPrivySession(new Request("http://x"));
    expect(res.required).toBe(false);
    expect(res.ok).toBe(false);
  });

  it("is required but not ok when configured without a token", async () => {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app";
    process.env.PRIVY_APP_SECRET = "test-secret";
    const res = await verifyPrivySession(new Request("http://x"));
    expect(res.required).toBe(true);
    expect(res.ok).toBe(false);
  });
});
