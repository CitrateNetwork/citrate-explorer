---
created: 2026-06-09T12:10:00Z
branch: feat/RA-8-citrate-lora
author: Larry Klosowski (saul) + Claude Opus 4.8 (1M context)
sprint: RA-8
status: active
---

# Sprint RA-8: Citrate-expert LoRA

> Strategy: [`../../../planset/2026-06-08-citratescan-research-agent-v1/ADR-001-small-model-lora-strategy.md`](../../../planset/2026-06-08-citratescan-research-agent-v1/ADR-001-small-model-lora-strategy.md).

## Goal
Make the fast small model a Citrate expert via a LoRA trained on the chain's own
structure, registered on-chain (LoRAFactory) and served by the gateway — the
dogfooding capstone.

## DGX training stack (assessed)
The DGX (GB10) has the full stack: torch 2.11 + CUDA, transformers 5.0,
peft 0.18, accelerate, datasets; `llama.cpp` has `convert_lora_to_gguf.py` and
`llama-server --lora`. The pipeline is feasible end-to-end on the DGX.

## Work package status
| WP | Title | Status |
|----|-------|--------|
| 8.1 | Training corpus from the chain's structure (+ golden holdout) | `[x] COMPLETE` |
| 8.2 | peft SFT training script | `[x] COMPLETE` (ready to run) |
| 8.3 | Convert → serve → register → measure runbook | `[x] COMPLETE` (runbook) |
| 8.4 | Acquire gemma base weights + train + register + measure | `[~] gated on Google's MANUAL approval of the gemma-3n access request` |
| 8.5 | Validate the full pipeline on an ungated model | `[x] COMPLETE — proven end-to-end on Qwen2.5-1.5B` |

## Pipeline validated end-to-end (2026-06-09, ungated Qwen2.5-1.5B)
With gemma-3n pending Google's **manual** approval (`gated: manual`), the whole machinery
was proven on an ungated model so the gemma run is push-button:
- **train** — `train_lora.py` (peft): 18.5M LoRA params (1.18%), loss 3.0→1.2, **53s on
  the GB10**. ✅
- **convert** — `convert_lora_to_gguf.py` → 73.9M GGUF adapter. ✅
- **serve** — temp `llama-server --lora` on :8182 (prod :8181 untouched). ✅
- **knowledge transfer** — the LoRA-loaded model answered a Citrate fact the base can't:
  *"LoRAFactory — factory that creates LoRAs / LoRA fine-tuning."* ✅ (address hallucinated
  — expected from a 121-example LoRA on a 1.5B; the name+purpose came from the corpus).

**Operational lesson baked in:** the GB10's unified-memory CUDA allocator counts only
truly-FREE RAM, not reclaimable page-cache → training OOMs at model load with tens of GB
"available". Fix (now in `run_pipeline.sh` + `train_lora.py`): drop page-cache first
(`echo 3 > drop_caches`), `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`, no
`device_map="auto"`. Also: `convert_lora_to_gguf.py --base` needs a local snapshot dir,
not a repo id.

## What shipped
- `scripts/lora/build-corpus.ts` → `corpus/citrate-sft.jsonl` — **121 SFT examples**
  generated from the RA-5 contract catalog (purpose, not just name), precompiles,
  curated chain facts (GHOSTDAG, finality-by-depth, native-vs-token, no native
  paymaster), and synthetic research-approach exemplars. **Golden eval set held out
  by construction** (colliding examples auto-filtered — X-8; verified: 1 filtered).
- `scripts/lora/train_lora.py` — peft LoRA SFT (chat-template masking, bf16, rank 16),
  ready to run on the DGX.
- `scripts/lora/README.md` — the full pipeline: acquire base weights → train → convert
  to GGUF → serve with `--lora` → register in LoRAFactory → measure base-vs-LoRA with
  the eval (`EVAL_LORA_ID` tag, X-8).

## The one gate
`gemma-3n-E4B` is HF-gated; LoRA training needs the HF safetensors (the local file is
only the GGUF quant). One-time owner step: accept the license + `huggingface-cli login`.
Then train (minutes on the GB10) → convert → serve → measure. On-chain registration
uses the deployer/treasury key.

## Why the measurable lift may be modest (honest)
The agent is already ~93% via tooling + 128K context; the LoRA's golden-set lift may be
small. Its real value: chain reasoning on out-of-distribution queries, the ability to
trim the prompt (knowledge in weights → lower latency), and the dogfooding/demo of
Citrate's small-model + on-chain LoRA value prop. Measured via the eval, gated on the
hard metrics (tool-F1, groundedness).

## Log
- **2026-06-09** — Assessed the DGX stack (peft/CUDA ready). Built the corpus generator
  (121 examples, holdout-enforced), the peft training script, and the pipeline runbook.
- **2026-06-09** — Added `scripts/lora/run_pipeline.sh` (one command: preflight → corpus
  → train → convert-to-GGUF → measure steps) and **ran it**. It executes to the training
  gate and stops: HF returns **403** on `google/gemma-3n-E4B-it` — a cached token exists
  (`saulloveman`) but the account hasn't accepted the Gemma license. Assessed the
  no-download `llama-finetune` path too: not viable (broken binary —
  `undefined symbol: llama_apply_adapter_cvec` — and it needs f16, not our Q4 quant).
  **Conclusion:** the only gate is a one-time owner click — accept the license at
  huggingface.co/google/gemma-3n-E4B-it, then re-run `run_pipeline.sh` (I drive the
  rest: train → convert → serve → register → measure). I won't bypass a model license.
