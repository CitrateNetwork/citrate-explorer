/**
 * Content-Security-Policy builder (SECREM-02 WP 7.1, closes the CSP half of
 * FUA-EXPLORER-04). Previously a STATIC header in next.config.ts with
 * `script-src 'self' 'unsafe-inline'`; now built per request in `src/proxy.ts`
 * with a fresh nonce, so script-src needs no 'unsafe-inline' at all:
 *
 *  - `'nonce-<random>'` — the only first-party inline script (the no-flash
 *    theme bootstrap in app/layout.tsx) carries this nonce, as do Next's own
 *    framework scripts (Next reads the CSP request header and injects it).
 *  - `'strict-dynamic'` — scripts loaded BY nonce'd scripts (the Next runtime,
 *    wallet/Privy SDK loaders) are trusted transitively; host allowances and
 *    'self' are ignored by CSP3 browsers and kept only as a CSP2 fallback.
 *
 * Known, documented relaxation: `style-src 'unsafe-inline'` remains — the
 * ported design uses inline `style=` ATTRIBUTES and a dynamic `--accent`
 * custom property, and nonces cannot cover style attributes (only <style>
 * elements). Style injection is not script execution; the script-src lockdown
 * is the XSS-relevant half.
 *
 * The allowlist is env-derived so it tracks the configured backends: RPC/WS
 * endpoints, the OIDC authority, and Privy (when an app id is set). Inference
 * is server-side only (`/api/chat`), so the gateway host is NOT in connect-src.
 */

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Build the full CSP for one request. `nonce` MUST be unique per request. */
export function buildCsp(nonce: string): string {
  const rpcHttp = process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
  const rpcWs = process.env.NEXT_PUBLIC_CITRATE_WS_URL ?? "wss://rpc.citrate.ai";

  // Origins the browser may connect to (fetch / websocket / SSE), from config.
  const connect = new Set<string>(["'self'", rpcHttp, rpcWs]);
  for (const u of [
    process.env.NEXT_PUBLIC_OIDC_ISSUER,
    process.env.NEXT_PUBLIC_OIDC_AUTHORIZE_URL,
    process.env.NEXT_PUBLIC_OIDC_TOKEN_URL,
  ]) {
    const o = originOf(u);
    if (o) connect.add(o);
  }
  // Privy talks to *.privy.io over https + wss when an app id is configured.
  if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    connect.add("https://*.privy.io");
    connect.add("wss://*.privy.io");
  }

  const frame = new Set<string>(["'self'"]);
  if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    frame.add("https://*.privy.io");
    frame.add("https://auth.privy.io");
  }

  const directives: Record<string, string> = {
    "default-src": "'self'",
    // Nonce + strict-dynamic; never 'unsafe-inline' (FUA-EXPLORER-04).
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob: https:",
    "font-src": "'self' data:",
    "connect-src": [...connect].join(" "),
    "frame-src": [...frame].join(" "),
    "worker-src": "'self' blob:",
    "manifest-src": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
    "upgrade-insecure-requests": "",
  };

  return Object.entries(directives)
    .map(([k, v]) => (v ? `${k} ${v}` : k))
    .join("; ");
}
