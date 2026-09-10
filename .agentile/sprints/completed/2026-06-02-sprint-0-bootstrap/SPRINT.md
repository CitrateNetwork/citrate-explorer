---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-0
status: complete
---

# Sprint S-0: Bootstrap

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-0` |
| **Sprint Name** | Bootstrap CitrateScan from the Agentile skeleton |
| **Goal** | Stand up `citrate-explorer` as an Agentile-governed repo with the full Next.js/Privy/Drizzle/AI stack scaffold, the planset, and the design docs — ready for S-1. |
| **Branch** | `main` |
| **Start Date** | 2026-06-02 |
| **End Date** | 2026-06-02 |
| **Status** | COMPLETE |
| **Planset** | `.agentile/planset/2026-06-02-citrate-explorer-v1/PLANSET.md` |

## Why this sprint

Citrate has no web explorer or persistent indexer today. Before any feature work,
the repo needs the Agentile foundation (13 rules, four ratchets, CI), the project
constants (`CONFIG.md`), the product spec, the full planset (S-1..S-6), and the
design documents the design team builds the prototype against.

## Deliverables (all landed)

- Agentile foundation mirrored from `CitrateNetwork/agentile` (`.agentile/`,
  `.claude/`, `scripts/`, CI workflows, four ratchets).
- `CONFIG.md`, `PRODUCT_SPEC.md`, `CLAUDE.md`, `coverage/baseline.json` + `BASELINE.md`.
- Planset: `.agentile/planset/2026-06-02-citrate-explorer-v1/` (PLANSET + S-1..S-6).
- Design docs: `DESIGN_BRIEF.md`, `DESIGN_HARNESS_AND_SETTINGS.md`,
  `SYSTEM_PROMPTS.md`, `EXPLORER_SPEC.md`.
- Stack scaffold: `package.json`, configs, `src/` backend skeleton, `.env.example`,
  `drizzle.config.ts`, `foundry.toml`.
- Federation registration (manifest entry + `repos/citrate-explorer/`).

## Definition of Done
- [x] `pnpm install && pnpm typecheck && pnpm build` succeed.
- [x] Repo created at `CitrateNetwork/citrate-explorer` and pushed.
- [x] Registered in `citrate-federation/manifest.toml`.
- [x] Design docs complete and internally consistent with the backend skeleton.

## Next
S-1 (Indexer + AI foundation) — see
`.agentile/planset/2026-06-02-citrate-explorer-v1/sprints/S-1-indexer-ai-foundation.md`.
