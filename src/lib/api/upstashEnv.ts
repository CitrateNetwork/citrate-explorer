/**
 * Upstash REST credentials for the shared rate-limit and compile-gate store.
 *
 * Two naming schemes exist: a directly configured Upstash database uses
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, and the Vercel Marketplace
 * integration provisions KV_REST_API_URL / KV_REST_API_TOKEN. The URL and token are
 * resolved as a PAIR from one scheme, so one store's URL is never sent the other
 * store's token (which would make every fail-closed path refuse). The read-only
 * token is never used: both callers write to the store.
 */
export interface UpstashRestEnv {
  url: string;
  token: string;
}

export function upstashRestEnv(env: NodeJS.ProcessEnv = process.env): UpstashRestEnv | null {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  }
  return null;
}
