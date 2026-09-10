---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-3
status: planned
---

# Sprint S-3: Live DAG visualization

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-3` |
| **Sprint Name** | Live DAG visualization |
| **Goal** | A user watches the GHOSTDAG grow in real time — Sugiyama layout, blue/red coloring, selected-parent spine, live tips, click→detail — never a free-floating force layout. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-07-01 (target) |
| **End Date (target)** | 2026-07-15 |
| **Status** | `IN PROGRESS` placeholder → set at kickoff |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | S-1 (dag_edges, WS), S-2 (detail panels) |

## Why this sprint

This is the headline demo: an explorer that shows Citrate **as a DAG**, not a
column of blocks. GHOSTDAG has structure — a selected-parent spine, blue vs red
blocks, multiple live tips, merge parents fanning in — and showing that structure
is the single clearest way to communicate "this isn't Etherscan." We sequence it
after S-2 (reuse detail panels) and de-risk the WS delta pipeline early because
it's the riskiest UI work in the project.

## Deliverables

- `app/dag/page.tsx` — the live DAG view
- `lib/dag/layout.worker.ts` — d3-dag Sugiyama layout in a Web Worker
- `lib/dag/renderer.ts` — WebGL renderer (react-force-graph fixed-coord DAG mode → graduate to PixiJS)
- `lib/dag/stream.ts` — WS delta client (batched per `requestAnimationFrame`, last-N windowing)
- `app/api/dag/route.ts` — topology snapshot + delta stream
- `components/dag/{DetailPanel,Minimap,Legend}.tsx`

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (S-2 close count) | at kickoff | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | (S-2 close count) | at kickoff | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | (S-2 close count) | at kickoff | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (S-2 close fraction) | at kickoff | see `coverage/GATES.md` |

## Method

Per WP: BDD/Gherkin → failing test + tripwire → code → refactor → adversarial →
journal. WP-3.2 (layout determinism) gets a property test; no TLA+ WPs.

## Work Packages

### WP-3.1: DAG topology API (snapshot + stream)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/api/dag` — a windowed topology snapshot (last-N blocks by blue_score
with their `dag_edges`, tip flags, blue/red flags, finality) and a delta stream
(SSE/WS) emitting new blocks + edges as the indexer commits them. Does NOT do
layout (WP-3.2).

**Acceptance Criteria** *(Rule 11)*

- [ ] Snapshot returns the last N blocks ordered by `blue_score` with `selected_parent` + `merge_parent` edges, `is_tip`, `is_blue/is_red`, and `is_final` flags; node/edge set matches `blocks` + `dag_edges` for that window (data source = `blocks` + `dag_edges`).
- [ ] Delta stream emits a new node within p95 < 2 s of the indexer committing it; emitted edges reference only nodes in-window (data source = indexer commit → stream).
- [ ] `currentTips` flagged in the snapshot equals live `citrate_getDagStats.currentTips` at snapshot time (data source = live `citrate_getDagStats` vs snapshot) — proves multi-tip, not single-head.

**Tests added:** `dag.snapshot.window.test.ts`, `dag.stream.latency.test.ts`, `dag.tips.live.test.ts`.

---

### WP-3.2: Sugiyama layout in a Web Worker

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `lib/dag/layout.worker.ts` — d3-dag Sugiyama layered layout where the
**layer = blue_score (fallback height)**, running off the main thread. Incremental
re-layout on deltas. Does NOT render pixels (WP-3.3). **Never a free-floating
force layout** — coordinates are deterministic from blue_score order.

**Acceptance Criteria** *(Rule 11)*

- [ ] Each node's layer index is a monotonic function of `blue_score`; a higher-blue-score block never lays out behind a lower one (data source = layout output over a real snapshot).
- [ ] Layout runs in a Web Worker (main thread not blocked > 16 ms during layout) measured on a real last-N=2000 snapshot (data source = perf trace).
- [ ] Layout is deterministic: same snapshot → same coordinates (property test) — no random force positions (data source = repeated layout runs).
- [ ] Incremental delta re-layout preserves existing node positions except where blue_score ordering forces a shift (data source = before/after coordinate diff).

**Tests added:** `layout.bluescore.order.test.ts`, `layout.deterministic.test.ts`, `layout.incremental.test.ts`.

---

### WP-3.3: WebGL renderer + GHOSTDAG semantics

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | XL |

