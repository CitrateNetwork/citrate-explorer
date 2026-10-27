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
    (`index_not_this_chain`).

  On the first run against an empty database it records the genesis. On an existing r1005 index
  it records the genesis only if the index's lowest live block matches what the RPC serves at
  that height.
- **`/api/health`.**
  - `components.chain.status = wrong_genesis` (HTTP 503) means the RPC serves a different
    network than this build.
  - `components.indexer.status = genesis_refused` or `genesis_mismatch` means the index and the
    RPC disagree (overall status is `degraded`).
  - `components.chain.genesis`, `.expectedGenesis` and `.network` show the values that were
    compared.

## 0. Before cutover (any time after this PR merges)

1. **Run migration 0005 on the r1005 database first, then deploy.** Run `pnpm db:migrate` on DGX
   against the current production `DATABASE_URL`. Do this before any build that contains the
   guard reaches the indexer host. Without the new `indexer_state.genesis_*` columns, the guard
   can't read its state and the indexer stops writing (fail closed). After the migration, the
   r1005 indexer records `0x1dcf…75f1` on its next start.
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
user tables (`settings`, `api_keys`, `provider_keys`, `watchlist`, `audit_log`, `threads`,
`messages`, `thread_memory`, ...). The goal is a new database with the user tables and an empty
chain index, with the r1005 database left untouched as the archive.

**Option A: DO Managed Postgres (current production).**

```bash
# On DGX. CLUSTER = the explorer's DO database cluster id.
doctl databases db create "$CLUSTER" citratescan_r1006
R1005_URL='<current DATABASE_URL>'          # stays as the archive; nothing writes to it after step 2
R1006_URL='<same cluster, database citratescan_r1006>'
DATABASE_URL="$R1006_URL" pnpm db:migrate   # every migration, including 0005, on the empty DB

# Copy the user tables only (no chain-index tables).
# DATABASE_CA_CERT is the same cluster CA.
pg_dump --data-only \
  -t settings -t api_keys -t provider_keys -t watchlist -t audit_log \
  -t threads -t messages -t thread_memory \
  "$R1005_URL" | psql "$R1006_URL"
```

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

Either way, `indexer_state` in the r1006 database is empty, so the first indexer start records
r1006's genesis. If you skip the truncate in option B, the guard refuses
(`genesis_mismatch`/`index_not_this_chain`) and nothing mixes. Truncate, then restart.

`contract_verifications` is chain-specific (r1005 addresses), so it starts empty on r1006.

## 2. Cutover sequence

Run these in order, on DGX, after the owner's go.

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
4. **Web env** (Vercel production), then rebuild. `NEXT_PUBLIC_*` values are baked in at build
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

The r1005 database is untouched, so rollback is env only.

1. If the RPC goes back to r1005: on the indexer host set `NEXT_PUBLIC_CITRATE_NETWORK=r1005`
   and `DATABASE_URL=$R1005_URL`, then restart. The guard checks r1005's recorded genesis and
   resumes from the r1005 cursor.
2. Vercel: set the same two values, restore the r1005 env overrides you unset in step 2.4
   (if any were set before), then rebuild and redeploy.
3. Verify with §3, expecting `0x1dcfc490…75f1`, `network "r1005"`, and no `GuardianCanceller`
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
| `unavailable` (log only) | The RPC returned no block 0 or errored | Transient. The indexer retries each tick and writes nothing until the check passes |

A refusal latches until the indexer restarts, and it is re-logged once a minute.
