# Changelog

All notable changes to CitrateScan (`citrate-explorer`). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the authoritative history is the
Agentile sprint record under `.agentile/sprints/`.

## [Unreleased]

### Added — S-1 Indexer + AI foundation (in progress, 2026-06-02)
- Typed DAG RPC layer (`src/lib/citrate/rpc.ts`): `getDagBlock` exposing
  `selected_parent_hash` / `merge_parent_hashes[]` / `blue_score`, `isFinal`, WS client.
- Indexer worker upgraded: ingests blocks/txs/**receipts/logs**/`dag_edges`,
  blue_score-resume cursor (`indexer_state`), finality reconciliation, and
  reorg→`superseded` handling (never deletes; finalized rows immutable).
- Schema reconciled: `dag_edges (child_hash, parent_hash, kind)`, `superseded`
  flag, `indexer_state`; migration `0000_flashy_salo.sql`.
- AI agent: read-only tool harness with per-call **audit logging**,
  `explainTransaction` synthesis (decodes ERC-20/721 Transfer/Approval),
  dual-unit (SALT + grains) outputs, `exploreDag` selected-parent walk, and a
  **Privy auth gate** on `/api/chat`.
- Hybrid crypto fully tested (E2EE round-trip, hashed key, at-rest).
- **TLA+** `specs/tla/SelectedParentReconcile.tla` (finality-immutability +
  no-deletion, passes TLC); `no-linear-chain-assumption` tripwire.
- Ratchets: tests 10 → 30 (all green incl. live-RPC), specs 0 → 1, tripwires 5 → 6.
- Provisioning handoff for Neon / Privy / worker host / inference.

### Added — S-0 Bootstrap (2026-06-02)
- Bootstrapped `citrate-explorer` from the Agentile skeleton (13 rules, four
  ratchets, CI workflows).
- Canonical constants (`.agentile/CONFIG.md`), product spec, and the full planset
  `2026-06-02-citrate-explorer-v1` (S-1..S-6).
- Design documents for the async design-team prototype: `DESIGN_BRIEF.md`,
  `DESIGN_HARNESS_AND_SETTINGS.md`, `EXPLORER_SPEC.md`, `SYSTEM_PROMPTS.md`.
- Stack scaffold: Next.js 16 / React 19 / viem+wagmi / Privy / Vercel AI SDK v6 /
  Drizzle+Neon, plus the backend skeleton (`src/lib/{citrate,ai,db,harness,
  indexer,verify,crypto}`, `src/app/api/*` route stubs).
- Registered in the Citrate federation (`citrate-federation/manifest.toml`).
