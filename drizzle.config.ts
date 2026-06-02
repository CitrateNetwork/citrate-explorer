import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for CitrateScan's schema — the chain index (blocks,
 * transactions, receipts, logs, dag_edges, accounts, contracts, tokens,
 * token_transfers, contract_verifications) plus user tables (settings,
 * api_keys, watchlist, audit_log, threads, messages, thread_memory).
 *
 * `drizzle-kit generate` reads the schema and emits SQL migrations into
 * src/lib/db/migrations/ — this does NOT require a live database. Applying them
 * (`drizzle-kit migrate`) does, reading DATABASE_URL from the environment (set
 * during the Neon provisioning step). The app + indexer run with DATABASE_URL
 * unset (read-through to live RPC, no persistence).
 */
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
