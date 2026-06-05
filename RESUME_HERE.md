# RESUME_HERE — CitrateScan (citrate-explorer)

> **Read this first when resuming work on `citrate-explorer` in a fresh context.**
> Written 2026-06-05 at the end of a long build session, right before a context clear.
> It tells you what this is, what's live, what's parked, and **what to push to prod.**

---

## TL;DR — what to do when you start up

1. **Confirm prod is current.** `main` auto-deploys to Vercel
   (`saulbuilds-projects/citrate-explorer`, live at
   https://citrate-explorer.vercel.app). If `main` has unpushed/undeployed
   commits, push them and let Vercel build. There is **no separate deploy step** —
   merge to `main` = deploy. (`vercel ls --prod` to confirm the latest is Ready.)
2. **Do NOT merge the auth PR (#33) yet** — it is gated on `auth.citrate.ai`
   being live in prod. See "Parked work" below. Prod is safely on **mock** auth
   right now (`NEXT_PUBLIC_AUTH_MODE` is unset in Vercel → defaults to mock).
3. **Everything else I built this session is already merged + deployed.** The
   agent, explorer, verification, conversations, branding, beacon are all in prod.
4. Ask the user what they want next before starting tangential work.

---

## What CitrateScan is

An **AI-native BlockDAG explorer** ("better, agentic Etherscan") for the **Citrate
Network** — a GHOSTDAG BlockDAG L1: **chainId 40204**, native token **SALT**
(18 decimals; wei = "grains"), EVM-compatible "LVM", finalityDepth 100, EIP-2771
gasless forwarder. RPC: `https://rpc.citrate.ai` (occasionally flaps with Caddy
502s — there's a stale-on-error cache to ride it out).

**Stack:** Next.js 16 App Router · React 19 · TS · viem 2 / wagmi 3 · AI SDK v6
(`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) · Drizzle + Neon serverless ·
vitest 4 · Foundry (solc 0.8.26, cancun) · jose (OIDC). Built on the **Agentile**
methodology (Rule 11 no-mocks/honest data; Rule 12 frontmatter; test-count ratchet
in `.agentile/coverage/baseline.json`).

**Infra:**
- **Vercel:** project `prj_4O4llikn8ymHNp6Ix3sYx94MrTcs` (`saulbuilds-projects/citrate-explorer`).
- **Neon:** project `steep-river-28184690`, db `neondb`, role `neondb_owner` (`citratescan`).
- **Inference:** the agent calls `https://infer.citrate.ai/v1` (the user's own gateway).
  `CITRATE_GATEWAY_API_KEY` is set in Vercel prod (gateway returns 401 without it).
- **Beacon:** `CitratePulse` at `0x9c717b4a18e5aba2dac42fd2601e6eb241b44ad3`,
  keeper `0xacA9CB582b800aeDf1992506C5758539a422ed6b`. A local keeper script was
  running this session (ephemeral, on this machine) pulsing every block; devops is
  standing up the permanent version on a DigitalOcean droplet (handoff in
  citrate-labs — see below). Don't rely on the local one persisting past the clear.

---

## What's DONE and in prod (do not rebuild)

- **Core explorer:** blocks / tx / address / contract / token pages over the
  indexer with live-RPC fallback when the index lags.
- **AI agent harness** (the differentiator): real chain tools — `getBlock`,
  `getTransaction` (with labels/type/fee/logs/methodId), `getContractCode`,
  `getToken` (ERC-20/721 detect), `getGasOracle`, `callView` (read any view fn by
  signature), `saltDistribution` (answers "who holds the most SALT" via genesis
  holders + live balances — SALT is **native**, not ERC-20), `addressActivityLive`
  (forensic recent-block scan), plus a running-cost `ledger`. Mirrored in the
  **MCP server** (`src/app/api/mcp/route.ts`, ~18 tools). The system prompt
  (`src/lib/ai/system-prompt.ts`) lists ONLY real tools — do not re-add phantom ones.
- **WS-4 conversation persistence:** per-user, encrypted, ownership-scoped threads
  (`src/lib/db/conversations.ts`, `/api/threads`); sidebar in `src/scan/screens/agent.tsx`.
- **WS-3 forensic tx/log analysis:** `src/lib/ai/synthesis/explainTransaction.ts`
  (decodeLog, ERC-721 vs ERC-20, labels, fee).
- **WS-2b contract verification:** real recompile-and-diff with solc-js
  (`src/lib/verify/*` — stripMetadata, maskImmutables, full/partial/none match;
  `loadRemoteVersion`), persisted; `/api/verify`, `src/scan/screens/verify.tsx`.
  ⚠️ **Hardening TODO:** compiles run in-process (2 MB source bound + 300s timeout).
  Move to a **Vercel Sandbox** microVM before heavy public use (`VERCEL_SANDBOX_TOKEN`
  placeholder already in `.env.example`).
- **Branding/SEO:** self-hosted next/font (Space Grotesk title; Geist + Geist Mono;
  Cormorant supporting), favicon/OG/manifest, broad SEO metadata. Mobile layout +
  cookie-consent modal fixed (SSR-safe consent, `.agent:not(.collapsed)` overlay).
- **Resilience:** `src/lib/api/cache.ts` stale-on-error cache on `/api/dag`,
  `/api/latest`, `/api/blocks`; `/api/blocks` falls back to live RPC when the
  indexer lags past `CITRATE_INDEXER_MAX_LAG`.

---

## PARKED work — read carefully before touching

### 🔒 PR #33 — OIDC auth wiring (`auth-oidc-spec-wiring`) — **DO NOT MERGE YET**
- **Why parked:** the user's explicit instruction — `auth.citrate.ai` is **not in
  prod yet**. Merging + flipping env before the authority is live = broken login.
- **What it is:** wires the explorer as a generic OIDC relying party to spec
  (discovery-driven endpoints, CSRF `state`, access_token storage, POST `/logout`,
  and an SSE logout-cascade on `/sessions/events`). Verified against a locally-run
  citrate-identity authority.
- ⚠️ **Gotcha that lives on `main` right now:** the engineer's base seam already
  merged to `main` has a bug — it hardcodes the authorization endpoint as
  `/authorize`, but the panva authority uses **`/auth`**. `.env.example` on main
  also still says `/authorize` + `NEXT_PUBLIC_AUTH_MODE=oidc` + localhost issuer.
  **PR #33 fixes all of this via discovery.** So you MUST merge #33 *before* any
  prod auth cutover, or login breaks.
- **Go-live checklist (only when `auth.citrate.ai` is confirmed live in prod):**
  1. Merge PR #33.
  2. Set Vercel **prod** env: `NEXT_PUBLIC_AUTH_MODE=oidc`,
     `NEXT_PUBLIC_OIDC_ISSUER=https://auth.citrate.ai`,
     `OIDC_ISSUER=https://auth.citrate.ai`,
     `OIDC_JWKS_URL=https://auth.citrate.ai/jwks`,
     `OIDC_AUDIENCE=citrate-explorer`. **Leave AUTHORIZE/TOKEN URLs unset** → discovery.
  3. Confirm the authority registered `https://explorer.citrate.ai/auth/callback`
     for the `citrate-explorer` client.
  4. Redeploy; smoke the full SIWE → token → logout-cascade flow on prod.

### PR #23 — `feat/indexer-parallel-batch` (INDEXER_PARALLEL fast-catchup)
- Open, separate feature (faster backfill). Not gated like auth — review/merge on
  its own merits when ready. Not required for prod to function.

---

## Active devops handoffs (in the `citrate-labs` repo, `handoffs/` folder)

These are tasks for OTHER agents/operators, already written and pushed to
`citrate-labs` main. You don't need to do them — just know they exist:
- `handoffs/INDEXER_DROPLET_HANDOFF.md` — stand up the indexer + permanent beacon
  on a DigitalOcean droplet. (doctl/SSH is intentionally kept OFF this machine.)
- `handoffs/GATEWAY_APIKEY_HANDOFF.md` — **DONE/LIVE** as of 2026-06-04: the
  `infer.citrate.ai` gateway is now API-key-gated (401 without key). Remaining
  operator step there was pasting the two `cgk_` keys into Vercel (explorer's is set).
- Plus the TLS / llama-server / Gemma-seed / release-ceremony / RPC-DAG-fields docs.
- Gateway code/planset lives in `citrate-inference-gateway` (PR #4, deployed).

---

## How to verify prod health quickly
```bash
cd citrate-explorer
git log --oneline -1                 # what's on main
gh pr list --state open              # #33 (parked), #23 (indexer batch)
vercel ls --prod | grep -m1 Ready    # latest prod deploy
# Smoke the agent in prod: open the site, ask "who holds the most SALT" — it should
# call saltDistribution and answer with real genesis + live balances.
```

## Working agreements with this user (carry forward)
- The user is the **Citrate architect** — go deep/technical, no hand-holding.
- **Rule 11 (Agentile):** no mocks, honest data only. If something's not real, say so.
- **Don't make auth architectural decisions** without digesting the citrate-identity
  engineer's `AUTH_HANDOFF.md` first (already done this session; re-read if unsure).
- Confirm before outward-facing/irreversible actions; merging the gated auth PR is
  exactly the kind of thing to NOT do without the go-live gate being met.
