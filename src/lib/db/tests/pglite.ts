/**
 * Test-only: an in-process Postgres (PGlite, Postgres compiled to WASM) with the
 * repo's real migrations applied, so DB code is tested against real SQL in CI,
 * which has no Postgres service. Never imported by production code.
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
  return { db, close: () => client.close() };
}
