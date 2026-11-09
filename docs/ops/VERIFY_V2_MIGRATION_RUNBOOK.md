---
created: 2026-11-08T22:00:00Z
branch: feat/verification-v2-r2
author: Claude Opus 5.5 (verify v2 lane) for Larry Klosowski (owner)
status: active
---

# Runbook: verification v2 migration and deploy (DigitalOcean Postgres)

This runbook covers migration `0006_verification_v2`, the Vercel deploy that uses it, and the
verify worker on the indexer host. Follow it in order. Steps marked **OWNER OK** need the lead's
explicit go before you run them. §6 records the dry run of the final migration (2026-11-09).

Where things live:

| Thing | Where |
|-------|-------|
| Production database | DO managed Postgres 17 cluster `citrate-comms-db`, id `3d4c6713-5987-404c-8ea5-e58afa94adad`, `db-s-1vcpu-1gb`, nyc3, database `citratescan` |
| Table owner | `citratescan_user`: owns every `public` table and the `drizzle` schema; the indexer connects as it |
| Web role | `citratescan_web` (Vercel app). Default privileges give it SELECT on new tables |
| Worker role (new) | `citratescan_verify`: the verify worker. Not the table owner |
| Web app | Vercel project for `explorer.citrate.ai` |
| Indexer | rpc-1, `/opt/citratescan`, systemd `citratescan-indexer` |
| Verify worker (new) | rpc-1, same checkout, systemd `citratescan-verify-worker` (`deploy/verify-worker/`), Unix user `citratescan-verify` |

In the dry run, never touch the source cluster's users, firewall (trusted sources) or settings.
The only cluster the dry run creates or deletes is its fork. The production steps in §3 add one
database user to the source cluster (step 3.2), with OWNER OK.

## 1. What the migration does

Migration 0006 only adds things:

- new tables `verification_jobs`, `verified_contracts`, `contract_proxies` and `verification_state`, plus their indexes;
- one plpgsql function `verification_append_only()` and four triggers on `verified_contracts` and
  `contract_proxies`: `BEFORE UPDATE OR DELETE` per row, and `BEFORE TRUNCATE` per statement;
- privileges on the four new tables, for whichever of these roles exist: `citratescan_web` gets
  SELECT on jobs, records and proxies, and INSERT on jobs. `citratescan_verify` gets SELECT and
  INSERT on jobs, records and proxies; UPDATE on the job-state columns only; SELECT, INSERT and
  UPDATE on `verification_state`; and SELECT on `transactions` and `receipts`. Everything else on
  the new tables is revoked from both roles first, whatever the default privileges say;
- a copy-forward from `contract_verifications`: every old guid becomes a finished job
  (`origin = 'legacy'`), and every passing row becomes a legacy record in `verified_contracts`
  (`legacy_guid`, `legacy_source`, null genesis and code hash). Both inserts use
  `ON CONFLICT ("id") DO NOTHING`, so you can run them again safely. The app shows legacy records
  as "legacy, not confirmed for current code", never as verified.

The migration has no `ALTER`, `DROP`, `UPDATE` or `DELETE` against existing tables, and leaves
`contract_verifications` in place untouched. The drizzle migrator runs every pending migration in
a single transaction, so a failure leaves the database as it was.

The table owner (`citratescan_user`) can still disable triggers; Postgres allows that to any
table owner. That is why neither the web app nor the worker connects as the owner.

## 2. Dry run on a fork (OWNER OK required before step 2.1)

### 2.1 Create the fork

```bash
export SRC=3d4c6713-5987-404c-8ea5-e58afa94adad
export FORK_NAME=citratescan-v2-dryrun
doctl databases fork "$FORK_NAME" --restore-from-cluster-id "$SRC" --wait
export FORK_ID=$(doctl databases list -o json | jq -r --arg n "$FORK_NAME" '.[] | select(.name==$n) | .id')
doctl databases get "$FORK_ID"
```

- `doctl databases fork` (2.1.0) takes no `--size` or `--region`. The fork inherits the source's
  `db-s-1vcpu-1gb` in nyc3 (about $15 a month list, billed hourly). `--wait` may print text that
  isn't JSON, so get the id with `doctl databases list`. The fork takes a few minutes to go from
  `forking` to `online`.
- The fork holds a full copy of every database on the cluster. Treat it as production data and
  delete it as soon as the checks pass (step 2.7).

### 2.2 Let this machine reach the fork only

The fork starts with **no trusted sources**, which on DO means any IP can connect. Add yours right
away:

