import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";

/**
 * robots.txt (P-8 WP-8.2). Index the public explorer; keep the API surface and
 * the OAuth callback out of search results (they aren't human-facing pages).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
