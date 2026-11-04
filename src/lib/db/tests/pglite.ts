/**
 * Test-only: an in-process Postgres (PGlite, Postgres compiled to WASM) with the
 * repo's real migrations applied, so DB code is tested against real SQL in CI,
 * which has no Postgres service. Never imported by production code.
 *
 * Start-up costs seconds, so a test file creates one instance (`beforeAll`) and
 * calls `truncateAll()` between tests.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import * as schema from "../schema";

export async function migratedPglite() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: join(__dirname, "..", "migrations") });
  /** Empties every table in the public schema and resets serial ids. */
  async function truncateAll() {
    const { rows } = await client.query<{ t: string }>(
      "select tablename as t from pg_tables where schemaname = 'public'",
    );
    if (rows.length) {
      await client.exec(`truncate table ${rows.map((r) => `"${r.t}"`).join(", ")} restart identity`);
    }
  }
  return { db, client, truncateAll, close: () => client.close() };
}
