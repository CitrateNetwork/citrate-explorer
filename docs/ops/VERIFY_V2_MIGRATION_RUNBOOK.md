---
created: 2026-11-09T02:51:14Z
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
| Indexer | rpc-1, systemd `citratescan-indexer`: `WorkingDirectory=/root/citrate-explorer` at `f5c1ba3` (2026-11-03), `EnvironmentFile=/etc/citratescan-indexer.env`, CA from `/etc/citratescan/db-ca.pem`, runs `/usr/bin/pnpm --silent indexer` |
| Lag guard | rpc-1, `/opt/citratescan/lag-guard` |
| Verify worker (new) | rpc-1, its own checkout `/opt/citratescan/verify` owned by Unix user `citratescan-verify`, systemd `citratescan-verify-worker` (`deploy/verify-worker/`) |
| Secrets | 1Password vault `citrate-infra`, Database items: `citratescan_user DB (explorer owner/indexer)` (id `bnx25tyytdmxjxqsdckwde6rdm`), `citratescan_verify DB (explorer verify worker)` (id `ikrhodwwbkthwjxs4mmhljjk3u`), `citratescan_web DB (Vercel explorer prod)` (id `zgb6q5r4f4ptor223nvh2xaydi`). Fields: `hostname`, `port`, `database`, `username`, `password`. Refer to items by id: the titles contain `/`, which `op://vault/item/field` references cannot carry |

In the dry run, never touch the source cluster's users, firewall (trusted sources) or settings.
The only cluster the dry run creates or deletes is its fork. The production steps in §3 add one
database user to the source cluster (step 3.2), with OWNER OK.

## 1. What the migration does

Migration 0006 only adds things:

- new tables `verification_jobs`, `verified_contracts`, `contract_proxies` and `verification_state`, plus their indexes;
- one plpgsql function `verification_append_only()` and four triggers on `verified_contracts` and
  `contract_proxies`: `BEFORE UPDATE OR DELETE` per row, and `BEFORE TRUNCATE` per statement;
- privileges on the four new tables, for whichever of these roles exist: `citratescan_web` gets
  SELECT on jobs, records and proxies, and INSERT on a job's eight request columns only (status
  and outcome take their defaults). `citratescan_verify` gets SELECT and
  INSERT on jobs, records and proxies; UPDATE on the job-state columns only; SELECT, INSERT and
  UPDATE on `verification_state`; and SELECT on `transactions` and `receipts`. Everything else on
  the new tables is revoked from both roles first, whatever the default privileges say;
- a copy-forward from `contract_verifications`: every old guid becomes a finished job
  (`origin = 'legacy'`), and every passing row becomes a legacy record in `verified_contracts`
  (`legacy_guid`, `legacy_source`, null genesis and code hash). Both inserts use
  `ON CONFLICT ("id") DO NOTHING`, so you can run them again safely. Legacy records are not
  verified anywhere: the Etherscan and Sourcify APIs answer as for an unverified contract, an old
  guid polls as a failure ("not confirmed for the current code; resubmit"), and the contract
  page shows the old source labelled "legacy, not confirmed for current code".

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

Keep passwords out of argv and out of the terminal. psql reads them from a 0600 pgpass file,
and the connection URIs below carry no password:

```bash
HOST=$(doctl databases connection "$FORK_ID" -o json | jq -r .host); PORT=$(doctl databases connection "$FORK_ID" -o json | jq -r .port)
export PGPASSFILE=$(mktemp); chmod 600 "$PGPASSFILE"
addpw() { doctl databases user get "$FORK_ID" "$1" -o json --show | jq -r --arg h "$HOST" --arg p "$PORT" --arg u "$1" '"\($h):\($p):citratescan:\($u):" + (.[0].password // .password)' >> "$PGPASSFILE"; }
for u in doadmin citratescan_user citratescan_web; do addpw $u; done
uri() { echo "postgresql://$1@$HOST:$PORT/citratescan"; }   # no password: psql reads PGPASSFILE
export FORK_ADMIN_URI=$(uri doadmin) OWNER_URI=$(uri citratescan_user) WEB_URI=$(uri citratescan_web)
# For node (scripts/db-migrate.mjs, the worker): a URL with the password, built into the
# environment, never into argv. node-postgres does not read PGPASSFILE.
pwurl() { awk -F: -v u="$1" '$4==u {print "postgresql://" u ":" $5 "@" $1 ":" $2 "/citratescan"}' "$PGPASSFILE"; }
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
addpw citratescan_verify; export VERIFY_URI=$(uri citratescan_verify)
```

The role must exist before you migrate. The migration grants its privileges only if the role is
already there.

### 2.5 Apply 0006 as the table owner

