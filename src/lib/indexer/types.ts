/** Shared indexer types. The DB row shapes live in src/lib/db/schema.ts. */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";

/**
 * Any Drizzle Postgres database over this schema: the production node-postgres
 * client (`getDb()`) or a PGlite instance in tests. Indexer write paths take it
 * as a parameter so the same code runs against both.
 */
export type ChainDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Returned by repository reads when DATABASE_URL is unset (Rule 11: honest). */
export interface NotProvisioned {
  provisioned: false;
  note: string;
}

export type Provisioned<T> = { provisioned: true } & T;

export const NOT_PROVISIONED: NotProvisioned = {
  provisioned: false,
  note:
    "The chain index is not provisioned (DATABASE_URL unset). Live single-entity " +
    "reads still work via RPC; aggregate/history queries need the indexer (S-1).",
};
