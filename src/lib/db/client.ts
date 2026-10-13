/**
 * Postgres/Drizzle database client (DO Managed Postgres via node-postgres).
 * Migrated off Neon serverless 2026-09-29 (reroll fan-out; Neon quota 402).
 * Returns a singleton Drizzle client, OR null when DATABASE_URL is unset. The
 * null path is deliberate: the app + indexer must build/run before the DB is
 * provisioned, and reads fall through to live RPC.
 *
 * Data source: DO Managed Postgres at DATABASE_URL, over TLS verified against
 * the cluster CA in DATABASE_CA_CERT (PEM). Do NOT put sslmode=... in the URL:
 * pg's URL parsing would override the explicit `ssl` object below.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let cached: Database | null | undefined;

/**
 * TLS options for the pool. Never unverified TLS:
 * - DATABASE_CA_CERT set: verify the server certificate (and hostname) against it.
 * - production without it: throw, rather than connect unverified.
 * - otherwise (local dev): plain connection; a TLS-only server refuses it loudly.
 */
export function dbSslOptions(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig["ssl"] {
  const ca = env.DATABASE_CA_CERT?.trim();
  if (ca) return { ca, rejectUnauthorized: true };
  if (env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is set but DATABASE_CA_CERT is not: refusing to connect without verifying the database certificate",
    );
  }
  return undefined;
}

export function getDb(): Database | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }
  const pool = new pg.Pool({ connectionString: url, ssl: dbSslOptions() });
  cached = drizzle(pool, { schema });
  return cached;
}

export function isDbEnabled(): boolean {
  return getDb() !== null;
}

export { schema };