```bash
cd <this repo at the release commit>
DATABASE_URL="$(pwurl citratescan_user)" DATABASE_CA_CERT="$(cat /tmp/fork-ca.pem)" node scripts/db-migrate.mjs
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
| citratescan_web | verification_jobs | SELECT (plus column INSERT on the eight request columns: id, kind, origin, chain_id, genesis_hash, address, request, source_hash) |
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
DATABASE_URL="$(pwurl citratescan_verify)" DATABASE_CA_CERT="$(cat /tmp/fork-ca.pem)" NEXT_PUBLIC_CITRATE_RPC_URL=https://rpc.citrate.ai \
  npx tsx scripts/verify/worker.ts --requeue-legacy        # then --once until it logs "idle"
```

### 2.7 Delete the fork

```bash
doctl databases get "$FORK_ID" -o json | jq -r '.[0].name // .name'   # must print $FORK_NAME
[ "$FORK_ID" != "$SRC" ] && doctl databases delete "$FORK_ID" --force
doctl databases list                                               # only citrate-comms-db remains
rm -f /tmp/fork-ca.pem "$PGPASSFILE"; unset PGPASSFILE FORK_ADMIN_URI OWNER_URI WEB_URI VERIFY_URI
```

## 3. Production (OWNER OK; after a clean dry run)

Order matters: database first, then web, then worker. Set once:

```bash
export SRC=3d4c6713-5987-404c-8ea5-e58afa94adad
export DATABASE_CA_CERT="$(doctl databases get-ca "$SRC" -o json | jq -r .certificate | base64 -d)"   # public, not secret
```

1. **Restore point.** DigitalOcean managed Postgres has no on-demand backup. It keeps daily
   backups plus point-in-time recovery (PITR) for the retention window, and a restore always
   creates a new cluster. Note the current UTC time just before step 3.3 (`date -u`). That time is
   the restore point, used with
   `doctl databases fork <name> --restore-from-cluster-id "$SRC" --restore-from-timestamp "<YYYY-MM-DD HH:MM:SS +0000 UTC>"`.
   If you want a standing copy anyway, fork the cluster right before migrating (§2.1 steps,
   delete it afterwards).
2. **Worker role.** Create it, and store the password straight into 1Password without it touching
   the terminal, argv or shell history:

   ```bash
   T=$(mktemp); chmod 600 "$T"
   doctl databases user create "$SRC" citratescan_verify -o json --show \
     | jq '{title: "citratescan_verify DB (explorer verify worker)", category: "DATABASE",
            fields: [{id: "username", type: "STRING", value: (.[0].name // .name)},
                     {id: "password", type: "CONCEALED", value: (.[0].password // .password)},
                     {id: "database", type: "STRING", value: "citratescan"}]}' > "$T"
   op item create --vault citrate-infra --template "$T" > /dev/null
   rm -f "$T"
   ```

   This is the one change to the source cluster's users. It must happen before step 3.3. Done on
   2026-11-09: item id `ikrhodwwbkthwjxs4mmhljjk3u`.
3. **Migrate.** From a machine in the cluster's trusted sources, as `citratescan_user`. The
   credentials come from 1Password through `op run`, so they never appear in argv or the terminal.
   The URL is assembled inside the shell, so it exists only in node's environment:

   ```bash
   I=bnx25tyytdmxjxqsdckwde6rdm      # citratescan_user DB (explorer owner/indexer)
   printf 'PGHOST=op://citrate-infra/%s/hostname\nPGPORT=op://citrate-infra/%s/port\nPGUSER=op://citrate-infra/%s/username\nPGPASSWORD=op://citrate-infra/%s/password\nPGDATABASE=citratescan\n' $I $I $I $I > owner.env   # references only
   op run --env-file=owner.env -- sh -c 'DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$PGDATABASE" exec node scripts/db-migrate.mjs'
   rm owner.env
   ```

   The 1Password desktop-app integration asks for approval on the Mac. If `op` reports
   "authorization timeout", approve it in the app and retry.

   Re-run the §2.6 count, trigger and grant queries against production, through a pgpass file as
   in §2.2, and check the grants match the table. No manual grants are needed.
   - The live indexer keeps running: it never reads or writes the new tables.
   - The live v1 web app keeps running too, still on `contract_verifications`.
4. **Deploy the web app.** Merge the release PR to `main`, then promote the Vercel production
   build. No new required env vars (`CITRATE_VERIFY_*` caps are optional, DEPLOY.md §1). The web
   app keeps connecting as `citratescan_web`.
