/**
 * OIDC endpoint discovery (server-side). The hard rule from the auth handoff:
 * NEVER hardcode endpoint paths — read the authority's
 * `/.well-known/openid-configuration` (panva's token endpoint is `/token`, its
 * revocation endpoint `/token/revocation`). Explicit env wins; the panva defaults
 * are a last-resort fallback if discovery is unreachable. Cached for the process
 * lifetime. Server twin of `discovery.ts` (which is "use client").
 */

export interface ServerOidcEndpoints {
  token: string;
  revocation?: string;
}

let cached: ServerOidcEndpoints | null = null;

/** The authority issuer origin (server env), trailing slash trimmed. */
export function serverIssuer(): string {
  return (process.env.OIDC_ISSUER || process.env.NEXT_PUBLIC_OIDC_ISSUER || "").replace(
    /\/$/,
    "",
  );
}

/** The explorer's OIDC client_id (public client; equals the audience here). */
export function serverClientId(): string {
  return (
    process.env.NEXT_PUBLIC_OIDC_CLIENT_ID ||
    process.env.OIDC_AUDIENCE ||
    "citrate-explorer"
  );
}

export async function serverOidcEndpoints(): Promise<ServerOidcEndpoints> {
  if (cached) return cached;
  const issuer = serverIssuer();
  let disc: Record<string, string> = {};
  try {
    const r = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) disc = await r.json();
  } catch {
    /* fall back to panva defaults below */
  }
  cached = {
    token: process.env.OIDC_TOKEN_URL || disc.token_endpoint || `${issuer}/token`,
    revocation: disc.revocation_endpoint || (issuer ? `${issuer}/token/revocation` : undefined),
  };
  return cached;
}
