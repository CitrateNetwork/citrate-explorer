/**
 * TD-9 refresh helpers. `buildSessionCookies` is the pure transform shared by the
 * refresh route: a token-endpoint response → Set-Cookie headers + display claims.
 * Exercised with realistic token shapes (opaque access/refresh, JWT id token).
 */
import { describe, expect, it } from "vitest";
import { buildSessionCookies, cookieMaxAge } from "./refresh";
import { ID_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from "./cookies";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function mintToken(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "RS256" })}.${b64url(payload)}.sig`;
}
const NOW = 1_900_000_000;
const NAMES = { sub: "sub", wallet: "wallet_address" };

describe("cookieMaxAge", () => {
  it("tracks exp, floors at 60s, caps at 24h", () => {
    expect(cookieMaxAge(NOW + 1800, NOW)).toBe(1800);
    expect(cookieMaxAge(NOW + 5, NOW)).toBe(60);
    expect(cookieMaxAge(NOW + 10 * 86400, NOW)).toBe(24 * 3600);
  });
});

describe("buildSessionCookies", () => {
  it("emits id+access+refresh cookies and decodes claims from a refresh response", () => {
    const built = buildSessionCookies(
      {
        id_token: mintToken({
          sub: "did:cit:Alice",
          wallet_address: "0xABCDEF0000000000000000000000000000000001",
          exp: NOW + 3600,
        }),
        access_token: "newOpaqueAccess",
        refresh_token: "rotatedOpaqueRefresh",
      },
      NOW,
      NAMES,
    );
    expect(built).not.toBeNull();
    const cookies = built!.setCookies;
    expect(cookies.some((c) => c.startsWith(`${ID_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
    expect(refresh).toContain(`Max-Age=${14 * 24 * 3600}`); // refresh outlives id/access
    expect(built!.exp).toBe(NOW + 3600);
    expect(built!.sub).toBe("did:cit:Alice"); // verbatim (case-sensitive)
    expect(built!.walletAddress).toBe("0xabcdef0000000000000000000000000000000001");
  });

  it("returns null when the id token is missing or malformed", () => {
    expect(buildSessionCookies({ access_token: "x" }, NOW, NAMES)).toBeNull();
    expect(buildSessionCookies({ id_token: "not-a-jwt" }, NOW, NAMES)).toBeNull();
  });

  it("omits cookies for opaque tokens that are malformed", () => {
    const built = buildSessionCookies(
      { id_token: mintToken({ sub: "u", exp: NOW + 60 }), refresh_token: "has space" },
      NOW,
      NAMES,
    );
    expect(built!.setCookies.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(false);
  });
});