5. **Close the deploy-window gap.** Re-run the copy-forward against production as the owner. Step
   3.3 removed `migrate.env`, so write a new env file of `op://` references, in the libpq
   variables psql reads. That way no URL or password reaches psql's argv:

   ```bash
   cat > copyforward.env <<'REFS'                    # references only, not secrets
   PGHOST=op://citrate-infra/bnx25tyytdmxjxqsdckwde6rdm/hostname
   PGPORT=op://citrate-infra/bnx25tyytdmxjxqsdckwde6rdm/port
   PGUSER=op://citrate-infra/bnx25tyytdmxjxqsdckwde6rdm/username
   PGPASSWORD=op://citrate-infra/bnx25tyytdmxjxqsdckwde6rdm/password
   PGDATABASE=citratescan
   PGSSLMODE=verify-full
   REFS
   doctl databases get-ca "$SRC" -o json | jq -r .certificate | base64 -d > prod-ca.pem
   sed -n '/^-- Carry contract_verifications forward/,$p' src/lib/db/migrations/0006_verification_v2.sql \
     | sed 's/^--> statement-breakpoint$//' \
     | PGSSLROOTCERT=prod-ca.pem op run --env-file=copyforward.env -- psql -v ON_ERROR_STOP=1
   rm copyforward.env prod-ca.pem
   ```

   It's idempotent. The dry run found `contract_verifications`
   empty in production, so this should insert 0 rows. If v1 rows appear before the release: a v1
   job still pending at migration time is a finished `fail` job ("resubmit"), and any carried-over
   guid polls as not confirmed.
6. **Verify worker on rpc-1.** The worker gets its own checkout. The indexer's stays as it is (see
   "The indexer" below).

   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin citratescan-verify
   sudo install -d -o citratescan-verify -g citratescan-verify -m 0750 /opt/citratescan/verify
   sudo -u citratescan-verify git clone https://github.com/CitrateNetwork/citrate-explorer.git /opt/citratescan/verify
   sudo -u citratescan-verify git -C /opt/citratescan/verify checkout <merged main commit>
   # dev dependencies too: the unit runs node_modules/tsx directly. /usr/bin/pnpm is a corepack
   # shim: for a user without its own pin it fetches the newest pnpm (12.x), which ignores
   # package.json "pnpm.overrides" and rejects the frozen lockfile. Pin the version root uses.
   # pnpm's store and home live inside the worker's own directory (no /tmp, no shared home)
   sudo -u citratescan-verify sh -c 'cd /opt/citratescan/verify && printf ".home/\n.pnpm-store/\n" >> .git/info/exclude \
     && HOME=/opt/citratescan/verify/.home COREPACK_HOME=/opt/citratescan/verify/.home/corepack \
        /usr/bin/corepack pnpm@10.34.1 install --frozen-lockfile --store-dir /opt/citratescan/verify/.pnpm-store'
   # env: root:root 0600. DATABASE_URL for citratescan_verify (from the 1Password item of step 3.2),
   # NEXT_PUBLIC_CITRATE_RPC_URL, optional CITRATE_VERIFY_* caps. No CA here: the unit loads
   # /etc/citratescan/db-ca.pem (the indexer's file) as a credential.
   # Run on the Mac (op is there): the password goes through the pipe only. In the remote
   # shell, read and printf are builtins, so it never appears in a process's argv.
   HP=$(doctl databases connection "$SRC" -o json | jq -r '"\(.host):\(.port)"')
   op read 'op://citrate-infra/ikrhodwwbkthwjxs4mmhljjk3u/password' | ssh rpc-1 "sudo -n HP=$HP sh -c '
     umask 077; read -r pw
     printf \"DATABASE_URL=postgresql://citratescan_verify:%s@%s/citratescan\nNEXT_PUBLIC_CITRATE_RPC_URL=http://127.0.0.1:8545\n\" \"\$pw\" \"\$HP\" > /etc/citratescan/verify-worker.env'"
   # back on rpc-1:
   sudo chown root:root /etc/citratescan/verify-worker.env; sudo chmod 0600 /etc/citratescan/verify-worker.env
   sudo install -m 0644 /opt/citratescan/verify/deploy/verify-worker/citratescan-verify-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   # smoke (one job at most), with the unit's own user, env, credential and solc cache:
   sudo systemd-run --unit=citratescan-verify-smoke --wait --pipe -p User=citratescan-verify \
     -p EnvironmentFile=/etc/citratescan/verify-worker.env -p LoadCredential=db-ca.pem:/etc/citratescan/db-ca.pem \
     -p CacheDirectory=citratescan-solc -p Environment=CITRATE_SOLC_CACHE_DIR=/var/cache/citratescan-solc \
     -p WorkingDirectory=/opt/citratescan/verify \
     /bin/sh -c 'DATABASE_CA_CERT="$(cat /run/credentials/citratescan-verify-smoke.service/db-ca.pem)" exec /usr/bin/node node_modules/tsx/dist/cli.mjs scripts/verify/worker.ts --once'
   # start the real unit once and check it before enabling it at boot
   sudo systemctl start citratescan-verify-worker.service
   sleep 10; systemctl is-active citratescan-verify-worker.service    # expect "active"
   sudo journalctl -u citratescan-verify-worker -n 30 --no-pager        # expect verify.* lines, no errors
   sudo systemctl enable citratescan-verify-worker.service
   ```

   A password with URL-special characters must be percent-encoded in `DATABASE_URL` (DO's
   generated passwords are alphanumeric). The unit's `ExecStart` is `/usr/bin/node` (v20.20.2 on rpc-1) on the checkout's
   `tsx`, so it needs no PATH, no pnpm and no home directory (`ProtectHome=true`). It reads the CA
   from `/run/credentials/citratescan-verify-worker.service/db-ca.pem`, where systemd places the
   `LoadCredential` file. (rpc-1 runs systemd 249, which does not resolve the `%d` specifier.) To update later:
   `git -C /opt/citratescan/verify checkout <commit>`, `pnpm install --frozen-lockfile` as
   `citratescan-verify`, then `systemctl restart citratescan-verify-worker`.

   **The indexer.** It runs from `/root/citrate-explorer` at `f5c1ba3`. Between `f5c1ba3` and this
   release nothing under `src/lib/indexer` or `scripts/indexer` changes, and migration 0006 adds
   nothing it reads. So it does **not** move for this release. Leave
   `citratescan-indexer` and `/opt/citratescan/lag-guard` untouched. Move the indexer to current
   `main` later, in its own window and by its own runbook, once a release changes indexer code
   (the r1007 indexer work). Never point the indexer and the worker at the same checkout.
7. **Re-verify legacy records (required).** Run once as the worker, through its unit's
   environment: the step 3.6 `systemd-run` command with `--requeue-legacy` in place of `--once`. It
   queues every legacy record that has standard JSON source for re-verification against the
   current chain, and marks the rest `not-standard-json`.
8. **Smoke.**
   - `forge verify-contract --verifier custom --verifier-url https://explorer.citrate.ai/api …`
     on a test contract ends in `Pass - Verified`.
   - `citrate contract verify <addr> --build-info … --watch`, then `citrate contract verify-get <addr>`.
   - `curl -s https://explorer.citrate.ai/api/contract/<addr>/verified | jq '.record | {matchType, runtimeMatch, legacy, verified}'`:
     a freshly verified contract shows `"full"`, `"full"`, `false`, `true`. A legacy record shows
     `null`, `null`, `true`, `false`.
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
  owns nothing and can read nothing. The last resort is a PITR fork at the step 3.1 time. It is a
  new cluster, so the app and indexer would have to be repointed to it, and it would lose
  indexer writes made after that time.

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

