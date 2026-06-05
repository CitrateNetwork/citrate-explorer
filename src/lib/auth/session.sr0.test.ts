import { describe, it, expect } from "vitest";
import { requireOwner, sessionOwner } from "./session";

/**
 * SR-0: per-user data is owned by the stable OIDC `subject`, NOT the wallet.
 * These guard the directive that the Web2/Privy-like portal (Google/email/passkey)
 * produces first-class owners even with no wallet, and that `sub` is opaque +
 * case-sensitive (never lower-cased).
 */
function mockToken(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}
function req(token?: string): Request {
  return new Request("http://x/api/x", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("SR-0 — owner is the OIDC subject", () => {
  it("sessionOwner returns sub, ignoring the wallet, verbatim (no lower-casing)", () => {
    expect(
      sessionOwner({ required: true, authenticated: true, sub: "google-oauth2|abc", walletAddress: "0xDEAD" }),
    ).toBe("google-oauth2|abc");
    // Case-sensitive opaque id must survive untouched.
    expect(sessionOwner({ required: true, authenticated: true, sub: "Email|XyZ-123" })).toBe("Email|XyZ-123");
    // Wallet present but no sub → not an owner (sub is the key, not the wallet).
    expect(sessionOwner({ required: true, authenticated: true, walletAddress: "0xabc" })).toBeNull();
  });

  it("authorizes a wallet-LESS identity (sub only, no wallet_address)", async () => {
    const owner = await requireOwner(req(mockToken({ sub: "email-user-1" })));
    expect(owner).toBe("email-user-1");
  });

  it("still resolves the owner when a wallet is also present", async () => {
    const owner = await requireOwner(req(mockToken({ sub: "user-2", wallet_address: "0xfeed" })));
    expect(owner).toBe("user-2");
  });

  it("yields null when unauthenticated", async () => {
    expect(await requireOwner(req())).toBeNull();
  });
});