```bash
MYIP=$(curl -s https://api.ipify.org)
doctl databases firewalls append "$FORK_ID" --rule ip_addr:"$MYIP"   # the FORK, never $SRC
doctl databases get-ca "$FORK_ID" -o json | jq -r .certificate | base64 -d > /tmp/fork-ca.pem
export PGSSLROOTCERT=/tmp/fork-ca.pem PGSSLMODE=verify-full
```

Keep credentials in variables (or a 0600 file), and never echo them:

```bash
HOSTPORT=$(doctl databases connection "$FORK_ID" -o json | jq -r '"\(.host):\(.port)"')
uri() { echo "postgresql://$1:$(doctl databases user get "$FORK_ID" "$1" -o json --show | jq -r '.[0].password // .password')@$HOSTPORT/citratescan"; }
export FORK_ADMIN_URI=$(doctl databases connection "$FORK_ID" -o json --show | jq -r .uri | sed 's#/defaultdb?.*#/citratescan#')
export OWNER_URI=$(uri citratescan_user) WEB_URI=$(uri citratescan_web)
```

### 2.3 Before: inventory

```bash
psql "$FORK_ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
select tableowner, count(*) from pg_tables where schemaname = 'public' group by 1;     -- expect citratescan_user only
select id, created_at from drizzle.__drizzle_migrations order by created_at;            -- newest must be 1793757797181 (0005)
\ddp                                                                                    -- citratescan_web=r/citratescan_user
select status, count(*) from contract_verifications group by 1 order by 1;               -- rows the copy-forward carries
select to_regclass('public.verified_contracts');                                         -- expect null
SQL
```

Stop if the newest `__drizzle_migrations.created_at` is not `1793757797181` (0005).

### 2.4 Create the worker role on the fork

```bash
doctl databases user create "$FORK_ID" citratescan_verify > /dev/null    # the FORK
export VERIFY_URI=$(uri citratescan_verify)
```

The role must exist before you migrate. The migration grants its privileges only if the role is
already there.

### 2.5 Apply 0006 as the table owner

```bash
cd <this repo at the release commit>
DATABASE_URL="$OWNER_URI" DATABASE_CA_CERT="$(cat /tmp/fork-ca.pem)" node scripts/db-migrate.mjs
# prints the table list: the four new tables must appear
```

### 2.6 After: checks

```bash
psql "$FORK_ADMIN_URI" -v ON_ERROR_STOP=1 <<'SQL'
select count(*) = 7 as ledger_ok, max(created_at) = 1793797162891 as latest_is_0006 from drizzle.__drizzle_migrations;
select (select count(*) from contract_verifications) v1_total, (select count(*) from verification_jobs where origin='legacy') legacy_jobs,
       (select count(*) from contract_verifications where status='pass') v1_pass, (select count(*) from verified_contracts where legacy_guid is not null) legacy_records;
-- expect legacy_jobs = v1_total, legacy_records = v1_pass
select tgname, tgenabled from pg_trigger where tgname like '%append_only' or tgname like '%no_truncate' order by 1;   -- 4 rows, all O
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
 where table_schema='public' and grantee in ('citratescan_web','citratescan_verify')
   and table_name in ('verification_jobs','verified_contracts','contract_proxies','verification_state','transactions','receipts')
 group by 1,2 order by 1,2;
SQL
```

The grants must read exactly:

| Role | Table | Privileges |
|------|-------|------------|
| citratescan_verify | contract_proxies, verified_contracts | INSERT, SELECT |
| citratescan_verify | verification_jobs | INSERT, SELECT (plus column UPDATE on the ten job-state columns) |
| citratescan_verify | verification_state | INSERT, SELECT, UPDATE |
| citratescan_verify | receipts, transactions | SELECT |
| citratescan_web | contract_proxies, verified_contracts | SELECT |
| citratescan_web | verification_jobs | INSERT, SELECT |
| citratescan_web | receipts, transactions | SELECT (already there) |

Probe each role. Every statement runs in a rolled-back transaction:

```bash
probe() { uri=$1; shift; for s in "$@"; do printf '%-60.60s -> ' "$s"; psql "$uri" -c "begin; $s; rollback;" 2>&1 | grep -oE "ERROR:.*|INSERT 0 [0-9]+|UPDATE [0-9]+|TRUNCATE TABLE" | head -1; done; }
ID="(select id from verified_contracts limit 1)"   # needs at least one record; seed one in the fork if v1 is empty
# owner: all four refused by the triggers ("... is append-only")
probe "$OWNER_URI" "truncate verified_contracts" "truncate contract_proxies" "update verified_contracts set match_type='partial' where id=$ID" "delete from verified_contracts where id=$ID"
# web: only the INSERT succeeds
probe "$WEB_URI" "insert into verification_jobs (id,origin,chain_id,address,request) values ('p','etherscan',40204,'0x01','{}')" \
  "update verification_jobs set status='pass'" "truncate verified_contracts" "insert into verified_contracts (id,chain_id,address,match_type,runtime_match,source_format) values ('p',40204,'0x01','full','full','x')"
# worker: INSERT record and job-state UPDATE succeed; the rest are refused
probe "$VERIFY_URI" "insert into verified_contracts (id,chain_id,address,match_type,runtime_match,source_format) values ('p',40204,'0x01','full','full','x')" \
  "update verified_contracts set match_type='partial' where id=$ID" "truncate verified_contracts" "update verification_jobs set status='running', worker_id='w'" \
  "update verification_jobs set request='{}'" "alter table verified_contracts disable trigger all"
```

