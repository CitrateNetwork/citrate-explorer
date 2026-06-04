import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";

/**
 * sitemap.xml (P-8 WP-8.2). Lists the server-rendered, stable URLs. The explorer
 * shell is a hash-routed SPA today, so per-entity (block/tx/address) URLs are not
 * yet crawlable — that arrives with the App Router path migration (deferred WP-8.2
 * follow-up). The legal pages are real SSR routes and belong here now.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/privacy", "/terms", "/cookies"];
  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "hourly" : "monthly",
    priority: path === "" ? 1 : 0.5,
  }));
}
