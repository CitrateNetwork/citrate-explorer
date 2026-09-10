---
created: 2026-06-02T01:00:00Z
branch: s1-indexer-ai-foundation
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-1
status: active
---

# DAG-native from block zero

The recurring temptation building S-1 was to let `height` stand in for order. Every
SQL `ORDER BY`, every "latest block", every finality check wants to be linear —
because that's what an EVM indexer is. On Citrate it's a lie: `blue_score` is the
consensus order, `height` is just DAG depth, there are **multiple tips at once**,
and finality is depth ≥ 100, not "12 confirmations".

So the design forces the truth into the data, not the discipline of the next
agent. `dag_edges` is `(child_hash, parent_hash, kind)` — the selected-parent
spine and the merge parents are *both* first-class rows, so a downstream view
physically cannot flatten the DAG into a line. The block row carries `blue_score`,
`blue_work`, and `superseded`; reorgs mark rows superseded and **never delete**,
and finalized rows (depth ≥ 100) are immutable. The `no-linear-chain-assumption`
tripwire fires on `ORDER BY height` so the lie can't sneak back in CI.

The reorg/finality state machine got a TLA+ spec (`SelectedParentReconcile`) before
the code — TLC checks `FinalityImmutable` (a final block is never rewritten) and
`NoDeletion` (the known-hash set only grows). That's the one property whose
violation would be silent and catastrophic: an explorer that rewrites finalized
history is worse than no explorer.

What I could **not** do yet, honestly: observe a real reorg. That needs the worker
running against Neon (D-Neon/D-Host), which is a provisioning step, not code. The
superseded path is written and model-checked; the journal entry that records the
*first observed* reorg on the live DAG is deferred to when the indexer is live —
and it's listed in the Definition of Done so it isn't forgotten. Writing "observed
a reorg" before observing one would be exactly the fabrication Rule 11 forbids.
