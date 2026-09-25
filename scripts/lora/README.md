# RA-8 — Citrate-expert LoRA pipeline

Make the fast small model (`gemma-4-E4B`) a Citrate expert by fine-tuning a LoRA on
the chain's own structure, registering it on-chain (LoRAFactory), and serving it via
the gateway. The whole pipeline runs on the **DGX** (`spark-2e01`, GB10) — torch 2.11
+ transformers 5.0 + peft 0.18 + CUDA are already installed; `llama.cpp` has
`convert_lora_to_gguf.py` and `llama-server --lora`.

## Status (what's done vs gated)
- ✅ **Corpus** — `scripts/lora/build-corpus.ts` → `corpus/citrate-sft.jsonl` (121
  examples: contract purposes, precompiles, chain facts, native-vs-token rules,
  research-approach exemplars). The RA-1 golden eval set is a strict **holdout**
  (colliding examples are auto-filtered — X-8).
- ✅ **Training script** — `scripts/lora/train_lora.py` (peft SFT), ready to run.
- ⏳ **Base weights (owner)** — `gemma-3n-E4B` is HF-gated. LoRA training needs the HF
  safetensors (the local file is only the GGUF quant). One-time owner step.
- ⏳ **Train → convert → serve → register → measure** — steps below.

## Auto-watch (armed 2026-06-09)
A systemd timer polls for the gemma-3n approval every 20 min and, the moment HF access
is granted, auto-runs train → convert → smoke-test (stopping before prod-serve /
on-chain registration — those stay a human go):
- watcher: `scripts/lora/watch-and-train.sh`; units: `/etc/systemd/system/citrate-lora-watch.{service,timer}`
- log: `~/.citrate/lora/watch.log`; done marker: `~/.citrate/lora/.gemma-pipeline-done`
- the watcher self-disables once the GGUF adapter is built + smoke-tested, and logs the
  exact SERVE / REGISTER / MEASURE commands to finish.
Check progress: `tail ~/.citrate/lora/watch.log`. Disable: `sudo systemctl disable --now citrate-lora-watch.timer`.

## 1. Acquire base weights (owner, one-time)
Accept the license at https://huggingface.co/google/gemma-3n-E4B-it then:
```bash
huggingface-cli login          # HF token with access  (or export HF_TOKEN=hf_…)
```
(`gemma-4-E4B-it-Q4_K_M.gguf` we serve is a quant of this model.)

## 2. Build corpus + train (DGX)
```bash
cd citrate-explorer
npx tsx scripts/lora/build-corpus.ts
python3 scripts/lora/train_lora.py \
  --base google/gemma-3n-E4B-it \
  --data scripts/lora/corpus/citrate-sft.jsonl \
  --out  /home/saul/.citrate/lora/citrate-expert-v1
```
121 examples × 3 epochs on the GB10 is minutes, not hours.

## 3. Convert the adapter to GGUF + serve
```bash
python3 ~/llama.cpp/convert_lora_to_gguf.py /home/saul/.citrate/lora/citrate-expert-v1 \
  --base google/gemma-3n-E4B-it \
  --outfile /home/saul/.citrate/lora/citrate-expert-v1.gguf
# add to /etc/systemd/system/citrate-llama.service ExecStart:
#   --lora /home/saul/.citrate/lora/citrate-expert-v1.gguf
sudo systemctl daemon-reload && sudo systemctl restart citrate-llama.service
```
(llama-server also supports hot-loading via `--lora-init-without-apply` + the
`/lora-adapters` endpoint, for A/B without a restart.)

## 4. Register in LoRAFactory (on-chain dogfooding)
Register the adapter id in `LoRAFactory` (`0x6e564d22949992705b5de7108b2c68d3554d5863`)
so it's discoverable on-chain — the demonstration of Citrate's small-model + LoRA value
prop (a registered Citrate LoRA serving the flagship agent). Use the deployer/treasury
key from `.env.testnet`.

## 5. Measure the lift (eval-gated — X-8)
The eval runner tags every run with `{base_model, lora_id}`:
```bash
# base (no LoRA):
EVAL_BASE_URL=https://explorer.citrate.ai EVAL_RUNS=3 scripts/eval/run-eval.sh
# with the LoRA served, tag the run:
EVAL_LORA_ID=citrate-expert-v1 EVAL_RUNS=3 scripts/eval/run-eval.sh
```
Compare accuracy / tool-F1 / groundedness. The current base baseline is
**93.3% ± 5.0** (`scripts/eval/baselines/canonical.json`) — the LoRA must hold or beat
the hard gates (tool-F1, groundedness). Expected wins: better chain reasoning on
out-of-distribution queries + the ability to trim the system prompt (knowledge moves
into the weights), which also helps latency.

## Validated end-to-end (2026-06-09, on ungated Qwen2.5-1.5B)
While the gemma-3n gate is pending Google's manual approval, the whole pipeline was
proven on an ungated model: corpus → `train_lora.py` (peft, 18.5M LoRA params, loss
3.0→1.2, 53s on the GB10) → `convert_lora_to_gguf.py` → 73.9M GGUF adapter → served on a
temp `llama-server --lora` (prod :8181 untouched). The LoRA-loaded model answered a
Citrate fact the base model can't ("LoRAFactory — factory that creates LoRAs / LoRA
fine-tuning"), confirming knowledge transfer. So the gemma run is push-button on approval.

## Notes
- **GB10 memory quirk (important):** torch's CUDA allocator on the GB10 counts only
  truly-FREE RAM, not reclaimable page-cache — training OOMs at model load with tens of
  GB "available". `run_pipeline.sh` drops the cache first (`echo 3 > drop_caches`);
  `train_lora.py` sets `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` and avoids
  `device_map="auto"`.
- `convert_lora_to_gguf.py --base` needs a LOCAL base-model dir (the HF snapshot path),
  not a repo id — `run_pipeline.sh` resolves it via `snapshot_download`.
- Gemma-3n is a MatFormer/multimodal arch; if a `target_modules` name differs, adjust
  it in `train_lora.py` (peft will error with the valid module names).
- Keep the golden set OUT of training (the corpus generator enforces this). Re-run
  `build-corpus.ts` whenever the contract catalog (RA-5) changes so knowledge stays fresh.
