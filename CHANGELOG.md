# Changelog

All notable changes to CitrateScan (`citrate-explorer`). Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the authoritative history is the
Agentile sprint record under `.agentile/sprints/`.

## [Unreleased]

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
