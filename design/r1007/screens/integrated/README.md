---
created: 2026-11-07T23:30:00Z
branch: integrate/explorer-r1007
author: Claude Opus 5.5 (lane EXP-INTEGRATE) for Larry Klosowski (owner)
status: active
---

# Integrated explorer screenshots (#49 + #47 + #48 + #50)

Headless Chrome (puppeteer-core), full page, against `next start` (production build) on the Mac
pointed at `https://rpc.citrate.ai`, read-only. Files are `<page>-<width>-<scheme>.png`; the
scheme is `prefers-color-scheme` with the theme on System. No page has horizontal scroll at 375 px.
No wallet was connected and nothing was signed.

| Page | Route | Notes |
|---|---|---|
| home | `#/` | network state, r1007 figures show "Available after the r1007 upgrade" |
| dag | `#/dag` | DAG ledger and mergeset inspector |
| block | `#/block/<latest hash>` | |
| address | `#/address/<producer>` | |
| contract | `#/contract/0xAa91…c906` | WrappedSALT; verification store not provisioned locally, so "verification unknown" and the guessed ABI |
| ask | same, Ask open | context-aware suggestions for the contract on screen |
| approve-prepare-only | `#/approve/<approve(address,uint256) request>` | the one approval dialog, prepared in the browser through the kit, no wallet |
| contract-write-preview | Write tab, `withdraw(5)` preview | kit simulation reverts with `wSALT: insufficient balance` |