### Second dry run (2026-11-09, fork `citratescan-v2-dryrun2`, deleted)

Fork `8bac98bb-52ed-4606-940e-1a5279e84c9c` (`db-s-1vcpu-1gb`, nyc3) of 0006 at `88437dd`, the final
migration. The trusted source was added right after creation, and passwords stayed in a pgpass
file. `citratescan_verify` was created before migrating. Synthetic v1 rows, fork only: a full-match
row for a live contract (`0xaa918302…c906`), a standard-JSON row, one failed and one pending.

- **Migration:** the ledger ends at 0006; 4 legacy jobs and 2 legacy records; 4 triggers enabled.
  The grants match §2.6, including the web role's column INSERT on the eight request columns.
- **Web role:**
  - the real `enqueueJob` (node-postgres) succeeds, and the job is `pending` with 0 attempts;
  - INSERT naming `status` or `verified_contract_id`, UPDATE on jobs, TRUNCATE, and INSERT into
    records are all refused;
  - a real `POST /api` `verifysourcecode` through a local dev server enqueued a job.
- **Owner:** TRUNCATE, UPDATE and DELETE on records are refused by the triggers.
- **Worker role:**
  - INSERT on a record works; UPDATE/DELETE of records, TRUNCATE, UPDATE of `request`, DELETE of
    jobs and `DISABLE TRIGGER` are refused;
  - `--requeue-legacy` queued 1;
  - `--once` claimed, released and retried jobs and wrote state. The requeued job finished as
    `no_code`; a deliberately malformed probe job ended `gave_up` after 3 attempts.
- **Copy-forward re-run:** 0 and 0 rows.
- **Legacy doors**, on the local dev server as `citratescan_web` against the fork, for the
  live-contract legacy row:
  - `getsourcecode` returns the empty not-verified entry;
  - `getabi` returns "Contract source code not verified";
  - `checkverifystatus` and `/api/verify/{guid}` on the old guid: fail, not confirmed;
  - Sourcify `/v2/contract`: 404; `/v2/verify/{id}`: completed, no match, `legacy_unconfirmed`.
  - `/api/contract/{a}/verified` still carried `matchType: "full"` in the record. That is fixed
    after this run (`legacy: true`, `verified: false`, null match types). The fix touches no
    migration.
