/**
 * The indexer lock: a Postgres session advisory lock held by the running indexer
 * for its whole life, on a dedicated connection. It keeps two indexers from
 * writing the same index, and it lets `pnpm indexer:reset` refuse while an
 * indexer is running (the reset takes the same key as a transaction lock).
 *
 * Data source (Rule 7): the index database at DATABASE_URL.
 */
import pg from "pg";
import { dbSslOptions } from "@/lib/db/client";

/** Advisory-lock key shared by the indexer and the reset command. */
export const INDEXER_LOCK_KEY = 402040001;

export interface IndexerLock {
  release(): Promise<void>;
}

/**
 * Takes the indexer lock on its own connection, or returns null if another
 * session holds it. The lock lasts until `release()` or until the process (and
 * so the connection) ends.
 */
export async function acquireIndexerLock(
  connectionString: string | undefined = process.env.DATABASE_URL,
): Promise<IndexerLock | null> {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString, ssl: dbSslOptions() });
  await client.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [INDEXER_LOCK_KEY]);
    if (!rows[0]?.ok) {
      await client.end();
      return null;
    }
  } catch (e) {
    await client.end();
    throw e;
  }
  // A dropped connection drops the lock: fail loudly rather than keep writing unlocked.
  client.on("error", (err) => {
    console.error(`[indexer] lost the indexer-lock connection: ${err.message}; exiting`);
    process.exit(1);
  });
  return {
    async release() {
      await client.query("select pg_advisory_unlock($1)", [INDEXER_LOCK_KEY]);
      await client.end();
    },
  };
}
