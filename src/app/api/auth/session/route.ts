/**
 * Session cookie endpoint (SECREM-02 WP 7.1, closes FUA-EXPLORER-04).
 *
 * The OIDC tokens used to live in localStorage — readable by ANY injected
 * script. They now live in httpOnly cookies that scripts can never read:
 *
 *  - POST   {"id_token", "access_token"?} → sets the cookies. Called once by
 *    /auth/callback right after the PKCE code exchange. The handler only
 *    checks JWT SHAPE + caps size; real verification (signature, iss, aud,
 *    exp against the authority JWKS) happens on EVERY request in
 *    `verifySession` — the trust model is unchanged from the Bearer header.
 *  - DELETE → clears both cookies (server-side logout) and best-effort ends
 *    the session AT THE AUTHORITY with the access token (which the client can
 *    no longer do itself — it can't read the httpOnly cookie).
 *  - GET    → UI hydration: {authenticated, sub, walletAddress} DECODED (not
 *    verified) from the caller's own cookie. Display-only; every API route
 *    still verifies cryptographically via `verifySession`.
 *
 * CSRF: cookies are SameSite=Strict (never sent cross-site), and the mutating
 * verbs additionally reject cross-site callers via Sec-Fetch-Site.
 */
import {
  ID_COOKIE,
  ACCESS_COOKIE,
  cookieValue,
  decodeJwtPayload,
  looksLikeJwt,
  looksLikeOpaqueToken,
  serializeAuthCookie,
  clearAuthCookie,
} from "@/lib/auth/cookies";

export const runtime = "nodejs";

/** Reject plainly cross-site requests on mutating verbs (defense in depth). */
function crossSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) {
    return Response.json({ error: "cross-site request rejected" }, { status: 403 });
  }
  let body: { id_token?: unknown; access_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const idToken = typeof body.id_token === "string" ? body.id_token : null;
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  if (!idToken || !looksLikeJwt(idToken)) {
    return Response.json({ error: "id_token must be a JWT" }, { status: 400 });
  }
  // The access token is OPAQUE by OAuth design (the authority issues opaque
  // tokens, not JWTs) — accept any well-formed token, just don't accept garbage.
  if (accessToken && !looksLikeOpaqueToken(accessToken)) {
    return Response.json({ error: "access_token is malformed" }, { status: 400 });
  }

  // Cookie lifetime tracks the token's own exp (capped at 24h, floor 60s);
  // the per-request JWKS verification is still what actually enforces expiry.
  const claims = decodeJwtPayload(idToken);
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims?.exp === "number" ? claims.exp : now + 3600;
  const maxAge = Math.min(Math.max(exp - now, 60), 24 * 3600);

  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", serializeAuthCookie(ID_COOKIE, idToken, maxAge));
  if (accessToken) {
    headers.append("set-cookie", serializeAuthCookie(ACCESS_COOKIE, accessToken, maxAge));
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function GET(req: Request): Promise<Response> {
  const idToken = cookieValue(req, ID_COOKIE);
  if (!idToken) {
    return Response.json({ authenticated: false }, { status: 200 });
  }
  const claims = decodeJwtPayload(idToken) ?? {};
  const subClaim = process.env.NEXT_PUBLIC_AUTH_CLAIM_SUB || "sub";
  const walletClaim = process.env.NEXT_PUBLIC_AUTH_CLAIM_WALLET || "wallet_address";
  const sub = typeof claims[subClaim] === "string" ? (claims[subClaim] as string) : undefined;
  const walletAddress =
    typeof claims[walletClaim] === "string"
      ? (claims[walletClaim] as string).toLowerCase()
      : undefined;
  return Response.json(
    { authenticated: Boolean(sub), sub, walletAddress },
    { status: 200 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  if (crossSite(req)) {
    return Response.json({ error: "cross-site request rejected" }, { status: 403 });
  }
  // Best-effort authority logout (TD-5b cascade): the access token lives only
  // in the httpOnly cookie now, so the server makes the /logout call the
  // client used to make. Never blocks the local logout.
  const access = cookieValue(req, ACCESS_COOKIE);
  const issuer = (
    process.env.OIDC_ISSUER ||
    process.env.NEXT_PUBLIC_OIDC_ISSUER ||
    ""
  ).replace(/\/$/, "");
  if (access && issuer) {
    try {
      await fetch(`${issuer}/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* authority unreachable — local logout still proceeds */
    }
  }
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", clearAuthCookie(ID_COOKIE));
  headers.append("set-cookie", clearAuthCookie(ACCESS_COOKIE));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
