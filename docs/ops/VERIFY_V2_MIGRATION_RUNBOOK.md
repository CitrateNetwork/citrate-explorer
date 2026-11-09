---
created: 2026-11-08T22:00:00Z
branch: feat/verification-v2-r2
author: Claude Opus 5.5 (verify v2 lane) for Larry Klosowski (owner)
status: active
---

# Runbook: verification v2 migration and deploy (DigitalOcean Postgres)

This runbook covers migration `0006_verification_v2`, the Vercel deploy that uses it, and the
verify worker on the indexer host. Follow it in order. Steps marked **OWNER OK** need the lead's
explicit go before you run them.

Where things live:

| Thing | Where |
|-------|-------|
| Production database | DO managed Postgres 17 cluster `citrate-comms-db`, id `3d4c6713-5987-404c-8ea5-e58afa94adad`, region nyc3, database `citratescan` |
| Roles | `citratescan_user` (indexer, rpc-1), `citratescan_web` (Vercel app) |
| Web app | Vercel project for `explorer.citrate.ai` |
| Indexer | rpc-1, `/opt/citratescan`, systemd `citratescan-indexer` |
| Verify worker (new) | rpc-1, same checkout, systemd `citratescan-verify-worker` (`deploy/verify-worker/`) |

Never touch the source cluster's users, firewall (trusted sources) or settings. The only cluster
this runbook creates or deletes is the dry-run fork.

## 1. What the migration does

Migration 0006 only adds things:

- new tables `verification_jobs`, `verified_contracts`, `contract_proxies` and `verification_state`, plus their indexes;
- one plpgsql function `verification_append_only()` and two `BEFORE UPDATE OR DELETE` row
  triggers that make `verified_contracts` and `contract_proxies` append-only;
- a copy-forward from `contract_verifications`: every old guid becomes a finished job
  (`origin = 'legacy'`), and every passing row becomes a legacy record in `verified_contracts`
  (`legacy_guid`, `legacy_source`, null genesis and code hash). Both inserts use
  `ON CONFLICT ("id") DO NOTHING`, so you can run them again safely.

The migration has no `ALTER`, `DROP`, `UPDATE` or `DELETE` against existing tables, and leaves
`contract_verifications` in place untouched. The drizzle migrator runs every pending migration in
a single transaction, so a failure leaves the database as it was.

## 2. Dry run on a fork (OWNER OK required before step 2.1)

### 2.1 Create the fork

```bash
export SRC=3d4c6713-5987-404c-8ea5-e58afa94adad
export FORK_NAME=citratescan-v2-dryrun-$(date -u +%Y%m%d)
doctl databases fork "$FORK_NAME" --restore-from-cluster-id "$SRC" --wait
export FORK_ID=$(doctl databases list -o json | jq -r --arg n "$FORK_NAME" '.[] | select(.name==$n) | .id')
echo "$FORK_ID"
```

The coordinator's form passes `--size db-s-1vcpu-1gb --region nyc3`. doctl 2.1.0's `fork --help`
does not list those flags, so the fork may inherit the source's size and region. Check
`doctl databases get "$FORK_ID"` and expect the source's monthly rate while the fork exists.

The fork holds a full copy of every database on the cluster, including the comms database. Treat
it as production data and delete it as soon as the checks pass (step 2.6).

### 2.2 Let this machine reach the fork only

```bash
MYIP=$(curl -s https://api.ipify.org)
doctl databases firewalls append "$FORK_ID" --rule ip_addr:"$MYIP"   # the FORK, never $SRC
doctl databases get-ca "$FORK_ID" -o json | jq -r .certificate | base64 -d > /tmp/fork-ca.pem
```

Keep credentials in environment variables and never echo them:

```bash
export FORK_ADMIN_URI=$(doctl databases connection "$FORK_ID" -o json --show | jq -r .uri | sed 's#/defaultdb?.*#/citratescan#')
export PGSSLROOTCERT=/tmp/fork-ca.pem PGSSLMODE=verify-full
```

### 2.3 Before: inventory

```bash
psql "$FORK_ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
-- Who owns the tables (run the migration as that role).
select tablename, tableowner from pg_tables where schemaname = 'public' order by 1;
-- drizzle's ledger: the newest row must be 0005 (created_at 1793757797181), or the
-- migrator would re-run older files.
select id, created_at from drizzle.__drizzle_migrations order by created_at;
-- What the web and indexer roles can do today, and default privileges for new tables.
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('citratescan_user', 'citratescan_web')
 group by 1, 2 order by 1, 2;
\ddp
-- The rows the copy-forward will carry.
select status, count(*) from contract_verifications group by 1 order by 1;
select count(*) as v1_total from contract_verifications;
SQL
```

Stop if the newest `__drizzle_migrations.created_at` is not `1793757797181` (0005). Find out how
0000–0005 were applied before going on.

