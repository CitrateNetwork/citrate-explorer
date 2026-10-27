---
created: 2026-10-27T21:30:00Z
branch: beta/fxexpl-r1006-genesis-guard
author: Larry Klosowski (MAC lane, fxEXPL; Claude Opus 5.5)
status: active
audience: DGX operator (all deploys and production database work run on DGX)
applies_to: citrate-explorer (CitrateScan web app + indexer worker) at the r1006 public cutover
---

# CitrateScan r1006 cutover runbook

At the owner-approved public cutover, `rpc.citrate.ai` starts serving **r1006** instead of
**r1005**. Both are chain id **40204**, so nothing keyed on the chain id notices the change.
CitrateScan tells them apart by block 0's hash:

| Network | Block 0 (genesis) hash | Address book in citrate-chain |
|---|---|---|
| r1005 (live until cutover) | `0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1` | `contracts/addresses/40204.json` |
| r1006 | `0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4` | `contracts/addresses/r1006/40204.json` (final since `a857443e`) |

The hashes come from citrate-chain `core/consensus/src/hardening.rs` (`RELEASE_GENESIS`,
`R1006_GENESIS`) and are generated into `src/generated/**/chainConstants.json` by
`pnpm sync-addresses`. Don't copy them by hand.

## What protects the index

- **The one-line switch.** `NEXT_PUBLIC_CITRATE_NETWORK=r1006` selects
  `src/generated/r1006/{addresses,chainConstants}.json` for both the web app and the indexer.
  Unset or `r1005` keeps today's book. Any other value fails the build or start.
- **The indexer genesis guard** (`src/lib/indexer/genesisGuard.ts`). It runs on start and before
  every ingest batch. It refuses to write, and stays stopped until restarted, when:
  - the RPC's block 0 is not this build's network genesis (`rpc_not_expected_network`);
  - the RPC's block 0 differs from the genesis recorded in `indexer_state.genesis_hash`
    (`genesis_mismatch`);
  - nothing is recorded yet and the index holds rows that the RPC's chain doesn't have
    (`index_not_this_chain`);
  - the database predates migration 0005 and has no genesis columns (`not_migrated`).

  After a refusal, nothing more is written: no further ingest batches and no finality
  reconciliation.

  On the first run against an empty database it records the genesis. On an existing r1005 index
  it records the genesis only if the index's lowest live block matches what the RPC serves at
  that height.
- **`/api/health`.**
  - `components.chain.status = wrong_genesis` (HTTP 503) means the RPC serves a different
    network than this build. `genesis_unavailable` (degraded, HTTP 200) means the chain answers
    but block 0 could not be read.
  - `components.indexer.status = genesis_refused` or `genesis_mismatch` means the index and the
    RPC disagree (overall status is `degraded`).
  - `components.indexer.genesis.status = not_migrated` means the database has no 0005 columns yet.
    `head` and `lagBlocks` are still reported.
  - `components.chain.genesis`, `.expectedGenesis` and `.network` show the values that were
    compared.

## 0. Before cutover (any time after this PR merges)

1. **Run migration 0005 on the r1005 database as soon as this PR merges.** Merging auto-deploys
   `main` to Vercel; it does not migrate. Run `pnpm db:migrate` on DGX against the current
   production `DATABASE_URL`. Until you do:
   - the web app keeps serving, and `/api/health` reports `indexer.genesis.status = not_migrated`
     with `head` and lag intact;
   - an indexer started on this build refuses with `not_migrated` and writes nothing (it doesn't
     crash). Restart it after the migration.

   After the migration, the r1005 indexer records `0x1dcf…75f1` on its next start.
2. Confirm the generated books match citrate-chain `main`. The address-drift workflow does this
   in CI, and you can run it locally:
   `CITRATE_CHAIN_DIR=<citrate-chain@main> bash scripts/check-address-drift.sh`.
   It checks both books and both `chainConstants.json` files. If r1006's book or allocation
   changes before cutover, run `pnpm sync-addresses --chain <citrate-chain@main>`, commit, and
   redeploy.
