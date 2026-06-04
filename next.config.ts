import type { NextConfig } from "next";

/**
 * Production security headers (P-8 WP-8.1).
 *
 * CSP is built from env so the allowlist tracks the configured backends without a
 * code change: the RPC/WS endpoints, the OIDC authority (when auth.citrate.ai
 * ships), and Privy (when an app id is set). Inference is server-side only
 * (`/api/chat` calls the gateway), so the gateway host is NOT in `connect-src`.
 *
 * Known relaxations, documented honestly:
 * - `script-src 'unsafe-inline'`: the no-flash theme bootstrap is an inline
 *   <script>, and Privy/wallet SDKs inject inline script. A nonce migration
 *   (middleware) is the follow-up; everything else is locked down.
 * - `style-src 'unsafe-inline'`: the ported design uses inline `style=` attributes
 *   and a dynamic `--accent` custom property; nonces don't cover style attributes.
 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildCsp(): string {
  const rpcHttp = process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
  const rpcWs = process.env.NEXT_PUBLIC_CITRATE_WS_URL ?? "wss://rpc.citrate.ai";

  // Origins the browser may connect to (fetch / websocket), derived from config.
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
    "script-src": "'self' 'unsafe-inline'",
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

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
