# CitrateScan — Deployment runbook (P-9)

The production target: **`explorer.citrate.ai`** on Vercel (web app + read API +
AI agent + MCP), backed by **Neon** (index), an **always-on indexer worker**, and
the live **Citrate RPC**. The app builds and runs with most env unset (graceful
degradation), so you can deploy incrementally and turn surfaces on as their
backends come online.

This is a runbook you execute — it needs authenticated CLIs (`vercel`, `neonctl`,
your DNS provider). Each step says exactly what to run.

---

## 0. Architecture recap (what runs where)

| Runtime | Where | What |
|---|---|---|
| Web app | **Vercel** (Fluid Compute) | UI, `/api/*` reads, AI chat, MCP, verify orchestration |
| Index DB | **Neon** Postgres | blocks/txns/logs/dag_edges + user tables |
| Indexer worker | **Railway / Fly / VM** (NOT Vercel) | tails `wss://rpc.citrate.ai` → Neon (`Dockerfile.indexer`) |
| Rate-limit store | **Upstash Redis** (optional) | cross-instance limiter; falls back to in-memory |
| Chain | `rpc.citrate.ai` | live reads + the DAG stream source |

---

## 1. Environment matrix

`NEXT_PUBLIC_*` are **build-time + public** (shipped to the browser). Everything
else is **server-only** — set as encrypted env in Vercel + the indexer host, never
committed. Full list + how-to-generate in `.env.example`.