Run the copy-forward again, as in step 3.5. It must insert nothing:

```bash
sed -n '/^-- Carry contract_verifications forward/,$p' src/lib/db/migrations/0006_verification_v2.sql \
  | sed 's/^--> statement-breakpoint$//' | psql "$OWNER_URI" -v ON_ERROR_STOP=1      # "INSERT 0 0" twice
```

Then run the real worker as `citratescan_verify` against the fork. It reads the public RPC only:

```bash
DATABASE_URL="$VERIFY_URI" DATABASE_CA_CERT="$(cat /tmp/fork-ca.pem)" NEXT_PUBLIC_CITRATE_RPC_URL=https://rpc.citrate.ai \
  npx tsx scripts/verify/worker.ts --requeue-legacy        # then --once until it logs "idle"
```

### 2.7 Delete the fork

```bash
doctl databases get "$FORK_ID" -o json | jq -r '.[0].name // .name'   # must print $FORK_NAME
[ "$FORK_ID" != "$SRC" ] && doctl databases delete "$FORK_ID" --force
doctl databases list                                               # only citrate-comms-db remains
rm -f /tmp/fork-ca.pem; unset FORK_ADMIN_URI OWNER_URI WEB_URI VERIFY_URI
```

## 3. Production (OWNER OK; after a clean dry run)

Order matters: database first, then web, then worker.

1. **Backup.** Take a manual backup of `citrate-comms-db` (DO control panel), or note the latest
   automatic backup's timestamp. That is the restore point.
2. **Worker role.** `doctl databases user create 3d4c6713-5987-404c-8ea5-e58afa94adad citratescan_verify`.
   Store its password in 1Password, not in a file or shell history. This is the one change to the
   source cluster's users, and it must happen before step 3.3.
3. **Migrate.** From a machine in the cluster's trusted sources, as `citratescan_user`, with
   `DATABASE_URL` and `DATABASE_CA_CERT` for production (CA:
   `doctl databases get-ca <SRC>`), run `node scripts/db-migrate.mjs` from the release commit.
   Re-run the step 2.6 count, trigger and grant queries against production, and check the grants
   match the table. No manual grants are needed.
   - The live indexer on rpc-1 keeps running: it never reads or writes the new tables.
   - The live v1 web app keeps running too, still on `contract_verifications`.
4. **Deploy the web app.** Merge the release PR to `main`, then promote the Vercel production
   build. No new required env vars (`CITRATE_VERIFY_*` caps are optional, DEPLOY.md §1). The web
   app keeps connecting as `citratescan_web`.
5. **Close the deploy-window gap.** Re-run the copy-forward against production as the owner (the
   `sed … | psql` command in step 2.6). It's idempotent. The dry run found `contract_verifications`
   empty in production, so this is expected to insert 0 rows. If v1 rows appear before the
   release, one limit applies: a v1 job still pending at migration time is already a finished
   `fail` job ("resubmit"). If it passed in v1 during the window, the re-run adds its legacy
   record, but polling that guid still says fail.
6. **Verify worker on rpc-1.**
   - `sudo useradd --system --no-create-home --shell /usr/sbin/nologin citratescan-verify`.
   - Update `/opt/citratescan/app` to the release commit and run `pnpm install --frozen-lockfile`.
     The indexer uses the same checkout: compare its running commit to the release commit first,
     and restart `citratescan-indexer` only if you mean to deploy its changes.
   - Write `/etc/citratescan/verify-worker.env` (root, 0600). It holds `DATABASE_URL` for
     **`citratescan_verify`**, never `citratescan_user`, plus `DATABASE_CA_CERT`,
     `NEXT_PUBLIC_CITRATE_RPC_URL` and any `CITRATE_VERIFY_*` caps.
   - Smoke, with the env never on a command line:
     `sudo systemd-run --wait --pipe -p User=citratescan-verify -p EnvironmentFile=/etc/citratescan/verify-worker.env -p WorkingDirectory=/opt/citratescan/app /usr/bin/env pnpm verify:worker --once`.
   - Install and enable `deploy/verify-worker/citratescan-verify-worker.service` (DEPLOY.md §4b).
     It runs as `citratescan-verify`. `pnpm` and `node` must be on systemd's PATH, or use absolute
     paths in `ExecStart`.
