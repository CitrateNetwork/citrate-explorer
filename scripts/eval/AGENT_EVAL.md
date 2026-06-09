---
created: 2026-06-09T00:04:02Z
branch: feat/RA-1-eval-harness
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: active
---

# Agent eval harness (RA-1)

How CitrateScan's agent is measured. The harness plugs into the existing
`scripts/eval/` BENCH framework: a scenario drives the agent over a **golden set**,
four scorers turn the runs into `BENCH` lines, and `benchmark_harness.sh` aggregates
them into a JSON baseline. See the planset:
`.agentile/planset/2026-06-08-citratescan-research-agent-v1/sprints/RA-1-eval-harness.md`.

## Pieces

| Piece | Where | What |
|------|-------|------|
| Golden set | `scripts/eval/golden/citrate.golden.jsonl` | The held-out question corpus (JSONL). |
| Schema + validator | `src/lib/eval/golden.ts` (+ `golden.test.ts`) | Types, validation, JSONL parser. Counted by the test ratchet. |
| Chat driver | `src/lib/eval/` (WP-1.2) | Mints a token, calls `/api/chat`, returns `{answer, tool_calls, latency_ms, steps}`. |
| Ground truth | `scripts/eval/ground_truth` (WP-1.3) | Computes each item's expected value from live RPC (Rule 11). |
| Scorers | `src/lib/eval/` (WP-1.4) | tool-selection (P/R/F1), groundedness, accuracy, latency. |
| Scenario | `scripts/eval/scenarios/agent_research.*` (WP-1.5) | Emits `BENCH agent_*` lines. |
| Baseline | `scripts/eval/baselines/canonical.json` | Pinned reference, tagged `{base_model, lora_id}` (X-8). |

## Golden record schema

One JSON object per line (`//` and `#` lines are comments). Fields (full spec in
`src/lib/eval/golden.ts`):

```jsonc
{
  "id": "kebab-id",                       // ^[a-z][a-z0-9-]*$, unique
  "persona": "newcomer|auditor|native",
  "class": "chain|address|dag|token|value|native_vs_token|multistep",
  "question": "natural-language question the user would ask",
  "expected_tools": ["getBalance"],        // tools that SHOULD be called; [] = knowledge (not scored for groundedness)
  "answer_assertion": {                     // how accuracy is checked
    "kind": "contains_all|address|numeric|set_contains|labeled_native|labeled_token",
    "values": ["..."],                     // contains_all / address / set_contains
    "number": 123, "tolerance": 0.01, "unit": "SALT",   // numeric (relative tolerance)
    "token": { "symbol": "wSALT", "address": "0x..." }  // labeled_token
  },
  "ground_truth": {                         // where the expected value comes from
    "type": "static" | "rpc",
    "generator": "balanceSalt",            // rpc only — see ground-truth registry
    "params": { "address": "0x..." }
  },
  "blocked_until": "RA-2",                  // optional; excluded from the live pass rate until that sprint
  "notes": "why this item exists"
}
```

### Conventions
- **Rule 11:** dynamic truth is `type: "rpc"` (computed from the chain at run time),
  never a hand-typed number. Static is reserved for invariants (chain id 40204,
  finality depth 100, known contract labels).
- **X-3 (native vs token):** value answers use `labeled_native` or `labeled_token`
  so the scorer fails an answer that doesn't say *which* asset it is.
- **Future tools** (`findTransfers`, `topHolders`, …) may appear in `expected_tools`
  only on records that are also `blocked_until` the sprint that builds them.
- The golden set is the **held-out** eval corpus — it must never enter the RA-8 LoRA
  training corpus (X-8).

## Adding an item
1. Append a line to `citrate.golden.jsonl`.
2. If it needs live truth, add/choose a `generator` (WP-1.3 registry).
3. Run `npx vitest run src/lib/eval/golden.test.ts` — it must validate.
4. Run the scenario to see it scored.

## Metrics (BENCH lines)
- `agent_tool_f1` (higher better) — F1 of called vs expected tools, over scored items.
- `agent_groundedness` (higher better) — fraction of tool-expecting answers that called ≥1 tool.
- `agent_accuracy` (higher better) — fraction of items whose answer satisfies its assertion.
- `agent_latency_p50` / `_p95` (lower better) — answer latency.
- Per-class accuracy is also emitted (`agent_accuracy_value`, …) to track capability classes.

Blocked items are reported in a separate `not_yet_supported` count — never folded
into the pass rate.
