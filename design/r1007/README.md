---
created: 2026-11-04T05:30:00Z
branch: design/r1007-directions
author: Claude Opus 5.5 (lane EXP-DESIGN) for Larry Klosowski (owner)
status: draft (two directions for owner pick, WP EXP-S5 / Q-7)
---

# CitrateScan r1007 redesign: directions A and B

Two clickable prototypes for the design pass in planset `2026-11-03-r1007-v060`,
`02_EXPLORER_AND_VERIFICATION.md` §5 and §6. The owner picks one (or a mix); tokens and
components then move into `src/scan/`.

| File | Direction |
|---|---|
| [`direction-a.html`](direction-a.html) | **A. CitrateScan, evolved.** Current `src/scan/scan.css` tokens, made AA-safe. |
| [`direction-b.html`](direction-b.html) | **B. Federation design system.** `citrate-core/design/_ds/citrate-design-system-244c4cdf…`, adapted. |

Each file is self-contained: inline CSS and JS, Google Fonts only, no other network requests.
Open it directly or publish it as an Artifact. Both work at 375 px with no horizontal page
scroll (checked in headless Chrome on all 14 routes), follow `prefers-color-scheme` and a
`data-theme` toggle, and respect `prefers-reduced-motion` (the stream starts paused).

## What is real and what is sample

Everything is labeled **sample data** in the UI. Nothing reads the chain.