7. **Re-verify legacy records (required).** `pnpm verify:worker --requeue-legacy` as the worker. It
   queues every legacy record that has standard JSON source for re-verification against the
   current chain, and marks the rest `not-standard-json`. Until then, legacy records are shown only
   as not confirmed.
8. **Smoke.**
   - `forge verify-contract --verifier custom --verifier-url https://explorer.citrate.ai/api …`
     on a test contract ends in `Pass - Verified`.
   - `citrate contract verify <addr> --build-info … --watch`, then `citrate contract verify-get <addr>`.
   - `curl -s https://explorer.citrate.ai/api/contract/<addr>/verified | jq .record.matchType`.
   - The contract page Code tab shows every source file and the source-map highlighting.

## 4. Rollback

- **Web app.** In Vercel, promote the previous production deployment. The v1 code ignores the new
  tables and keeps working on `contract_verifications`, which the migration left alone.
- **Worker.** `sudo systemctl disable --now citratescan-verify-worker`.
- **Database.** You don't need to undo anything to get back to v1: the new tables are inert to the
  old code. Leave them, so records verified under v2 survive a later roll-forward. To remove them
  anyway (owner OK), run this as `citratescan_user` (tested on the fork, §6):

  ```sql
  begin;
  drop table verified_contracts, contract_proxies, verification_jobs, verification_state;
  drop function verification_append_only();
  delete from drizzle.__drizzle_migrations where created_at = 1793797162891;
  commit;
  ```

  Dropping the tables removes their triggers and grants. `citratescan_verify` can stay; it then
  owns nothing and can read nothing. A full restore to the step 3.1 backup is the last resort. It
  would also roll back indexer writes and the other database on the cluster.

## 5. Neon references (noted, not changed)

The code runs on node-postgres (`pg`) with a CA-verified TLS connection
(`src/lib/db/client.ts`, `scripts/db-migrate.mjs`). Nothing in the verification path is specific
to Neon. These files still mention Neon in comments or docs, and a later docs pass should update
them: `CLAUDE.md` (architecture section), `DEPLOY.md` §2 ("Provision the index (Neon)"),
`drizzle.config.ts` (header comment), `.env.example`, `src/lib/db/schema.ts`,
`src/lib/db/client.ts`, `src/lib/indexer/{repository,ingest}.ts`,
`scripts/indexer/run.ts` and `src/app/api/contract/[addr]/source/route.ts` (comments).

## 6. Dry run record (2026-11-09, fork `citratescan-v2-dryrun`, deleted)

Fork `a0e35aaf-a559-484a-bb4a-82ae9da6ca23` of `citrate-comms-db`: `db-s-1vcpu-1gb`, nyc3, PG 17.11.
It existed from 06:32 to 06:53 UTC.

- **Inventory.** All 19 `public` tables and the `drizzle` schema are owned by `citratescan_user`.
  The ledger has 6 rows, newest `1793757797181` (0005). Default privileges give `citratescan_web`
  SELECT on new tables. `contract_verifications` has **0 rows** in production.
- **First pass** (0006 as reviewed at 0712409). It applied cleanly. With default privileges only,
  `citratescan_web` got just SELECT on `verification_jobs`, so web submissions would have failed
  ("permission denied"). The owner's TRUNCATE of `verified_contracts` succeeded, because row
  triggers don't fire on it. Both findings are fixed in the final 0006. Then the §4 rollback SQL
  was run: the ledger went back to 0005 and the tables were gone.
- **Final pass** (0006 at the release branch, worker role created first, synthetic v1 rows
  seeded in the fork only: 5 rows, 3 passing):
  - the ledger ends at 0006;
  - 5 legacy jobs and 3 legacy records were created, and the v1 table is unchanged;
  - all 4 triggers are enabled;
  - the grants exactly match the §2.6 table, with no manual grants;
  - the owner is refused TRUNCATE, UPDATE and DELETE on records;
  - the web role can enqueue jobs and do nothing else on the verification tables;
  - the worker role can INSERT records and UPDATE job-state columns. UPDATE or DELETE on records,
    TRUNCATE, UPDATE on `request`, DELETE on jobs and `DISABLE TRIGGER` are all refused;
  - the copy-forward re-run inserted 0 and 0 rows;
  - the real worker as `citratescan_verify` ran `--requeue-legacy` (queued 1), then `--once`
    (claimed it and finished it as `no_code`, since the synthetic address has no code), then idle.
