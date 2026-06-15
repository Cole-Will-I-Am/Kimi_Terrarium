# Modelfile reference

A Modelfile is a recipe for building or customizing a model with `ollama create <name> -f Modelfile`.
Read top-to-bottom; instructions are applied in order.

## Instructions

| Instruction | Purpose |
|-------------|---------|
| `FROM <model\|path>` | **Required.** Base to build on: an existing model (`qwen2.5:0.5b`, a `:cloud` model, or one you already made), a local GGUF file (`FROM ./model.gguf`), or a Safetensors dir. |
| `SYSTEM "..."` | The system prompt — the model's persona and standing instructions. |
| `PARAMETER <k> <v>` | A default runtime parameter (see table below). Repeatable. |
| `TEMPLATE "..."` | The full prompt template (Go template syntax) controlling how system/user/assistant turns are rendered. Only override if you know the model's expected format. |
| `MESSAGE <role> "..."` | Seed conversation turns (`role` = system/user/assistant) — few-shot priming baked into the model. Repeatable. |
| `ADAPTER <path>` | Apply a LoRA/QLoRA adapter (GGUF or Safetensors) on top of `FROM`. This is how you use fine-tuned adapters. |
| `LICENSE "..."` | Embed a license string. |

## Common PARAMETERs

| Parameter | Meaning | Typical |
|-----------|---------|---------|
| `temperature` | Randomness. Lower = focused, higher = creative. | 0.0–1.5 |
| `top_p` | Nucleus sampling cutoff. | 0.9 |
| `top_k` | Sample from top-k tokens. | 40 |
| `repeat_penalty` | Penalize repetition. | 1.1 |
| `num_ctx` | Context window (tokens). Bigger = more memory, more RAM. | 2048–32768 |
| `num_predict` | Max tokens to generate (-1 = unbounded). | 128–4096 |
| `seed` | Fix for reproducible output. | any int |
| `stop` | A stop string; repeat for several. | `"</end>"` |

## Patterns

**Layering** — build on your own customized model to stack changes:
```
FROM mossback
PARAMETER temperature 0.2
```

**Import external GGUF weights** (e.g. something you downloaded or converted):
```
FROM ./my-model-Q4_K_M.gguf
PARAMETER num_ctx 8192
```

**Attach a fine-tuned adapter** (true tuning, if you produce a LoRA):
```
FROM llama3.2
ADAPTER ./my-lora-adapter
```

## Inspect & manage
```bash
ollama show <model>            # see its Modelfile, params, template
ollama show <model> --modelfile
ollama cp <src> <dst>          # copy/rename
ollama rm <model>              # delete from your store
```

## Notes
- `ollama create` from a base you already have is fast and cheap (no re-download).
- For true weight fine-tuning you'd train a LoRA elsewhere (e.g. with unsloth/peft on the open
  internet or a colab), export GGUF/adapter, then bring it in via `FROM ./x.gguf` or `ADAPTER`.
- Quantization on import: append a quantize flag, e.g. `ollama create name -f Modelfile -q q4_K_M`,
  to shrink imported fp16 weights.
- Everything you create lives only in your daemon's store (`/srv/terrarium/ollama/models`) and
  survives across wakings.
