/**
 * Neon/Drizzle database client.
 *
 * Returns a singleton Drizzle client backed by @neondatabase/serverless, OR
 * `null` when `DATABASE_URL` is unset. The null path is deliberate: the app +
 * indexer must build and run before Neon is provisioned, and reads fall through
 * to live RPC. Every caller checks for null and degrades rather than throwing.
 *
 * Data source (Rule 11): Neon Postgres at `DATABASE_URL`.
 */
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

let cached: Database | null | undefined;

export function getDb(): Database | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

export function isDbEnabled(): boolean {
  return getDb() !== null;
}

export { schema };
