-- RA-2 / ADR-002: expression index for native-SALT value-range queries.
--
-- `transactions.value` is a decimal string of grains; range queries cast it to
-- NUMERIC (findNativeTransfers). This functional index makes those range scans
-- index-backed. Idempotent and additive — safe to run against production Neon.
--
-- Drizzle can't model an expression index, so this lives outside the drizzle
-- migration chain. Apply with:
--   psql "$DATABASE_URL" -f scripts/db/0003_tx_value_numeric_idx.sql
-- The query is correct WITHOUT this index (it just seq-scans); at the current
-- table size that is already fast, so applying it is a perf nicety, not a gate.

CREATE INDEX IF NOT EXISTS tx_value_numeric_idx
  ON transactions ((CAST(value AS NUMERIC)));

-- Composite for the common "big transfers in a window" query shape.
CREATE INDEX IF NOT EXISTS tx_value_ts_idx
  ON transactions ((CAST(value AS NUMERIC)), timestamp);
