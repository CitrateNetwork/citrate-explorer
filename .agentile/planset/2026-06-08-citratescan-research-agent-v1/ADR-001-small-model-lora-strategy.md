---
created: 2026-06-08T23:12:46Z
branch: planset/agent-research-upgrade
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
status: ACCEPTED
---

# ADR-001: Make the explorer agent expert via a Citrate LoRA, not a bigger model

| Field | Value |
|-------|-------|
| **ADR Number** | ADR-001 |
| **Date** | 2026-06-08 |
| **Status** | ACCEPTED |
| **Author** | Larry Klosowski (saul) |
| **Sprint** | RA-8 (corpus fed by RA-1, RA-5) |

## Context

The explorer agent runs on `gemma-4-E4B-it-Q4_K_M` — a ~4B-parameter, 4-bit
quantized model served via the Citrate inference gateway. The obvious lever for a
"smarter" agent is a bigger/frontier model. But Citrate's entire product thesis is
**small models made expert through LoRA fine-tuning**, served fast, with adapters
registered and discovered on-chain (`LoRAFactory 0x6e564d22949992705b5de7108b2c68d3554d5863`,
plus `LoRAFactory`/`ModelRegistry`/inference precompiles). The owner's definition of
"wow" for this agent is explicitly **fast + reads the chain well + connects logic** —
not "uses the largest model." The agent is also strictly read-only (no writes), so
the failure cost of a small model is a worse answer, never a bad transaction.

The forces in tension: small models struggle with multi-step tool planning and
domain-specific knowledge out of the box, yet they are faster, cheaper, and the thing
Citrate is selling. We need the small model to *be good at this chain specifically*.

## Decision

**We will make the explorer agent expert by (a) a richer deterministic tool/query
layer, (b) a Citrate-expert LoRA fine-tuned on the chain's own structure and on
tool-use traces, registered on-chain in LoRAFactory and served by id through the
gateway, and (c) an eval harness that gates every change — rather than by switching
to a larger or frontier model.**

This keeps the model seam (`provider.ts`) portable — a frontier model remains a
valid env-level fallback for debugging — but the *product* target is the tuned small
model. The boundary: this ADR governs the explorer's read-only research agent only;
it does not dictate model choice for other Citrate surfaces.

## Rationale

- **Dogfooding the marketplace.** Citrate sells small-model inference + a LoRA
  registry. The flagship explorer agent running on a registered Citrate LoRA is the
  strongest possible demonstration.
- **Speed is a feature.** The owner names "fast" first. A 4B model on the gateway
  answers in a fraction of the latency (and cost) of a frontier call, which matters
  for an interactive research drawer.
- **The knowledge is bounded and structured.** "What this chain is" — contracts,
  precompiles, the address map, DAG/finality, native-vs-token rules, the tool surface
  — is a finite, well-specified corpus. This is exactly the regime where LoRA
  fine-tuning closes most of the gap to a big model.
- **Read-only caps the downside.** A wrong answer is correctable and measurable; no
  funds move. So the risk profile rewards the small-model bet.
- **Measurable.** RA-1's harness lets us prove the LoRA's lift (`{base}` vs
  `{base+lora_id}`) at equal latency — the bet is validated by numbers, not faith.

### Alternatives considered

| Alternative | Pros | Cons | Why rejected |
|-------------|------|------|--------------|
| Switch to a frontier model (Claude/OpenAI) | Best reasoning now; least tuning work | Slow, costly, off-thesis, no dogfooding | Contradicts the product thesis and the "fast" goal |
| Larger hosted model via gateway | More headroom than 4B | Slower; still untuned for Citrate; more infra | Doesn't deliver chain expertise; loses the speed win |
| Stay on base Gemma, tooling only | Cheapest; ships now | Leaves chain-specific reasoning/knowledge on the table | Insufficient for "connects logic"; misses the LoRA opportunity |
| **Small model + Citrate LoRA + rich tools + eval (chosen)** | Fast, on-thesis, dogfoods registry, measurable | Requires a training corpus + serving path | **Selected** |

## Consequences

### Positive
- The flagship agent demonstrates Citrate's small-model + LoRA value proposition end
  to end (train → register on-chain → serve → measurably better).
- Fast, cheap interactive answers; the LoRA artifact is reusable by other surfaces.
- A reusable corpus-and-eval pipeline for future chain-expert adapters.

### Negative
- Requires assembling a quality training corpus and a holdout discipline (mitigated:
  corpus is generated from the RA-5 knowledge pack + RA-1 traces; golden set is
  excluded by construction — X-8).
- Depends on the gateway being able to serve a LoRA by id (mitigated: RA-8 begins
  with a dependency check; base Gemma remains shippable if serving isn't ready).
- Small-model reasoning ceiling is real (mitigated: plan→execute scaffold + clarifying
  questions in RA-6 shrink each step; eval gates regressions — X-7).

### Neutral
- The model seam stays env-driven; swapping base models or adapters is config, not code.

## Affected components

| Component | Impact |
|-----------|--------|
| `src/lib/ai/provider.ts` | Serves base + LoRA id; records `{base_model, lora_id}` for eval |
| `scripts/eval/` | Runs base-vs-LoRA comparisons (RA-1) |
| LoRA training pipeline (new, off-repo compute) | Curates corpus, trains, registers in LoRAFactory |
| On-chain `LoRAFactory` | Stores the registered adapter id |

## Compliance check
- [x] Consistent with CONFIG.md (chain 40204, SALT, gateway inference)
- [x] Doesn't violate CORE_RULES.md (Rule 11: eval truth from live RPC; no fabrication)
- [ ] If consensus change: TLA+ spec — N/A (no consensus change)
- [x] Rule-12 frontmatter present

## References
- PLANSET.md (this directory) — RA-8, X-8
- EVALUATION.md G-9
- `src/generated/addresses.json` (LoRAFactory address)

## Revision history
| Date | Author | Change |
|------|--------|--------|
| 2026-06-08 | saul | Initial proposal + accepted (owner decision in planning) |