3. Decide which env overrides to drop. These pin **r1005** contract addresses and must be unset
   (or set to the r1006 deployment) at cutover:
   - `NEXT_PUBLIC_MODEL_REGISTRY`, `NEXT_PUBLIC_INFERENCE_ROUTER`, `NEXT_PUBLIC_AGENT_SBT`.
     Unset them; the r1006 book supplies the addresses.
   - `NEXT_PUBLIC_FORWARDER_ADDRESS` (the explorer's own EIP-2771 `CitrateForwarder`) is **not**
     in the r1006 genesis. Unset it at cutover. `/api/relay` then answers 503 "not configured",
     the honest state. Set it again only after the forwarder is deployed on r1006 and the relayer
     is funded there.

## 1. Database: a fresh r1006 index, with the r1005 index kept as the archive

Since #15 the index is **DO Managed Postgres**, not Neon. The same database also holds the
eight user tables (`settings`, `api_keys`, `provider_keys`, `watchlist`, `audit_log`, `threads`,
`messages`, `thread_memory`). The goal is a new database with an empty chain index, and with the
user tables copied from r1005 at the moment writes stop. The r1005 database is kept untouched as
the archive. This section can run ahead of time; it creates and migrates the database only.

**Option A: DO Managed Postgres (current production).**

```bash
# On DGX. CLUSTER = the explorer's DO database cluster id.
doctl databases db create "$CLUSTER" citratescan_r1006
R1005_URL='<current DATABASE_URL>'          # stays as the archive; nothing writes to it after step 2
R1006_URL='<same cluster, database citratescan_r1006>'
DATABASE_URL="$R1006_URL" pnpm db:migrate   # every migration, including 0005, on the empty DB
```

Do **not** copy the user tables yet. The r1005 web app keeps writing to them until the web flip,
so the copy happens in the cutover sequence (§2 step 4), inside a write freeze.

**Option B: Neon (only if the index is back on Neon).** Branch from the r1005 branch so the user
tables come along, then empty the chain index on the new branch:

```bash
neonctl branches create --project-id "$NEON_PROJECT" --name r1006 --parent main
# Use the r1006 branch's pooled connection string as R1006_URL:
psql "$R1006_URL" -c 'TRUNCATE blocks, dag_edges, transactions, receipts, logs, token_transfers,
  tokens, accounts, contracts, contract_verifications, indexer_state;'
DATABASE_URL="$R1006_URL" pnpm db:migrate
# Keep the r1005 branch as the archive (rename it, for example r1005-archive). Don't delete it.
```

The branch's user tables are a snapshot from branch time. The §2 step 4 copy replaces them with
the frozen r1005 data, so run it for option B too.

Either way, `indexer_state` in the r1006 database is empty, so the first indexer start records
r1006's genesis. If you skip the truncate in option B, the guard refuses
(`genesis_mismatch`/`index_not_this_chain`) and nothing mixes. Truncate, then restart.

`contract_verifications` is chain-specific (r1005 addresses), so it starts empty on r1006.

## 2. Cutover sequence

Run these in order, on DGX, after the owner's go. Keep `INDEXER_PARALLEL=1` (the default) on the
indexer for the whole cutover. The genesis check runs before every batch, so between a check and
an RPC flip at most `INDEXER_PARALLEL` blocks can be read from the new chain. With 1, that is at
most one block. Raise it again only once §3 passes.

1. **Stop the r1005 indexer.** If it is still running when the RPC flips, the guard stops it
   (`rpc_not_expected_network`) and `/api/health` reports it, so this step is clean-up, not
   safety.
2. **The RPC flips** to r1006 (chain team). Confirm:
   ```bash
   curl -s https://rpc.citrate.ai -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x0",false]}' | jq -r .result.hash
   # expect 0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4
   ```
3. **Indexer env** (indexer host), then redeploy it:
   - `NEXT_PUBLIC_CITRATE_NETWORK=r1006`
   - `DATABASE_URL=$R1006_URL` (same `DATABASE_CA_CERT`)
   - leave `NEXT_PUBLIC_CITRATE_RPC_URL` / `_WS_URL` at `rpc.citrate.ai`

   Smoke one pass first: `INDEXER_ONCE=1 pnpm indexer`. Exit code 0 means the genesis was
   recorded and the latest block was ingested; exit code 3 means a refusal (read the log line).
   Then run it always-on: `pnpm indexer`. The start log line shows
   `network=r1006 genesis=0xa365…`.
4. **Freeze user writes on r1005, then copy the user tables.** The app has no maintenance mode, so
   make the r1005 database read-only and drop existing sessions. From here until the web flip,
   user writes such as new API keys, settings or chat messages fail visibly instead of landing
   in the archive. Reads keep working.
   ```bash
   R1005_DB=<r1005 database name>
   psql -v ON_ERROR_STOP=1 "$R1005_URL" <<SQL
   ALTER DATABASE "$R1005_DB" SET default_transaction_read_only = on;
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '$R1005_DB' AND pid <> pg_backend_pid();
   SQL
   ```
   Then copy the eight user tables. Run this in **bash**. The dump goes to a file first, so a
   failed dump stops the script before anything is emptied. The load is one transaction: it
   empties the targets and then loads, so any error rolls the whole copy back, and a re-run is
   safe (no primary-key conflicts).
   ```bash
   set -euo pipefail
   DUMP=r1005-user-tables-$(date -u +%Y%m%dT%H%M%SZ).sql
   pg_dump --data-only --no-owner --no-privileges \
     -t settings -t api_keys -t provider_keys -t watchlist -t audit_log \
     -t threads -t messages -t thread_memory \
     -f "$DUMP" "$R1005_URL"
   {
     echo 'TRUNCATE settings, api_keys, provider_keys, watchlist, audit_log, threads, messages, thread_memory;'
     cat "$DUMP"
   } | psql -v ON_ERROR_STOP=1 --single-transaction "$R1006_URL"
   # Row counts must match on both sides:
   for t in settings api_keys provider_keys watchlist audit_log threads messages thread_memory; do
     echo "$t r1005=$(psql -tAc "select count(*) from $t" "$R1005_URL") r1006=$(psql -tAc "select count(*) from $t" "$R1006_URL")"
   done
   ```
   Keep `$DUMP` until §3 passes. It holds user data: store it like the database, and delete it
   afterwards.
   `pg_dump -t` carries each table's owned `serial` sequence value, so new rows on r1006 don't
   collide with copied ids. This was rehearsed on a local Postgres at schema 0000-0005: freeze,
   copy, re-run, a failed dump and a failed load. The read-only r1005 rejected writes, the
   counts matched, the next `api_keys` id continued the sequence, and neither failure left a
   partial copy.
5. **Web env** (Vercel production), then rebuild. `NEXT_PUBLIC_*` values are baked in at build
   time, so changing the env alone does nothing until you redeploy.
   - `NEXT_PUBLIC_CITRATE_NETWORK=r1006`
   - `DATABASE_URL=$R1006_URL`
   - unset `NEXT_PUBLIC_MODEL_REGISTRY`, `NEXT_PUBLIC_INFERENCE_ROUTER`, `NEXT_PUBLIC_AGENT_SBT`
     and `NEXT_PUBLIC_FORWARDER_ADDRESS` (see 0.3)
   - redeploy production with the usual DGX deploy procedure (DEPLOY.md §3).

The flag is the only code-side switch. The default stays `r1005` in the source until a
follow-up PR, after cutover, makes `r1006` the default and retires the r1005 book.

## 3. Verify

```bash
H=https://explorer.citrate.ai
# Block 0 hash: the RPC, the build, and the index agree on r1006.
curl -s $H/api/health | jq '.status, .components.chain, .components.indexer'
#   chain.status "ok", chain.network "r1006",
#   chain.genesis == chain.expectedGenesis == "0xa3651a27…cdd4",
#   indexer.genesis.recorded == same hash, indexer.genesis.status "ok",
#   indexer.status "ok" (or "lagging" while it backfills)
curl -s $H/api/blocks/0 | jq -r .hash               # 0xa3651a27…cdd4

# A contract only the r1006 book has: GuardianCanceller.
curl -s $H/api/contract/0xf84cb95142c876d44df1ea0c817838b440a4256d | jq '.label'
#   "GuardianCanceller" (r1005 builds don't know this address)

# Recent blocks are r1006's: heights near the r1006 head (thousands, not r1005's ~880k+),
# timestamps from after the cutover.
curl -s $H/api/latest | jq '.blocks[0] | {height, timestamp, hash}'
```

On the site, the footer, the header chain badge, the home "Chain status" card and Settings, then
"Add Citrate to your wallet", should read **r1006 · genesis 0xa365…cdd4**.

## 4. Rollback

The r1005 database is untouched apart from being read-only, so the chain side of a rollback is
env only. **User data is not.** Any API key, setting, watchlist entry or chat thread or message
created after the web flip exists only in the r1006 database. An env-only rollback leaves it
behind.

**Lifting a freeze.** A connection to a frozen database is read-only by default, so a plain
`ALTER DATABASE … RESET` over it fails with "cannot execute ALTER DATABASE in a read-only
transaction". Open an explicit read-write transaction for the RESET, then drop sessions that
were opened during the freeze so they reconnect writable. For database `$DB` at `$URL`:
```bash
psql -v ON_ERROR_STOP=1 "$URL" -c "BEGIN READ WRITE; ALTER DATABASE \"$DB\" RESET default_transaction_read_only; COMMIT;"
psql -v ON_ERROR_STOP=1 "$URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();"
psql -tA "$URL" -c "SHOW default_transaction_read_only"   # expect: off
```
Running the RESET from another database on the cluster (for example `defaultdb`) also works.
Re-running a lift is harmless. This was rehearsed on a local Postgres: the plain RESET is
rejected, the `BEGIN READ WRITE` form and the other-database form both lift the freeze, and new
sessions can write again.

Choose one of these before flipping back:
- **Carry the writes back.** Freeze r1006 (step 2.4's `ALTER DATABASE … read_only` and session
  terminate, against the r1006 database). Lift the freeze on r1005 (above, with
  `DB=$R1005_DB URL=$R1005_URL`). Then run the step 2.4 copy with the URLs swapped, so r1006's
  user tables replace r1005's. r1006's tables started as the frozen r1005 copy, so they are a
  superset. r1006 stays frozen as the archive of the rollback. If you later cut over to r1006
  again, lift its freeze the same way (`DB=<r1006 database> URL=$R1006_URL`).
- **Accept the loss.** Lift the freeze on r1005 (above) and flip back. Users lose what they wrote on
  r1006. This needs the owner's explicit OK.

Then:

1. If the RPC goes back to r1005: on the indexer host set `NEXT_PUBLIC_CITRATE_NETWORK=r1005`
   and `DATABASE_URL=$R1005_URL`, then restart. The guard checks r1005's recorded genesis and
   resumes from the r1005 cursor.
2. Vercel: set the same two values, restore the r1005 env overrides you unset in step 2.5
   (if any were set before), then rebuild and redeploy.
3. Make sure r1005 is writable again. If you haven't already, run "Lifting a freeze" above with
   `DB=$R1005_DB URL=$R1005_URL`, and check that `SHOW default_transaction_read_only` returns
   `off`.
4. Verify with §3, expecting `0x1dcfc490…75f1`, `network "r1005"`, and no `GuardianCanceller`
   label.

Never point an r1006-built indexer at the r1005 database, or the reverse. The guard refuses
(`genesis_mismatch`), but the fix is always to correct the env, never to edit
`indexer_state.genesis_hash`.

## 5. If the guard refuses

| `/api/health` / log code | Meaning | Fix |
|---|---|---|
| `rpc_not_expected_network` | RPC block 0 ≠ the build's network | The RPC hasn't flipped yet, or `NEXT_PUBLIC_CITRATE_NETWORK` is wrong. Fix the env and restart |
| `genesis_mismatch` | RPC block 0 ≠ the genesis this database recorded | Wrong `DATABASE_URL` for this network. Point at the right database and restart |
| `index_not_this_chain` | Nothing recorded, and the database holds another chain's rows | Usually an r1005 database (or an untruncated branch) under an r1006 build. Use the r1006 database |
| `not_migrated` | The database has no 0005 genesis columns | Run `pnpm db:migrate` against this `DATABASE_URL`, then restart the indexer |
| `unavailable` (log only) | The RPC returned no block 0 or errored | Transient. The indexer retries each tick and writes nothing until the check passes. It never replaces a stored refusal |

A refusal latches until the indexer restarts, and it is re-logged once a minute.