| Var | Scope | Prod value / note |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | `https://explorer.citrate.ai`. Also an allowed `Origin` for cookie-auth mutations (PBA-L3c-017/018 same-origin guard): if the app is served under an alias host (e.g. `citratescan.ai`), either 308-redirect the alias to this canonical host or set this var to the host users actually browse, or sign-in and settings writes from the alias will 403. |
| `NEXT_PUBLIC_DEMO` | public | **`0`** — drop the sample fallback; live data only |
| `NEXT_PUBLIC_CITRATE_CHAIN_ID` | public | `40204` |
| `NEXT_PUBLIC_CITRATE_RPC_URL` | public | `https://rpc.citrate.ai` |
| `NEXT_PUBLIC_CITRATE_WS_URL` | public | `wss://rpc.citrate.ai` |
| `NEXT_PUBLIC_FORWARDER_ADDRESS` | public | EIP-2771 forwarder (after P-4 deploy) |
| `CITRATE_RPC_FALLBACK` | server | optional direct-node URL (prefer TLS); unset = primary only |
| `DATABASE_URL` | server (Vercel **+** indexer) | Neon pooled connection string |
| `APP_MASTER_KEY` | server | `openssl rand -base64 32` — at-rest envelope key |
| `API_KEY_PEPPER` | server | `openssl rand -base64 32` — API-key hash pepper |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | server | cross-instance rate limiter (optional) |
| `OIDC_ISSUER` / `OIDC_JWKS_URL` | server | set when `auth.citrate.ai` ships; until then mock seam |
| `NEXT_PUBLIC_OIDC_*` | public | issuer/authorize/token URLs when OIDC is live |
| `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` | public / server | only if using the Privy adapter |
| `CITRATE_INFERENCE_MODE` | server | `gateway` (or `local`) |
| `CITRATE_GATEWAY_URL` / `_API_KEY` | server | `https://infer.citrate.ai/v1` + key |
| `CITRATE_INDEXER_MAX_LAG` | server | health "lagging" threshold (default 50 blocks) |
| `INDEXER_PARALLEL` | indexer | heights ingested concurrently while catching up (default 1, max 32) |
| `INDEXER_RETRY_BASE_MS` / `INDEXER_RETRY_MAX_MS` | indexer | backoff for a failed height (default 1000 doubling to 60000). A failed height is retried until it lands; the resume cursor stays below it |
| `INDEXER_RPC_BATCH` | indexer | receipts per JSON-RPC batch POST (default 50, clamped to the node's 100-call limit; 1 = no batching) |
| `CITRATE_DAGSTATS_TTL_MS` | server | how long one instance-wide `citrate_getDagStats` snapshot is shared by SSE streams, `/api/dag`, block/tx routes and harness tools (default 3000) |
| `INDEXER_GENESIS_CHECK_MS` | indexer | how often the running indexer re-checks the RPC's block 0 (default 60000, min 5000). See §4a |

> The CSP allowlist in `next.config.ts` derives `connect-src`/`frame-src` from the
> `NEXT_PUBLIC_*` RPC/OIDC/Privy vars at build time — set them before the prod
> build so the browser can reach the configured backends.

---

## 2. Provision the index (Neon)

```bash
# Create the database (or use the Vercel ↔ Neon native integration).
neonctl projects create --name citratescan
# Put the POOLED connection string in DATABASE_URL, then run migrations:
echo 'DATABASE_URL=postgres://…' >> .env.local
pnpm db:migrate
```

Migrations are idempotent. Without `DATABASE_URL` every read degrades to live RPC
(single-entity reads still work; history/aggregate return honest "not provisioned").

---

### 2a. API-key storage upgrade (migration 0004, 2026-09)

Issued API keys are now stored with scrypt salted by `API_KEY_PEPPER`, and each row records its
`key_scheme`. Migration `0004_api_key_scheme` adds the column (existing rows become `legacy`) and
retires every legacy key.

- **Order.** Run `pnpm db:migrate` **before** promoting the new build. If the migration runs first,
  keys minted by the old build in between are stored as `legacy`: they never match and do not count
  toward the 5-key cap. If the new build is promoted first, keyed requests and key minting fail
  until the migration runs.
- **Users must re-mint.** Every key issued before this release stops working. `/api/v1` answers
  "Invalid API Key. Keys issued before the 2026-09 key-storage upgrade were retired: mint a new one in
  Settings -> API keys." Settings lists the old keys as revoked. Announce the re-mint before deploy
  (changelog / email to key holders).
- `API_KEY_PEPPER` must stay stable; rotating it retires every key the same way.

## 3. Deploy the web app (Vercel)

```bash
vercel link                     # link this repo to the Vercel project
# Set env (repeat per var; --sensitive for server-only). Examples:
vercel env add NEXT_PUBLIC_DEMO production            # enter: 0
vercel env add NEXT_PUBLIC_SITE_URL production        # https://explorer.citrate.ai
vercel env add DATABASE_URL production --sensitive
vercel env add APP_MASTER_KEY production --sensitive
vercel env add API_KEY_PEPPER production --sensitive
# …the rest of the matrix above…

vercel --prod                   # build + deploy production
```

`vercel.json` pins `framework: nextjs`, region `iad1`, and the 300s `maxDuration`
for `/api/chat` + `/api/dag/stream` (the streaming routes). Security headers + CSP
come from `next.config.ts` (verify with step 6).

### Domain
```bash
vercel domains add explorer.citrate.ai
# Add the CNAME/A record Vercel prints at your DNS provider, then:
vercel domains inspect explorer.citrate.ai     # wait for verified + TLS issued
```

---

## 4. Deploy the indexer worker (always-on)

The worker keeps a websocket open and runs unbounded — it cannot live on Vercel.

```bash
docker build -f Dockerfile.indexer -t citratescan-indexer .
# Railway/Fly/Render/VM — set DATABASE_URL + NEXT_PUBLIC_CITRATE_RPC_URL/_WS_URL,
# restart policy = always. Example (Fly):
fly launch --dockerfile Dockerfile.indexer --no-deploy
fly secrets set DATABASE_URL=… NEXT_PUBLIC_CITRATE_RPC_URL=https://rpc.citrate.ai NEXT_PUBLIC_CITRATE_WS_URL=wss://rpc.citrate.ai
fly deploy
```

Resume is gap-free: the `indexer_state` cursor is the highest height below which every height
landed, each block is written in one transaction, and a failed height is retried with backoff
instead of skipped (look for `block N failed (attempt k, retry in … ms)` in the log). Restarts are
safe. Smoke a
single pass first: `INDEXER_ONCE=1 pnpm indexer` (ingests the latest block + exits).

### 4a. Genesis guard and reset

Chain id 40204 survives a reroll, so the index is tied to block 0's hash instead.

- **The guard.** `indexer_state.genesis_hash` (migration `0005_indexer_genesis_hash`) records the
  chain's block 0 hash. Before writing, and every `INDEXER_GENESIS_CHECK_MS` (default 60 s) while it
  runs, the indexer compares it with the RPC's block 0.
  - **First run on an empty index:** it records the RPC's genesis.
  - **First run on an index built before the guard:** it records the genesis only if the lowest live
    indexed block is on the RPC's chain; otherwise it refuses with `index_not_this_chain`.
  - **Mismatch:** it logs `GENESIS REFUSED (genesis_mismatch): RPC block 0 is …, index genesis is …`,
    writes nothing and exits with code **3**. Add `RestartPreventExitStatus=3` to the systemd unit so
    a refusal is not restarted in a loop.
  - RPC or database errors at start are retried with backoff (1 s doubling to 30 s); they never let
    the indexer write unchecked.
- **The indexer lock.** The indexer holds a Postgres advisory lock for its whole life. A second
  indexer on the same database exits at start, and the reset below refuses while the lock is held.
- **Order.** Run `pnpm db:migrate` before deploying a build with the guard.

**Reset after a deliberate reroll.** Only when the chain was rerolled on purpose and the old index
should be discarded:

```bash
sudo systemctl stop citratescan-indexer.service      # the reset refuses while the indexer runs
G=$(curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x0",false]}' \
  "$NEXT_PUBLIC_CITRATE_RPC_URL" | jq -r .result.hash)
pnpm indexer:reset --genesis "$G"            # dry run: prints row counts, deletes nothing
pnpm indexer:reset --genesis "$G" --confirm  # empties the chain tables, records $G
sudo systemctl start citratescan-indexer.service     # backfills from height 0
```

- **What it empties,** in one transaction (all or nothing): `blocks`, `dag_edges`, `transactions`,
  `receipts`, `logs`, `token_transfers`, `tokens`, `accounts`, `contracts`, `indexer_state`. It then
  seeds `indexer_state` with cursor 0 and the new genesis.
- **What it keeps:** user tables (settings, API keys, provider keys, watchlist, threads, messages,
  audit log) and `contract_verifications`.
- **Checks:** it refuses (exit 4, nothing deleted) when the RPC's block 0 is not `--genesis`, or when
  the RPC cannot be read. For a reset made before the RPC flips, pass `--skip-rpc-check`.
- **Exit codes:** 0 done or dry run; 2 bad arguments or `DATABASE_URL` unset; 4 refused.
- **Before you run it,** take a database backup (DO Managed Postgres: a manual backup or a fork).
  The reset cannot be undone.

---

## 5. Rate-limit store (optional, recommended)

```bash
# Upstash Redis (REST). Without it the limiter falls back to per-instance memory.
vercel env add UPSTASH_REDIS_REST_URL production --sensitive
vercel env add UPSTASH_REDIS_REST_TOKEN production --sensitive
```

`/api/health` reports which backend is active (`limiter.backend: redis|memory`).

---

## 6. Monitoring

Point an uptime monitor (Better Uptime / Pingdom / Vercel) at:

- **`GET /api/health`** — `200` = chain reachable; `503` = down. Alert on:
  - `status != "ok"`,
  - `components.indexer.status == "lagging"` (lag > `CITRATE_INDEXER_MAX_LAG`),
  - `components.chain.status != "ok"`.

Structured logs (`src/lib/api/log.ts`) emit one JSON object per line for the log
drain. Wire Sentry at the app boundary when a DSN is available (deferred from P-8).

---

## 7. Go-live checklist (WP-9.3)

- [ ] All env from the matrix set in Vercel (prod) **and** the indexer host; secrets generated fresh, not reused from dev.
- [ ] `NEXT_PUBLIC_DEMO=0` in production.
- [ ] `pnpm db:migrate` applied; `/api/health` shows `indexer` provisioned + lag within threshold.
- [ ] `explorer.citrate.ai` resolves with valid TLS; `vercel --prod` green.
- [ ] Security headers verified: `curl -sI https://explorer.citrate.ai | grep -i 'content-security-policy\|strict-transport'`.
- [ ] `robots.txt` + `sitemap.xml` + `/opengraph-image` serve; canonical URL correct.
- [ ] Consent banner appears for EU regions; `/privacy` `/terms` `/cookies` reachable.
- [ ] Smoke the full flow on prod: omni-search → entity, **live DAG streams**, ask-the-agent answers, an API key works against `/api/v1`, an MCP client lists + calls tools.
- [ ] Gasless write path: deploy `CitrateForwarder` (HANDOFF-P4) + set `NEXT_PUBLIC_FORWARDER_ADDRESS` + fund the relayer, then test one sponsored write.

**Done = production:** `explorer.citrate.ai` serves live data, the agent answers,
consent + legal are live, and monitoring is green.

---

## Deferred / fast-follow (tracked, not blockers)
- Hash-route → App Router per-entity SSR (shareable `/block/…` `/tx/…` `/address/…` URLs).
- Sentry APM at the app boundary.
- axe/Lighthouse CI gate.
- Gasless writes go live once the forwarder is deployed + the relayer funded (P-4 handoff).
