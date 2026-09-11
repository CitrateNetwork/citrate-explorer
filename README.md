# citrate-explorer

*Part of the **[Citrate Network](https://citrate.ai)** — own the means of computation. · [Docs](https://docs.citrate.ai) · [Run a node](https://citrate.ai/download) · [Contribute → free membership](https://github.com/CitrateNetwork/.github/blob/main/CONTRIBUTING.md)*

> CitrateScan — an AI-native BlockDAG explorer for the Citrate Network (chain 40204): browse the GhostDAG, chat with an on-chain agent, and verify contracts.

## What it is

`citrate-explorer` (brand: **CitrateScan**) is a Next.js app plus an always-on
indexer that turns the Citrate GhostDAG BlockDAG into a browsable, agentic explorer —
"a better, agentic Etherscan." It reads live chain data over JSON-RPC, optionally
indexes it into Postgres for fast queries, exposes an AI chat/agent surface over an
OpenAI-compatible inference endpoint, and authenticates users via the Citrate
identity authority (OIDC + SIWE).

See the concept docs at https://docs.citrate.ai/explorer. It is a relying party of
[citrate-identity](https://github.com/CitrateNetwork/citrate-identity) and reads
from a [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) node.

## Prerequisites

```bash
# Node 20+, pnpm, and (only for the Solidity verify tooling) Foundry.
node --version               # >= 20
corepack enable && corepack prepare pnpm@latest --activate   # provides pnpm
pnpm --version
# Optional — contracts:* scripts only:
curl -L https://foundry.paradigm.xyz | bash && foundryup       # forge
```

- OS: Linux or macOS.
- The app + indexer build and run with most env vars unset (graceful
  degradation) — only a chain RPC URL is needed to read live data.

## Build from source

```bash
git clone https://github.com/CitrateNetwork/citrate-explorer.git
cd citrate-explorer
pnpm install
pnpm build                  # next build  →  .next/
```

Expected artifact: the Next.js production build in `.next/`. Useful checks:

```bash
pnpm typecheck              # tsc --noEmit
pnpm lint                   # eslint
pnpm test                   # vitest (unit)
pnpm test:live              # LIVE_RPC=1 vitest — hits a live chain RPC
pnpm contracts:test         # forge test (needs Foundry)
```

## Run locally

```bash
cp .env.example .env.local  # dev-ready defaults; NEXT_PUBLIC_DEMO=1 keeps sample data as fallback
pnpm install
pnpm dev -p 3001            # next dev on :3001 (leave :3000 free for citrate-identity)
```

Default port: **3001** in the local stack (Next.js defaults to `:3000`, but the
identity authority owns `:3000` and the explorer is registered as an RP at
`http://localhost:3001/auth/callback`, so run it on `:3001`). Verify it's up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/    # → 200
```

Open http://localhost:3001 — with `NEXT_PUBLIC_DEMO=1` and no indexer you get the
rich sample DAG; point it at a real RPC (below) to see live chain data.

The **indexer** is a separate always-on Node worker (it holds a WS socket, so it
does not run on Vercel). Run it only when you want persisted/indexed data:

```bash
pnpm db:migrate            # needs DATABASE_URL (Neon/Postgres)
pnpm indexer               # WS newHeads → backfill → Postgres  (scripts/indexer/run.ts)
pnpm indexer:once          # single backfill pass then exit
```

## Connect it locally  ← the differentiator

The explorer's upstreams are a **chain node**, the **identity authority**, and an
**inference endpoint**. Point at them in `.env.local`:

1. **Chain RPC (required for live data).** Run a local
   [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) devnet node
   (chain 40204) or use the public endpoint:
   ```bash
   NEXT_PUBLIC_CITRATE_CHAIN_ID=40204
   NEXT_PUBLIC_CITRATE_RPC_URL=https://rpc.citrate.ai      # or http://127.0.0.1:<node-rpc-port>
   NEXT_PUBLIC_CITRATE_WS_URL=wss://rpc.citrate.ai         # or ws://127.0.0.1:<node-ws-port>
   NEXT_PUBLIC_DEMO=0                                       # show ONLY live chain data
   ```
2. **Identity (OIDC login).** Run [citrate-identity](https://github.com/CitrateNetwork/citrate-identity)
   on `:3000`, then:
   ```bash
   NEXT_PUBLIC_AUTH_MODE=oidc
   NEXT_PUBLIC_OIDC_ISSUER=http://localhost:3000
   NEXT_PUBLIC_OIDC_CLIENT_ID=citrate-explorer
   OIDC_ISSUER=http://localhost:3000
   OIDC_JWKS_URL=http://localhost:3000/jwks
   OIDC_AUDIENCE=citrate-explorer
   ```
   (Use `NEXT_PUBLIC_AUTH_MODE=mock` to skip the authority entirely in dev.)
3. **Inference (AI chat/agent).** Point at the Citrate gateway or a local
   OpenAI-compatible server:
   ```bash
   CITRATE_INFERENCE_MODE=gateway
   CITRATE_GATEWAY_URL=https://infer.citrate.ai/v1        # or CITRATE_INFERENCE_MODE=local + CITRATE_INFERENCE_URL=http://127.0.0.1:8080/v1
   ```
4. **Persistence (optional).** Set `DATABASE_URL` to a Postgres/Neon URL, run
   `pnpm db:migrate`, then `pnpm indexer` to populate it. Without it the app reads
   through to RPC on every request.

Minimal end-to-end check: with a real RPC set and `NEXT_PUBLIC_DEMO=0`, load
http://localhost:3001 and confirm the latest blocks/blue-score match the node. For
the full chain → identity → apps bring-up see https://docs.citrate.ai/local-stack.

## Configuration

| Var | Default | Purpose |
|-----|---------|---------|
| `NEXT_PUBLIC_CITRATE_CHAIN_ID` | `40204` | Citrate chain id. |
| `NEXT_PUBLIC_CITRATE_RPC_URL` | `https://rpc.citrate.ai` | Primary JSON-RPC endpoint. |
| `NEXT_PUBLIC_CITRATE_WS_URL` | `wss://rpc.citrate.ai` | WebSocket endpoint (newHeads). |
| `NEXT_PUBLIC_DEMO` | `1` | `1` keeps sample data as fallback; `0` = live-only (prod posture). |
| `NEXT_PUBLIC_AUTH_MODE` | `oidc` | `mock` \| `oidc` \| `privy` auth seam. |
| `DATABASE_URL` | unset | Postgres/Neon for the indexer; unset = read-through to RPC. |
| `INDEXER_POLL_MS` / `INDEXER_START_BLOCK` / `INDEXER_FINALITY_DEPTH` | `2000` / `0` / `100` | Indexer cadence, backfill start, finality depth. |
| `CITRATE_GATEWAY_URL` | `https://infer.citrate.ai/v1` | OpenAI-compatible inference endpoint. |

Full annotations (encryption keys, rate-limiter, relayer, verify sandbox) live in
`.env.example`.

## Links

- Docs: https://docs.citrate.ai/explorer
- Depends on: [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) · [citrate-identity](https://github.com/CitrateNetwork/citrate-identity)
- Consumed by: developers and agents browsing chain 40204 (public front-end)
- Contributing (DCO): CONTRIBUTING.md · Security: SECURITY.md · License: LICENSE

## License

Apache-2.0.
