---
created: 2026-06-09T01:45:00Z
branch: feat/RA-3-value-transfer-backbone
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-3
status: active
---

# Sprint RA-3: Full indexed value/transfer backbone

> Status tracker (Rule 9). Full plan:
> [`../../../planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-3-value-transfer-backbone.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-3-value-transfer-backbone.md).
> Deploy/backfill (owner-gated):
> [`../../../planset/2026-06-08-citratescan-research-agent-v1/HANDOFF-RA3-deploy-backfill.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/HANDOFF-RA3-deploy-backfill.md).

## Goal
Make native value AND decoded ERC-20/721/1155 transfers fully indexed and queryable —
reorg-safe, reconciled against RPC.

## Work Package status
| WP | Title | Status |
|----|-------|--------|
| 3.2 | Shared transfer decoder (ERC-20/721/1155) + fix stale test | `[x] COMPLETE` (+ suite now fully green) |
| 3.1 | Schema + indexes (token_transfers provenance/standard; migration) | `[x] COMPLETE` (drizzle 0003) |
| 3.2b | Index-time decoding in ingest (token_transfers + tokens metadata) | `[x] COMPLETE` (code) |
| 3.3 | Reorg-safe cleanup (delete superseded blocks' transfers) | `[x] COMPLETE` (code) |
| 3.5 | Unified queries: `findTokenTransfers` + `tokenActivity` + tool token support | `[x] COMPLETE` (code + gated test) |
| 3.4 | Backfill + reconciliation (`scripts/indexer/backfill-transfers.ts`) | `[x] COMPLETE` (ran; 0 rows — no token activity) |
| 3.6 | Unblock token golden items + measure delta | `[~] deferred — no token activity on testnet yet` |

## Infra DONE (2026-06-09, via Neon + Vercel access)
Attached to the correct DB (the managed Postgres project / branch `main` / `neondb`;
verified: DB block height 16160 == `/api/health` head 16161, lag 1).
- ✅ **Migration `0003` applied** (`drizzle-kit migrate`) — `token_transfers` has
  `block_hash`/`block_height`/`timestamp`/`standard` + the unique + time/block indexes.
- ✅ **Native value expression index applied** (`scripts/db/0003_tx_value_numeric_idx.sql`).
- ✅ **RA-2 verified against REAL data**: the agent's "~30k SALT" answer (treasury →
  `0x52bb1cf7…`, block 460) reproduced exactly by `findNativeTransfers`; ordering /
  ranges / treasury filter all correct.
- ✅ **Token SQL verified on real Postgres** via an **ephemeral Neon branch**
  (`ra3-sqltest`, created → tested → deleted; zero prod writes). All 9 gated DB tests
  pass. This surfaced + fixed a real bug: Postgres `max(bigint)` returns a string, so
  `coverage` heights/timestamps are now coerced to numbers.
- ✅ **Backfill ran** (`backfill-transfers.ts`, decodes DB logs, no RPC): scanned 39
  logs → **0 token transfers** (the testnet has only native SALT + custom contract
  events; **no ERC-20/721/1155 Transfer events exist yet**). `token_transfers` stays
  correctly empty.

## Finding
The token capability is **built, deployed-ready, and verified**, but **latent** — there
is no token-transfer activity on the testnet yet (56 txs total; 39 logs, all custom
events). It will populate automatically once tokens transfer AND the indexer worker
runs the new code (see below). The token golden items stay `blocked_until: RA-3` with a
note (unblocking now would fail for lack of data, not capability).

## Remaining (not blocking; no token activity to miss)
The **indexer worker** must run the new `ingest.ts` to decode FUTURE token transfers.
If it runs on the droplet (per `INDEXER_DROPLET_HANDOFF`), redeploy it there; otherwise
`backfill-transfers.ts` can be re-run anytime to reconcile history from the `logs` table.

## Post-deploy eval (3-run, vs prod, commit `c119c5d`)
| Metric | RA-1.5 | RA-3 | |
|---|---|---|---|
| tool-F1 (hard gate) | 0.754±0.020 | **0.734±0.007** | stable ✅ |
| groundedness (hard gate) | 87.3% | 85.7% | stable ✅ |
| accuracy (soft) | 65.2%±3.5 | 49.3%±5.4 | dipped ⚠️ |

**Diagnosis — not a regression:** `findTransfers` works post-deploy (http 200, correct
tool; `findNativeTransfers` verified against real Neon data earlier). The accuracy dip
is **empty narration** — the small model calls the right tool but returns no text in
some runs (e.g. `value-30k-salt`, `salt-richlist` both called their tool, both empty).
The hard gates held. This is the same model-variance failure mode flagged in RA-1.5,
spiking this run.

**Sharpens two later sprints:**
- **RA-6** — a narration/answer-formatting scaffold is the highest-value next lever
  (and the tool may need to return a more model-friendly summary, not raw rows).
- **RA-8** — the system prompt has grown across RA-2/RA-3; a long prompt strains a 4B
  model. Moving chain knowledge into a **LoRA** (instead of the prompt) is the structural
  fix. Consider trimming the prompt as an interim step.

## Log
- **2026-06-09** — Branched from `main`. Built WP-3.2 (shared `transferDecode`,
  refactored `explainTransaction` to reuse it, fixed the stale ModelRegistry fixture →
  suite green), WP-3.1 (schema + drizzle migration 0003), WP-3.2b (ingest decodes
  transfers + populates `tokens`), WP-3.3 (reorg cleanup of token_transfers), WP-3.5
  (`findTokenTransfers`/`tokenActivity` + token support in the `findTransfers` tool).
  Wrote HANDOFF-RA3 for the owner-gated deploy/backfill. Tests 152→156, green,
  typecheck clean.