**Scope:** `lib/dag/renderer.ts` — WebGL render of laid-out nodes/edges. Start
with react-force-graph **fixed-coordinate DAG mode** (positions from WP-3.2),
graduate to PixiJS as scale demands. Render: blue vs red node coloring, **selected-
parent-chain spine** highlighted, merge-parent edges distinct, tips accented,
finality dimming. Semantic zoom + minimap. Does NOT own the stream (WP-3.1) or
detail panel (WP-3.4).

**Acceptance Criteria** *(Rule 11)*

- [ ] Blue blocks render blue and red blocks red, matching `is_blue/is_red` from the snapshot (data source = `/api/dag` flags from `blocks`).
- [ ] The selected-parent spine is a continuous highlighted path following `selected_parent` edges from the highest-blue-score tip back through the DAG (data source = `dag_edges` kind=`selected_parent`).
- [ ] Merge-parent edges are visually distinct from selected-parent edges and are present (not dropped) for multi-parent blocks (data source = `dag_edges` kind=`merge_parent`).
- [ ] Current tips are accented and update live as deltas arrive (data source = `is_tip` deltas).
- [ ] Renderer sustains ≥ 30 fps with last-N=2000 nodes during live deltas (data source = fps trace) — uses WebGL, not DOM/SVG nodes.

**Tests added:** `render.colors.test.ts`, `render.spine.test.ts`, `render.mergeedges.test.ts`, `render.fps.perf.test.ts`.

---

### WP-3.4: Live delta stream client + click→detail

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `lib/dag/stream.ts` — consume `/api/dag` deltas, batch per
`requestAnimationFrame`, last-N windowing (drop oldest beyond window). Clicking a
node opens the S-2 block `DetailPanel`. Minimap + legend. Does NOT add new RPC
(reuses S-2 detail API).

**Acceptance Criteria** *(Rule 11)*

- [ ] Deltas are coalesced per animation frame; under a burst of 50 new blocks the UI applies them in batches without dropping any (data source = delta stream vs rendered node set).
- [ ] Window holds at most N nodes; oldest-by-blue_score are evicted; evicted nodes' edges are pruned (data source = client window state).
- [ ] Clicking a node opens the S-2 block detail (selected/merge parents, finality) for that exact block hash (data source = S-2 `/api/blocks/[id]`).
- [ ] Minimap reflects the live window and supports jump-to-region (data source = client window state).

**Tests added:** `stream.raf.batch.test.ts`, `stream.window.evict.test.ts`, `dag.click.detail.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| S-1 `dag_edges` + WS indexer | Required | No topology/stream without it |
| S-2 block `DetailPanel` + `/api/blocks/[id]` | Required | Click→detail reuses it |
| d3-dag / react-force-graph / PixiJS | Add deps | Layout + render libraries |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WS delta firehose overwhelms browser | Med | Med | rAF batching + last-N windowing + Web Worker layout + WebGL render (WP-3.2/3.3/3.4) |
| Tempting to use a force layout | Med | High | Hard rule: layout layer = blue_score; determinism property test (WP-3.2) forbids random positions |
| Re-layout jitter on every delta | Med | Med | Incremental layout preserves positions (WP-3.2 AC) |
| PixiJS migration scope creep | Med | Low | Ship react-force-graph fixed-coord first; graduate only if fps AC fails at scale |

## Notes

The whole point: this is where the DAG-native deltas a linear explorer would
miss become *visible* — multiple tips at once, blue/red GHOSTDAG coloring, the
selected-parent spine, merge parents fanning in, finality by depth. If it ever
looks like a single column of blocks, the sprint failed.

## Definition of Done

- `/dag` renders the live GHOSTDAG with Sugiyama layout (layer = blue_score), blue/red coloring, highlighted selected-parent spine, distinct merge-parent edges, accented live tips, and finality dimming — all driven by `/api/dag` over real `blocks` + `dag_edges` (Rule 11), 0 mocks.
- Layout runs in a Web Worker, deterministic (no force layout); renderer sustains ≥ 30 fps at last-N=2000 during live deltas.
- Delta stream is rAF-batched + windowed; click opens the real S-2 block detail.
- Multi-tip rendering verified against live `citrate_getDagStats.currentTips`.
- Four ratchets non-decreasing; `RETRO.md` + journal ("rendering a DAG without a force layout") committed; S-4 kicked off.