### 2.4 Apply 0006 as the table owner

`scripts/db-migrate.mjs` needs `DATABASE_URL` and `DATABASE_CA_CERT`. Use the owner role from
step 2.3. If that is `citratescan_user`, read its password from the fork into a variable without
printing it:

```bash
OWNER=citratescan_user   # from 2.3
OWNER_PW=$(doctl databases user get "$FORK_ID" "$OWNER" -o json --show | jq -r '.[0].password // .password')
HOSTPORT=$(doctl databases connection "$FORK_ID" -o json | jq -r '"\(.host):\(.port)"')
export DATABASE_URL="postgresql://$OWNER:$OWNER_PW@$HOSTPORT/citratescan"
export DATABASE_CA_CERT="$(cat /tmp/fork-ca.pem)"
cd <this repo at the release commit>
node scripts/db-migrate.mjs          # prints the table list; the four new tables must appear
unset OWNER_PW
```

### 2.5 After: checks

```bash
psql "$FORK_ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
-- Ledger has 0006.
select count(*) = 7 as ledger_ok, max(created_at) = 1793797162891 as latest_is_0006 from drizzle.__drizzle_migrations;
-- Copy-forward row counts.
select (select count(*) from contract_verifications) as v1_total,
       (select count(*) from verification_jobs where origin = 'legacy') as legacy_jobs,
       (select count(*) from contract_verifications where status = 'pass') as v1_pass,
       (select count(*) from verified_contracts where legacy_guid is not null) as legacy_records;
-- Expect legacy_jobs = v1_total and legacy_records = v1_pass.
select status, result_code, count(*) from verification_jobs where origin = 'legacy' group by 1, 2 order by 1, 2;
-- The old table is unchanged (compare with 2.3).
select status, count(*) from contract_verifications group by 1 order by 1;
-- Triggers exist and are enabled.
select tgname, tgrelid::regclass, tgenabled from pg_trigger where tgname like '%append_only';
SQL

# Append-only proof, inside a transaction that is rolled back either way.
psql "$FORK_ADMIN_URI" <<'SQL'
begin;
insert into verified_contracts (id, chain_id, address, match_type, runtime_match, source_format)
  values ('dryrun-probe', 40204, '0x0000000000000000000000000000000000000000', 'full', 'full', 'legacy');
savepoint probe;
update verified_contracts set match_type = 'partial' where id = 'dryrun-probe';   -- must fail: append-only
rollback to savepoint probe;
delete from verified_contracts where id = 'dryrun-probe';                          -- must fail: append-only
rollback;
SQL
# Expect two "ERROR: verified_contracts is append-only" lines, and no dryrun-probe row afterwards.

# Run the copy-forward again (as during the deploy window, step 3.4): it must add nothing.
sed -n '/^-- Carry contract_verifications forward/,$p' src/lib/db/migrations/0006_verification_v2.sql \
  | sed 's/^--> statement-breakpoint$//' | psql "$FORK_ADMIN_URI" -v ON_ERROR_STOP=1
# Expect "INSERT 0 0" twice.
```

Then check what each role can do on the new tables. The web app needs `SELECT` on all four and
`INSERT` on `verification_jobs`. The verify worker needs `SELECT, INSERT, UPDATE` on
`verification_jobs`, `SELECT, INSERT` on `verified_contracts` and `contract_proxies`,
`SELECT, INSERT, UPDATE` on `verification_state`, and `SELECT` on `transactions` and `receipts`.
Neither role needs `TRUNCATE`, `DELETE` or `TRIGGER` on the two append-only tables, and neither
should have them: the row triggers do not fire on `TRUNCATE`, and the table owner can disable
triggers.

```bash
psql "$FORK_ADMIN_URI" -c "select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants where table_schema='public'
   and table_name in ('verification_jobs','verified_contracts','contract_proxies','verification_state')
  group by 1,2 order by 1,2;"
```

If the default privileges don't give `citratescan_web` what it needs, this is the grant set to
rehearse on the fork and then repeat on production in step 3.2:

```sql
grant select on verification_jobs, verified_contracts, contract_proxies, verification_state to citratescan_web;
grant insert on verification_jobs to citratescan_web;
revoke truncate, delete, update, trigger on verified_contracts, contract_proxies from citratescan_web;
```

If `citratescan_user` owns the tables, it has every privilege on them, including the right to
disable the triggers. A separate least-privilege role for the worker would close that gap. That
is an owner decision; it is not required for this release.

Finally, smoke the app against the fork from a local build (not Vercel): set `DATABASE_URL` to
`citratescan_web` on the fork, `pnpm build && pnpm start`, then
`curl -s 'http://localhost:3000/api?module=contract&action=getsourcecode&address=<a v1-verified address>'`.
The answer must carry the old source as a legacy record.

