/**
 * Silent token renewal (TD-9). The client calls this ~60s before the id token
 * expires; the server swaps the httpOnly refresh cookie for a fresh id/access
 * token (and a ROTATED refresh token — the authority sets `rotateRefreshToken`)
 * and re-sets all three cookies. The refresh token never reaches page script.
 *
 *  - POST → renew. 200 {ok, exp, sub, walletAddress} on success; 401 (cookies
 *    cleared) when there is no refresh token or the authority rejects it
 *    (expired / revoked / rotated away).
 *
 * CSRF: cookies are SameSite=Strict; the mutating verb goes through
 * checkSameOrigin (same posture as /api/auth/session).
 */
import {
  REFRESH_COOKIE,
  ID_COOKIE,
  ACCESS_COOKIE,
  cookieValue,
  clearAuthCookie,
} from "@/lib/auth/cookies";
import { buildSessionCookies, claimNames } from "@/lib/auth/refresh";
import { serverOidcEndpoints, serverClientId } from "@/lib/auth/discovery.server";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

export const runtime = "nodejs";


function clearedResponse(status: number, error: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", clearAuthCookie(ID_COOKIE));
  headers.append("set-cookie", clearAuthCookie(ACCESS_COOKIE));
  headers.append("set-cookie", clearAuthCookie(REFRESH_COOKIE));
  return new Response(JSON.stringify({ ok: false, error }), { status, headers });
}

export async function POST(req: Request): Promise<Response> {
  // PBA-L3c-017/-018: Origin + Sec-Fetch-Site (and, for login, a JSON body
  // and a mandatory browser signal) — closes login CSRF and same-site forgery.
  const csrf = checkSameOrigin(req, { requireBrowserSignal: true });
  if (csrf) return csrf;
  const refreshToken = cookieValue(req, REFRESH_COOKIE);
  if (!refreshToken) {
    return Response.json({ ok: false, error: "no refresh token" }, { status: 401 });
  }

  let tokens: unknown;
  try {
    const { token } = await serverOidcEndpoints();
    const res = await fetch(token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: serverClientId(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // Expired / revoked / already-rotated refresh token → end the session.
      return clearedResponse(401, "refresh rejected");
    }
    tokens = await res.json();
  } catch {
    // Authority unreachable: do NOT wipe the session — let the existing tokens
    // ride; the client will retry on the next scheduled tick.
    return Response.json({ ok: false, error: "authority unreachable" }, { status: 503 });
  }

  const now = Math.floor(Date.now() / 1000);
  const built = buildSessionCookies(tokens as Record<string, unknown>, now, claimNames());
  if (!built) {
    return clearedResponse(401, "no id_token in refresh response");
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const c of built.setCookies) headers.append("set-cookie", c);
  return new Response(
    JSON.stringify({
      ok: true,
      exp: built.exp,
      sub: built.sub,
      walletAddress: built.walletAddress,
    }),
    { status: 200, headers },
  );
}
