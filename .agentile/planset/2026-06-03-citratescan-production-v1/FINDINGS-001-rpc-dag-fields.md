---
created: 2026-06-03T00:00:00Z
branch: p1-wire-live-reads
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: superseded
resolved: 2026-06-03
resolved_by: RPC owner (per RPC_DAG_FIELDS_HANDOFF.md on the citrate-labs trunk)
---

> **✅ RESOLVED 2026-06-03.** `eth_getBlockByNumber/ByHash` now return
> `blueScore`, `blueWork`, `selectedParentHash`, and `mergeParentHashes`
> (verified live: block 430312 → blueScore `0x24833`, selectedParent chains
> correctly). This unblocked P-5 (live DAG stream via `/api/dag/stream`), the home
> "latest by blue_score" list, and the block-detail DAG view — all now wired to
> the real fields. The finding below is retained as historical context.

# FINDINGS-001 — Live RPC exposes no per-block GHOSTDAG fields

## What
Surfaced while wiring P-1 against `rpc.citrate.ai`. The live node's
`eth_getBlockByNumber` / `eth_getBlockByHash` return **only standard Ethereum
block fields** — there is **no `blue_score`, `selected_parent_hash`, or
`merge_parent_hashes`** (only the linear `parentHash`). Confirmed the full key
set: `baseFeePerGas, difficulty, extraData, gasLimit, gasUsed, hash, logsBloom,
miner, mixHash, nonce, number, parentHash, receiptsRoot, sha3Uncles, size,
stateRoot, timestamp, totalDifficulty, transactions, transactionsRoot, uncles`.

No per-block Citrate method exists either: `citrate_getBlock`,
`citrate_getDagBlock`, `citrate_getBlockByNumber`, `citrate_blockInfo`,
`citrate_getDagInfo` all return **"Method not found"**.

The only DAG data available is the **global** `citrate_getDagStats`:
`{ totalBlocks, blueBlocks, redBlocks, tipsCount, maxBlueScore, currentTips[],
height, ghostdagParams }`. Live values confirm the DAG is real and that height ≠
blue_score (e.g. `height 426267`, `maxBlueScore 145681`).

## Impact
1. **Block detail page** cannot truthfully show per-block `blue_score`, merge
   parents, blue/red classification, or depth-based finality from live RPC.
2. **The S-1 indexer is affected** (important): `src/lib/citrate/rpc.ts`
   `parseDagBlock` reads `raw.blueScore` / `raw.selectedParentHash` /
   `raw.mergeParentHashes` — fields that do not exist on this node. Run as-is, the
   indexer would persist `blue_score = 0`, **no `merge_parent` edges**, and
   mis-computed finality — silently breaking blue_score ordering, the DAG edge
   graph, and finality-by-depth that S-1 was built around. The S-1 unit/TLA work
   is correct; the **input data is not available from this RPC**.
3. **Live DAG visualization (P-5)** cannot stream a real GHOSTDAG (parents/blue
   set) from this RPC.

## Current handling (P-1, honest)
- Wired LIVE where data is genuinely available: **chain status** (global dag
  stats), **transaction detail** (eth tx + receipt), **address** (balance / nonce
  / code). These are real today.
- Kept the **block detail** and **home "latest by blue_score"** lists on the rich
  demo sample in demo mode (`NEXT_PUBLIC_DEMO`), rather than render blue_score 0.
  `useLiveBlock` activates automatically once a real `blue_score` is returned.
- `/api/blocks/[id]` no longer asserts `finalized` when blue_score is absent.

## Recommended remediation (chain team)
Pick one (A is cleanest):
- **A. Extend the node RPC** to include `blueScore`, `blueWork`,
  `selectedParentHash`, `mergeParentHashes` on `eth_getBlockByNumber/Hash`
  (or add a `citrate_getDagBlock(ref)`), returning the GHOSTDAG header fields the
  consensus layer already computes. The explorer + indexer pick these up with no
  code change (the parser + `/api/blocks` already expect them).
- **B. Compute GHOSTDAG in the indexer** from parent links + `citrate_getDagStats`
  — heavier, duplicates consensus, and risks divergence.

This is the top blocker for the DAG-native surfaces (block page, live DAG, the
indexer's blue_score ordering). Flagging for the chain team; tracked against P-5
and the S-1 indexer.
