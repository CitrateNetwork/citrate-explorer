#!/usr/bin/env bash
# watch-and-train.sh — poll for gemma-3n HF approval; on grant, auto-run the Citrate
# LoRA pipeline (train → convert → smoke-test). Driven by citrate-lora-watch.timer.
#
# Deliberately stops BEFORE prod-serve (restart) and on-chain registration — those
# touch the live service / chain and should be a human go. It leaves the GGUF adapter
# ready + smoke-tested and logs the exact final steps. Self-disables when done.
#
# Idempotent: a DONE marker short-circuits future ticks.
set -uo pipefail

REPO=/home/saul/Projects/Citrate-Labs/citrate-explorer
PY=/home/saul/.pyenv/versions/3.12.8/bin/python3
BASE=google/gemma-3n-E4B-it
OUT=/home/saul/.citrate/lora/citrate-expert-gemma-v1
PROD_GGUF=/home/saul/.citrate/models/gemma-4-E4B-it-Q4_K_M.gguf
DONE=/home/saul/.citrate/lora/.gemma-pipeline-done
LOG=/home/saul/.citrate/lora/watch.log
mkdir -p /home/saul/.citrate/lora
exec >>"$LOG" 2>&1

stamp() { date -u +%FT%TZ; }
echo "[$(stamp)] tick"

[ -f "$DONE" ] && { echo "  already done; disabling timer"; sudo systemctl disable --now citrate-lora-watch.timer 2>/dev/null; exit 0; }

# 1. access check
if ! "$PY" -c "from huggingface_hub import hf_hub_download; hf_hub_download('$BASE','config.json')" 2>/dev/null; then
  echo "  still gated (403) — will retry next tick"; exit 0
fi
echo "  ACCESS GRANTED — running the gemma LoRA pipeline"

# 2. free page cache (GB10 unified-memory: torch counts only truly-free RAM)
sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null || true

# 3. corpus (regenerate if node is around; else use the committed/on-disk one)
cd "$REPO" || exit 1
if [ -x /snap/bin/node ]; then PATH=/snap/bin:$PATH npx tsx scripts/lora/build-corpus.ts || true; fi
[ -f scripts/lora/corpus/citrate-sft.jsonl ] || { echo "  ERROR: no corpus"; exit 1; }

# 4. train → convert
echo "  [$(stamp)] training…"
if ! PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True "$PY" scripts/lora/train_lora.py \
      --base "$BASE" --data scripts/lora/corpus/citrate-sft.jsonl --out "$OUT" --epochs 3; then
  echo "  TRAIN FAILED — leaving timer enabled to retry"; exit 1
fi
BASE_DIR="$("$PY" -c "from huggingface_hub import snapshot_download; print(snapshot_download('$BASE', allow_patterns=['*.json','*.safetensors','*.txt','*.model']))" 2>/dev/null)"
echo "  [$(stamp)] converting…"
if ! "$PY" /home/saul/llama.cpp/convert_lora_to_gguf.py "$OUT" --base "$BASE_DIR" --outfile "$OUT.gguf"; then
  echo "  CONVERT FAILED — leaving timer enabled to retry"; exit 1
fi

# 5. smoke-test on a TEMP port (prod :8181 untouched)
echo "  [$(stamp)] smoke-test on :8182"
/home/saul/llama.cpp/build/bin/llama-server --model "$PROD_GGUF" --lora "$OUT.gguf" \
  --host 127.0.0.1 --port 8182 --n-gpu-layers 99 --ctx-size 4096 >/tmp/gemma_lora_serve.log 2>&1 &
SV=$!; sleep 30
curl -s --max-time 45 http://127.0.0.1:8182/v1/chat/completions -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"On Citrate, what does the InferenceRouter do?"}],"max_tokens":120}' \
  | "$PY" -c "import sys,json;print('  SMOKE:',json.load(sys.stdin)['choices'][0]['message']['content'][:300])" 2>&1 || echo "  smoke parse failed"
kill $SV 2>/dev/null

# 6. done — leave the deliberate steps for a human
touch "$DONE"
cat <<EOF
  [$(stamp)] DONE. Gemma Citrate-expert LoRA ready: $OUT.gguf
  Final (deliberate) steps:
    SERVE:    add '--lora $OUT.gguf' to /etc/systemd/system/citrate-llama.service ExecStart, daemon-reload + restart
    REGISTER: record the adapter id in LoRAFactory 0x6e564d22949992705b5de7108b2c68d3554d5863 (deployer key)
    MEASURE:  EVAL_BASE_URL=https://explorer.citrate.ai EVAL_LORA_ID=citrate-expert-gemma-v1 EVAL_RUNS=3 scripts/eval/run-eval.sh
EOF
sudo systemctl disable --now citrate-lora-watch.timer 2>/dev/null
echo "  timer disabled."
