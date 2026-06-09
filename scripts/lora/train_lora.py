#!/usr/bin/env python3
"""
Citrate-expert LoRA SFT (RA-8) — peft + transformers on the DGX (GB10, CUDA).

Trains a LoRA adapter on the base Gemma model so the small model is fluent about
Citrate's own structure (the corpus from build-corpus.ts). Runs on the DGX where
torch+transformers+peft+accelerate are installed.

PREREQS (one-time, owner): the base model in HF format. gemma-3n-E4B is gated —
accept the license at https://huggingface.co/google/gemma-3n-E4B-it and:
    huggingface-cli login        # paste an HF token with access
    # or: export HF_TOKEN=hf_...
The GGUF we serve is a quant of that model; LoRA training needs the HF weights.

RUN:
    python3 scripts/lora/train_lora.py \
        --base google/gemma-3n-E4B-it \
        --data scripts/lora/corpus/citrate-sft.jsonl \
        --out  /home/saul/.citrate/lora/citrate-expert-v1

Then convert + serve (see scripts/lora/README.md):
    python3 ~/llama.cpp/convert_lora_to_gguf.py <out> --base <base> --outfile citrate-expert-v1.gguf
    # add to citrate-llama.service:  --lora /home/saul/.citrate/lora/citrate-expert-v1.gguf
"""
import argparse, json, os

def load_chat(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="google/gemma-3n-E4B-it")
    ap.add_argument("--data", default="scripts/lora/corpus/citrate-sft.jsonl")
    ap.add_argument("--out", default="/home/saul/.citrate/lora/citrate-expert-v1")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=2048)
    args = ap.parse_args()

    # GB10 unified memory reports N/A to nvidia-smi, which trips torch's allocator into
    # spurious OOMs; expandable segments + explicit single-device placement avoid it.
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    import torch
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig, get_peft_model

    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    rows = load_chat(args.data)
    print(f"corpus: {len(rows)} examples")

    def fmt(ex):
        # Render with the model's own chat template, then mask the prompt so loss is
        # only on the assistant turn.
        msgs = ex["messages"]
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        enc = tok(text, truncation=True, max_length=args.max_len, padding=False)
        enc["labels"] = enc["input_ids"].copy()
        return enc

    ds = Dataset.from_list(rows).map(fmt, remove_columns=["messages"])

    # Load to a single device explicitly (no device_map="auto" — it misreads the GB10's
    # N/A memory and pre-reserves badly). bf16, gradient checkpointing for a low peak.
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16)
    model.to("cuda")
    model.gradient_checkpointing_enable()
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        # Gemma attention/MLP projections; adjust if a Gemma-3n submodule name differs.
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    ))
    model.print_trainable_parameters()

    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=args.out, num_train_epochs=args.epochs, per_device_train_batch_size=1,
            gradient_accumulation_steps=8, learning_rate=args.lr, lr_scheduler_type="cosine",
            warmup_ratio=0.03, logging_steps=10, save_strategy="epoch", bf16=True, report_to=[],
            gradient_checkpointing=True, optim="adamw_torch",
        ),
        train_dataset=ds,
        data_collator=DataCollatorForLanguageModeling(tok, mlm=False),
    )
    trainer.train()
    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    print(f"saved LoRA adapter → {args.out}")

if __name__ == "__main__":
    main()
