/**
 * The indexer lock against a real Postgres server (two sessions are needed to
 * test contention, which PGlite cannot do). Runs only when TEST_DATABASE_URL
 * points at a disposable database; it is skipped in CI, which has none.
 * The database is migrated and its chain tables are emptied by the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";
import { acquireIndexerLock } from "./lock";
import { IndexerRunningError, resetChainIndex } from "./reset";

const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;
const G = "0x" + "44".repeat(32);

d("indexer lock (real Postgres)", () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: join(__dirname, "..", "db", "migrations") });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("one holder at a time; a reset refuses while the indexer holds it", async () => {
    const a = await acquireIndexerLock(URL);
    expect(a).not.toBeNull();
    expect(await acquireIndexerLock(URL)).toBeNull();
    await expect(resetChainIndex(db, G)).rejects.toBeInstanceOf(IndexerRunningError);

    await a!.release();
    await resetChainIndex(db, G);
    const [state] = await db.select().from(schema.indexerState);
    expect(state.genesisHash).toBe(G);

    const b = await acquireIndexerLock(URL);
    expect(b).not.toBeNull();
    await b!.release();
  });
});
