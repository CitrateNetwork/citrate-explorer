# CitrateScan — `citrate-explorer`

**An AI-native BlockDAG explorer for the [Citrate Network](https://citrate.ai).**
A better, more agentic Etherscan: every page leads with a plain-English summary,
a built-in agent answers natural-language questions with read-only chain
tool-calls, and the whole thing is programmable through an Etherscan-compatible
API and an MCP server.

> Foundation infrastructure — open, self-hostable, and upgraded over time.

## Why

Citrate is a **GHOSTDAG BlockDAG** (chain `40204`, native **SALT**). Incumbent
explorers are linear-chain, closed, and "everything is a hash." CitrateScan is
built DAG-native (multiple tips, blue_score ordering, finality-by-depth) and
AI-native (explain-this-tx, natural-language query, on-demand indexing).

## Architecture (three runtimes)

| Runtime | What | Where |
|---|---|---|
| **Indexer worker** | WS `newHeads` → backfill → Neon Postgres | always-on Node (`pnpm indexer`); not Vercel |
| **Vercel app** | UI + read API + AI chat + verify + MCP | Next.js 16 on Vercel |
| **Verify sandbox** | multi-version `solc` recompile-and-diff | Vercel Sandbox microVM (S-4) |

Stack: Next.js 16 · React 19 · viem/wagmi · Privy · Vercel AI SDK v6 · Drizzle +
Neon · Tailwind 4 · Foundry. See `CLAUDE.md` and `.agentile/CONFIG.md`.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill chain RPC vars (others optional)
pnpm dev                          # http://localhost:3000
pnpm test:live                    # prove the harness reads live Citrate (chain 40204)
```

The app builds and runs with most env vars unset — it reads through to live RPC
and skips persistence until `DATABASE_URL` is provisioned.

## Documents

| Doc | For |
|---|---|
| [`.agentile/planset/2026-06-02-citrate-explorer-v1/PLANSET.md`](.agentile/planset/2026-06-02-citrate-explorer-v1/PLANSET.md) | the build plan (S-1..S-6) |
| [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) | the design team's functional contract |
| [`DESIGN_HARNESS_AND_SETTINGS.md`](DESIGN_HARNESS_AND_SETTINGS.md) | read-only harness + settings |
| [`EXPLORER_SPEC.md`](EXPLORER_SPEC.md) | feature checklist + DAG-native deltas + API matrix |
| [`SYSTEM_PROMPTS.md`](SYSTEM_PROMPTS.md) | the AI agent's layered system prompt |
| [`AGENTS.md`](AGENTS.md) | live status + hard-won Citrate facts |

## Status

S-0 (bootstrap) complete. S-1 (indexer + AI foundation) is next — see
`.agentile/sprints/CURRENT.md`.

## License

Apache-2.0. © Citrate Foundation.
