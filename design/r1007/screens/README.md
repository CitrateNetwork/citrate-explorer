---
created: 2026-11-08T01:30:00Z
branch: feat/redesign-b
author: Claude Opus 5.5 (lane EXP-REDESIGN) for Larry Klosowski (owner)
status: active
---

# Direction B screenshots (feat/redesign-b)

Headless Chrome (puppeteer-core), full page, against `next dev` on the Mac pointed at
`https://rpc.citrate.ai` (read-only), 2026-11-08 around 01:20 UTC. Files are
`<page>-<width>-<scheme>.png`; the scheme is `prefers-color-scheme` with the theme set to System.
The consent banner was answered "Reject non-essential" and the Next dev overlay hidden before each
shot. No page had horizontal scroll at 375 px.

| Page | Route | What the live node gave |
|---|---|---|
| home | `#/` | 60 heights, 9 tips, one producer, no transactions; every r1007 figure shows "Available after the r1007 upgrade" |
| dag | `#/dag` | the ledger and the mergeset inspector on the newest chain block; no merges in the window |
| block | `#/block/<latest hash>` | header fields, children from the live window; GhostDAG data, siblings and finality pending r1007 |
| tx | `#/tx/0x00…01` | **not-found state only.** No transaction exists in any range sampled on chain 40204 (newest 6,000 heights, the first 200, 100 spread across the chain), so the "included in X, accepted by Y" view could not be shown on live data. It is covered by `inclusionView` tests. |
| address | `#/address/0x6181…46b9` | the producer: live balance and nonce, blocks produced in the window; the index is not provisioned locally |
| agent-panel | `#/block/<hash>` with Ask open | the agent panel docked in the shell, context strip naming the block |
| contract-legacy | `#/contract/0xde4F…3BD9` | the EXP-CONTRACT screen, untouched, inside the new shell with remapped tokens |
