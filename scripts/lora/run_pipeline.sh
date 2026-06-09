#!/usr/bin/env bash
# run_pipeline.sh — one command: corpus → train → convert-to-GGUF → measure (RA-8).
#
# Run ON THE DGX (spark-2e01). Requires the HF-gated base weights:
#   1) accept the license: https://huggingface.co/google/gemma-3n-E4B-it
#   2) huggingface-cli login   (account saulloveman; a token is already cached)
# The pipeline aborts early with this instruction if access is still gated (403).
#
# After it builds the GGUF adapter it prints the serve + register + measure steps
# (those touch the live service / chain, so they're deliberately manual).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${LORA_BASE:-google/gemma-3n-E4B-it}"
OUT="${LORA_OUT:-/home/saul/.citrate/lora/citrate-expert-v1}"
GGUF_OUT="${OUT}.gguf"
LLAMA="${LLAMA_CPP:-/home/saul/llama.cpp}"

echo "== 0. preflight: HF access to ${BASE} =="
if ! python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('${BASE}','config.json')" 2>/dev/null; then
  cat >&2 <<EOF
BLOCKED: no access to ${BASE} (HF gated, 403).
Fix (one-time, owner): accept the license at https://huggingface.co/${BASE}
then 'huggingface-cli login' (account saulloveman). Re-run this script.
EOF
  exit 3
fi
echo "   access OK"

echo "== 1. build corpus =="
cd "${REPO_ROOT}"
npx tsx scripts/lora/build-corpus.ts

echo "== 2. train LoRA (peft, on the GB10) =="
python3 scripts/lora/train_lora.py --base "${BASE}" --data scripts/lora/corpus/citrate-sft.jsonl --out "${OUT}"

echo "== 3. convert adapter → GGUF =="
python3 "${LLAMA}/convert_lora_to_gguf.py" "${OUT}" --base "${BASE}" --outfile "${GGUF_OUT}"
echo "   wrote ${GGUF_OUT}"

cat <<EOF

== Next (manual — touches the live service / chain) ==
SERVE (hot-load A/B, no restart):
  curl -s http://100.68.173.64:8181/lora-adapters         # confirm slot
  # or add '--lora ${GGUF_OUT}' to /etc/systemd/system/citrate-llama.service and restart
REGISTER on-chain (dogfooding): record the adapter id in LoRAFactory
  0x6e564d22949992705b5de7108b2c68d3554d5863  (deployer/treasury key in .env.testnet)
MEASURE the lift (X-8 tag):
  EVAL_BASE_URL=https://explorer.citrate.ai EVAL_RUNS=3 scripts/eval/run-eval.sh                 # base
  EVAL_LORA_ID=citrate-expert-v1 EVAL_RUNS=3 scripts/eval/run-eval.sh                            # +LoRA
  # compare vs scripts/eval/baselines/canonical.json (93.3%±5.0); gate on tool-F1 + groundedness
EOF