Record the counts from 2.3 and 2.5 in the release sprint file.

### 2.6 Delete the fork

```bash
doctl databases get "$FORK_ID" -o json | jq -r '.[0].name // .name'   # must print $FORK_NAME
doctl databases delete "$FORK_ID"                                  # the fork only, never $SRC
rm -f /tmp/fork-ca.pem
```

## 3. Production (OWNER OK; after a clean dry run)

Order matters: database first, then web, then worker.

1. **Backup.** Take a manual backup of `citrate-comms-db` in the DO control panel, or rely on the
   latest automatic one, and note its timestamp. That is the restore point for rollback.
2. **Migrate.** On a machine in the cluster's trusted sources, as the table owner from step 2.3,
   with `DATABASE_URL` / `DATABASE_CA_CERT` set as in step 2.4 but pointing at the production
   cluster, run `node scripts/db-migrate.mjs` from the release commit. Apply the grants you
   rehearsed in step 2.5, if any. Re-run the step 2.5 count queries and record the result.
   - The live indexer on rpc-1 keeps running: it never reads or writes the new tables.
   - The live v1 web app keeps running too: it still reads and writes `contract_verifications`.
3. **Deploy the web app.** Merge the release PR to `main`, then promote the Vercel production
   build. Env: no new required variables. The optional `CITRATE_VERIFY_*` caps are listed in
   DEPLOY.md §1.
4. **Close the deploy-window gap.** Submissions to the old web app between step 2 and step 3 went
   to `contract_verifications` only. Re-run the copy-forward (the `sed … | psql` command from step
   2.5, against production as the owner). It is idempotent, so it only adds rows that are missing.
   One limit: a v1 job that was still pending at migration time is already a finished `fail` job
   ("resubmit"). If it passed in v1 during the window, the re-run adds its legacy record, so the
   contract page shows the source, but polling that guid still says fail.
5. **Start the verify worker on rpc-1.** Update `/opt/citratescan/app` to the release commit, run
   `pnpm install --frozen-lockfile`, then `pnpm verify:worker --once` as a smoke test, then
   install and enable `citratescan-verify-worker.service` (DEPLOY.md §4b). The worker uses the
   same `DATABASE_URL` role as the indexer unless the owner chose a separate role. Updating the
   checkout also changes the indexer's code: compare the indexer's running commit to the release
   commit first, and restart `citratescan-indexer` only if you mean to deploy its changes too.
   Without the worker, submissions stay "Pending in queue". Nothing is lost.
6. **Re-verify legacy records (optional).** `pnpm verify:worker --requeue-legacy` queues every
   legacy record that has standard JSON source for re-verification against the current chain.
7. **Smoke.**
   - `forge verify-contract --verifier custom --verifier-url https://explorer.citrate.ai/api …`
     on a test contract ends in `Pass - Verified`.
   - `citrate contract verify <addr> --build-info … --watch` and
     `citrate contract verify-get <addr>` (citrate-chain CLI).
   - `curl -s https://explorer.citrate.ai/api/contract/<addr>/verified | jq .record.matchType`.
   - The contract page Code tab shows every source file and the source-map highlighting.

## 4. Rollback

- **Web app.** In Vercel, promote the previous production deployment. The v1 code ignores the new
  tables and keeps working on `contract_verifications`, which the migration left alone.
- **Worker.** `sudo systemctl disable --now citratescan-verify-worker`.
- **Database.** You don't need to undo anything to get back to v1: the new tables are inert to
  the old code. Leave them in place, so records verified under v2 survive a later roll-forward.
  To remove them anyway (owner OK), run this as the owner in one transaction:

  ```sql
  begin;
  drop table verified_contracts, contract_proxies, verification_jobs, verification_state;
  drop function verification_append_only();
  delete from drizzle.__drizzle_migrations where created_at = 1793797162891;
  commit;
  ```

  Dropping the tables removes their triggers too. A full restore to the backup from step 3.1 is
  the last resort. It would also roll back indexer writes and the comms database on the same
  cluster, so avoid it.

## 5. Neon references (noted, not changed)

The code runs on node-postgres (`pg`) with a CA-verified TLS connection
(`src/lib/db/client.ts`, `scripts/db-migrate.mjs`). Nothing in the verification path is specific
to Neon. These files still mention Neon in comments or docs, and a later docs pass should update
them: `CLAUDE.md` (architecture section), `DEPLOY.md` §2 ("Provision the index (Neon)"),
`drizzle.config.ts` (header comment), `.env.example`, `src/lib/db/schema.ts`,
`src/lib/db/client.ts`, `src/lib/indexer/{repository,ingest}.ts`,
`scripts/indexer/run.ts` and `src/app/api/contract/[addr]/source/route.ts` (comments).
