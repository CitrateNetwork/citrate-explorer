/**
 * Postgres/Drizzle database client (DO Managed Postgres via node-postgres).
 * Migrated off Neon serverless 2026-09-29 (reroll fan-out; Neon quota 402).
 * Returns a singleton Drizzle client, OR null when DATABASE_URL is unset. The
 * null path is deliberate: the app + indexer must build/run before the DB is
 * provisioned, and reads fall through to live RPC.
 *
 * Data source: DO Managed Postgres at DATABASE_URL (ssl, self-signed CA →
 * rejectUnauthorized:false; do NOT put sslmode=require in the URL — newer pg
 * treats it as verify-full and rejects DO's cert).
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let cached: Database | null | undefined;

export function getDb(): Database | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  cached = drizzle(pool, { schema });
  return cached;
}

export function isDbEnabled(): boolean {
  return getDb() !== null;
}

export { schema };