- **DAG.** A seeded simulation of 7 producers over 190 slots (one producer partitioned for 24
  slots, 18% of the previous slot's blocks missed by each producer). Each block is then colored by
  the GhostDAG rule with k = 18 (`core/consensus/src/types.rs`): selected parent by blue work,
  mergeset ordered by blue work, the k-cluster check for blue/red, blue score and blue work summed
  the same way. Blue/red, mergesets, anticones, accepting blocks and selected-chain changes are
  computed from that DAG, so they agree with each other. The partition produces 2 red blocks; the
  missed-gossip rate produces 3 depth-1 selected-chain changes (one arrives while the stream plays).
- **Contract.** `NameRegistry` (3 files) and the unverified `Guestbook` were compiled with real
  solc 0.8.28 (optimizer 200). The ABI, selectors, event topics, runtime bytecode, the 977-opcode
  disassembly and the `deployedSourceMap` used for cross-highlighting are the compiler's output.
  Write-tab calldata is real ABI encoding. Read results, the wallet connection, the decompiled
  view and the signature-DB hits are illustrative.
- **Finality.** Checkpoint every 50 blue score; the vote percentage is synthetic.

## Screens (both directions)

| Route | Screen | Notes |
|---|---|---|
| `#home` | Network health | blocks per slot (+ empty slots), merge rate, selected-chain changes, red rate, finality band, producer share, mini DAG, latest blocks (siblings included) and txs |
| `#dag`, `#dag-<hash>` | DAG view | blue-score axis, spine, merge edges, blue/red/unmerged, tips, chain-change markers, finality shading, mergeset inspector, chain-change timeline, play / pause / step |
| `#block-<hash>` | Block | selected parent, merge parents with colors, blue score and work, mergeset counts, accepting block, children, anticone size, finality chip |
| `#tx-<hash>` | Transaction | "included in X, accepted by chain block Y"; duplicate-in-siblings case (executed once, copy skipped); red-block note |
| `#addr-<addr>` | Address | balance, txs, names held; producers show blocks produced with colors |
| `#contract-<proxy>[-code/read/write/events]` | Verified contract behind an EIP-1967 proxy | proxy banner + implementation history; Code tab (file tree, source, opcodes, cross-highlight both ways); Read / Write as proxy (ABI forms, validation, connect-wallet state, calldata preview, simulated reverts); Events |
| `#contract-<unverified>[-disasm/selectors/decompiled]` | Unverified contract | disassembly with dispatcher entries labeled, selector table (one unresolved on purpose), "decompiled, not source" view |
| `#verify` | Verify and publish | submit form; forge (explorer API and Sourcify), forge create --verify, hardhat customChains, Citrate CLI, sdk-js; all marked planned (EXP-S2) |

The tx and block pages show a height plus a short hash prefix (`41,412 0x6a9c`) because siblings
share heights. That pattern should carry into the build.

## Direction A: CitrateScan, evolved

**Rationale.** Keeps what users already know: warm paper, the deep-evergreen header, citrate green
for proof, Space Grotesk / Geist / Geist Mono, Cormorant only for one italic lede. It changes
what the audit of the current tokens found: `--text-3 #8a8c84` on `#f1eee6` is 2.94:1, so it fails
AA; accent text is darkened; tokens move to `:root` with a proper dark block. The DAG is a horizontal
lane with round nodes and curved merge edges, like today's `dag.tsx`, but on real GhostDAG
semantics: a thick green spine for the selected chain, hollow dashed red nodes with a cross so color is
never the only cue, and a yellow outline for the anticone. Cards are rounded (9 / 14 px). It reads
as a consumer-friendly explorer.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#f1eee6` | `#0c2216` | page |
| `--surface` / `--surface-2` | `#faf8f3` / `#ffffff` | `#11301f` / `#163a26` | cards / instruments |
| `--text-1` | `#0e0f0c` | `#edf3ea` | primary text |
| `--text-2` | `#4b4e47` | `#b8c9ba` | secondary (7.3:1 / 8.3:1) |
| `--text-3` | `#60635b` (was `#8a8c84`) | `#94ae9b` | tertiary (5.3:1 / 6.0:1) |
| `--accent` | `#8ecc09` | `#9ad60c` | fills only, never text |
| `--accent-text` | `#446304` | `#b2e43a` | links, accent text (6.5:1 / 9.6:1) |
| `--danger-text` / `--warning-text` | `#9a2112` / `#6e5100` | `#f39a8d` / `#ffcf52` | status |
| `--header-bg` | `#0f2a1a` | `#081a10` | header |
| `--dag-chain` / `--dag-blue` | `#8ecc09` / `#c6e47a` | `#9ad60c` / `#4f7a17` | chain block / merged blue |
| `--dag-red` / `--dag-pending` | `#a72414` / `#60635b` | `#ef8273` / `#94ae9b` | red / not merged yet |
| `--dag-spine` / `--dag-change` | `#5a8205` / `#b07b00` | `#b2e43a` / `#ffcf52` | spine / chain change, anticone |
| radii | 6 / 9 / 14 / pill | | |
| type | Space Grotesk 500, Geist 400-600, Geist Mono, Cormorant italic 500 (lede only) | | |

## Direction B: federation design system

**Rationale.** Adopts the design system as written: paper and ink, hairlines over shadows, the
2 px ink rule under page titles, uppercase compliance labels at +0.14em, Space Grotesk at weight
380 for titles, radii 6 / 8 / 12, accents used like a seal, the lattice dot motif once (home hero),
and a deep-evergreen left rail like the operator console. Sections read as filed records rather
than cards. The DAG becomes a **ledger**: one ruled column per blue score (heavy rule every 10),
square nodes, orthogonal merge edges, an ink spine, a finality strip across the top, and chain
changes as yellow columns. GhostDAG "blue" is drawn in the system's navy, so blue means blue, and red
blocks are hatched brick. It reads as an instrument for operators and auditors.

Deviations from the system, each needed: `--fg-3` darkened from stone-500 `#84867f` (3.27:1 on
paper) to `#5f625a`; links in ink with a green underline because green-deep on paper is 4.02:1;
a dark theme derived from ink and evergreen (the system ships light only); em-dashes, which the
system's voice guide allows, are not used (owner rule); the system's borrowed lineage names and its
compute-revenue copy are not used anywhere.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` / `--paper-2` / `--paper-pure` | `#f4f1ea` / `#faf8f3` / `#ffffff` | `#11140f` / `#171b15` / `#1d221a` | page / raised / instrument |
| `--fg-1` | `#0e0f0c` | `#f1efe8` | text, ink rules |
| `--fg-2` | `#4f524b` | `#c3c4be` | labels (7.1:1 / 9.9:1) |
| `--fg-3` | `#5f625a` (system `#84867f`) | `#a3a59d` | captions (5.5:1 / 7.5:1) |
| `--border-1` / `--border-2` / `--border-strong` | `#d9dad4` / `#c3c4be` / `#0e0f0c` | 13% / 24% / `#f1efe8` | hairline / field / document rule |
| `--green` / `--green-text` / `--green-tint` | `#8ecc09` / `#3d5a03` / `#e8f3c6` | `#8ecc09` / `#b2e43a` / 15% | seal, finalized, focus |
| `--yellow-text` / `--yellow-tint` | `#6e5100` / `#fff1c4` | `#ffcf52` / 13% | voting, pending, sample stamp |
| `--info` (= GhostDAG blue) | `#1b4965` | `#9cc6e0` (`--dag-blue #8fbcd9`) | blue blocks |
| `--danger` | `#a72414` | `#ef8273` | red blocks, reverts |
| `--rail-bg` | `#0f2a1a` | `#0a1c12` | navigation rail |
| radii | 6 buttons / 8 instruments / 12 / pill status | | |
| type | Space Grotesk 340-420, Geist 400-600, Geist Mono | | |

All text pairs above were computed at 4.5:1 or better (lowest: A light `--text-3` on the sunk
surface, 4.94:1).

## Component inventory

Shared content components (one implementation, styled per direction): page header with eyebrow;
status row; **color chip** (selected chain / blue / red / not merged yet, each with a shape cue);
**finality chip** (finalized / voting n% of 67% / above checkpoint); tx status chip (success /
reverted / skipped duplicate); method pill; key-value list with hints; stats row; data table with
horizontal scroll; banner (proxy / info / ok / warn); **inclusion → acceptance flow**; log card;
tabs; **code pane** (file tree, highlighted source, opcode list with source refs, raw bytecode);
**ABI function form** (typed inputs, validation, query / write, result or calldata preview);
connect-wallet banner; selector table; decompiled view with warning; command card with copy;
search with "no match" message; stream control (play / pause / step / replay); theme toggle.

Direction-specific: A has the sparkline tile, finality track, producer bar list, lane DAG, chip-list
inspector and card feeds. B has the figure ledger row, column chart with gridlines, finality ruler,
producer table with inline bars, ledger DAG, table-based mergeset filing, chain-change table and
the left rail.

## DAG visualizations and their data (02 §3)

| View (02 §6) | Shown in | Data source once CNV-RPC lands |
|---|---|---|
| 1. Live DAG lane: nodes on blue score, spine, merge edges, blue/red, tips | DAG view, home mini DAG | `citrate_getBlocksAtHeight` (sibling-complete set), `citrate_getGhostdagData(hash)` (blue score, blue work, selected parent, mergeset blues/reds), parents from the header, tips from `citrate_getDagStats` (fixed, CV-6) |
| 2. Mergeset inspector (blues, reds, anticone) | DAG inspector, block page | `citrate_getGhostdagData(hash)` for mergeset blues/reds and blue anticone size; anticone membership computed by the indexer from stored `dag_edges` within the window |
| 3. Reorg / selected-chain-change timeline | DAG markers + timeline | `citrate_getSelectedChainChanges(fromHash)` (added/removed); the indexer persists each event |
| 4. Producer share and slot leadership | home | indexer aggregate over `blocks.producer` by slot; sortition fields if CV-4b is adopted |
| 5. Finality band (checkpoint vs tip) | home, DAG strip, block chip | `citrate_getFinalityStatus` (checkpoint, votes, threshold); never depth (CV-8) |
| 6. Network health (blocks per slot, empty slots, merge rate, red rate) | home tiles | indexer aggregates over blocks by slot and `getGhostdagData` colors; replaces today's faked `getDagStats` counts (chain#317) |
| Tx "included in X, accepted by Y" | tx page | `citrate_getAcceptingBlock(txHash)` plus the receipt's including block (CV-4a) |
| Contract Read at block | Read tab | historical `eth_call` at block |
| Proxy implementation history | proxy banner | `eth_getStorageAt` on the EIP-1967 slot across blocks, `Upgraded` logs |
| Internal txs, factory creations | not drawn yet | `debug_traceTransaction` / `trace_block` |

## Open questions for the owner

1. **Pick A, B, or a mix.** A likely mix: B's ledger DAG and document rules with A's header and
   warmer cards. Say which parts.
2. **"Blue" color.** A draws GhostDAG blue in citrate green (as today); B draws it navy. Green-for-blue
   confuses people who know GhostDAG; navy-for-blue spends a semantic color.
3. **Red-block transactions.** CV-4a has not settled whether they execute. The tx page shows a note
   and the accepting block. Confirm the wording once the spec lands.
4. **Tool flag names.** forge and hardhat need `--verifier etherscan`, `--etherscan-api-key` and an
   `etherscan:` config key. These are literal CLI and config names, so they appear in the verify
   commands. Prose in both files avoids competitor names. OK to keep the literal flags?
5. **Explorer API keys.** forge requires a key for the explorer-compatible verifier. Do we issue keys,
   accept any value, or rate-limit by IP?
6. **Domain.** Commands use `explorer.citrate.ai`; the repo also references `scan.citrate.ai`.
   Which is canonical?
7. **Sourcify naming.** The verify page names Sourcify because `--verifier sourcify` is the tool name.
   Fine?
8. **Slot length and checkpoint interval** in the sample (2 s, 50 blue score) are placeholders.
   Confirm the r1007 values for the real build.
9. **Dark theme for B.** The design system has none; this one is derived. Should it go back into the
   design system?

## Rebuilding

The prototypes were generated from a shared core (simulation, GhostDAG coloring, ABI encoding,
screens) plus a per-direction stylesheet and UI kit, assembled into one file each. The core is
inlined in both HTML files and can be read there.
