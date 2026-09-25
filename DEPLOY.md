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

Resume is gap-free (the `indexer_state` cursor), so restarts are safe. Smoke a
single pass first: `INDEXER_ONCE=1 pnpm indexer` (ingests the latest block + exits).

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
