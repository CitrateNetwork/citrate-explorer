import type { NextConfig } from "next";

/**
 * Production security headers (P-8 WP-8.1).
 *
 * The CSP is NOT here anymore (SECREM-02 WP 7.1 / FUA-EXPLORER-04): a static
 * header cannot carry a per-request nonce, so the policy is built per request
 * in `src/proxy.ts` from `src/lib/security/csp.ts` — script-src is nonce-based
 * (`'nonce-…' 'strict-dynamic'`), with NO 'unsafe-inline'. Only the static,
 * request-independent headers remain below.
 */
const securityHeaders = [
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
