# Changelog

All notable changes to CitrateScan (`citrate-explorer`). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the authoritative history is the
Agentile sprint record under `.agentile/sprints/`.

## [Unreleased]

### Changed: generated 40204 chain constants (2026-10-05 reroll prep)
- `pnpm sync-addresses` now also writes `src/generated/chainConstants.json`: the
  precompile catalog (the book's `precompiles` merged with citrate-chain's
  `PURE_PRECOMPILE_ADDRESSES` and `AGENT_FORK_PRECOMPILE_ADDRESSES`, so the agent
  precompiles 0x0112/0x0113/0x0121/0x0122 and 0x0130 are listed) and the genesis SALT
  allocations (citrate-chain `GenesisConfig::testnet_beta`). New flags `--chain`,
  `--only book|constants`; `--check` covers both. It fails on a precompile with no
  description or a genesis account with no label (`scripts/lib/chainLabels.mjs`).
- `GENESIS_ALLOCATIONS` and `PRECOMPILES` read the generated file. The hand-written
  0x1000/0x1001/0x1003 "state precompile" entries are gone (no chain source lists them),
  and the inference precompiles carry the book's names (ModelDeploy, ModelInference, ...).
- `NEXT_PUBLIC_MODEL_REGISTRY` / `NEXT_PUBLIC_INFERENCE_ROUTER` override the book only
  when set to a well-formed address; `.env.example` leaves them unset.
- CI `address-drift.yml` (and `scripts/check-address-drift.sh`) also check the generated
  constants against citrate-chain.

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
