/**
 * Same-origin guard for cookie-authenticated mutations (PBA-L3c-017/-018).
 *
 * Auth cookies are SameSite=Strict, but "site" is the registrable domain: a
 * sibling subdomain (docs.citrate.ai, a preview deployment) is SAME-SITE and
 * its requests carry the cookies. And /api/auth/session only rejected when a
 * `Sec-Fetch-Site: cross-site` header was PRESENT, so a legacy UA (no Fetch
 * Metadata) posting a CORS-simple text/plain body could plant an attacker's
 * id_token (login CSRF).
 *
 * Rules, in order:
 *  1. `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`.
 *  2. `Origin`, when sent, must be this request's own origin or the configured
 *     public origin (`NEXT_PUBLIC_SITE_URL`). `Origin: null` is refused.
 *  3. A request authenticated by an `Authorization: Bearer` header is not
 *     CSRF-able (browsers never attach it on their own), so it passes.
 *  4. Otherwise a request that carries an auth cookie but neither signal is
 *     refused (every browser that sends cookies sends one of them on a POST).
 *     `requireBrowserSignal` applies this even with no cookie (login CSRF).
 *  5. `requireJson`: the body must be `application/json` (not a CORS-simple
 *     type a cross-site form can send).
 */
import { ID_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE, cookieValue } from "@/lib/auth/cookies";

export interface SameOriginOptions {
  requireJson?: boolean;
  requireBrowserSignal?: boolean;
}

function allowedOrigins(req: Request): Set<string> {
  const set = new Set<string>();
  try {
    set.add(new URL(req.url).origin);
  } catch {
    /* unparseable request URL: only the configured origin can match */
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      set.add(new URL(site).origin);
    } catch {
      /* malformed config adds nothing */
    }
  }
  return set;
}

const forbidden = (why: string) => Response.json({ error: `cross-origin request rejected (${why})` }, { status: 403 });

/** Returns a 403/415 Response to send, or null when the request may proceed. */
export function checkSameOrigin(req: Request, opts: SameOriginOptions = {}): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return forbidden("sec-fetch-site");

  const origin = req.headers.get("origin");
  if (origin !== null && !allowedOrigins(req).has(origin)) return forbidden("origin");

  const bearer = /^Bearer\s+\S/i.test(req.headers.get("authorization") ?? "");
  if (site === null && origin === null && !bearer) {
    const hasAuthCookie = [ID_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE].some((c) => cookieValue(req, c) !== null);
    if (hasAuthCookie || opts.requireBrowserSignal) return forbidden("no origin signal");
  }

  if (opts.requireJson) {
    const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json") {
      return Response.json({ error: "content-type must be application/json" }, { status: 415 });
    }
  }
  return null;
}
