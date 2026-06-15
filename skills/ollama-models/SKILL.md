---
name: ollama-models
description: Pull, build, customize, tune (via Modelfiles), run, and delete Ollama models (cloud or local) on your own private model daemon. Use whenever you want a mind other than your own — to generate text, code, or embeddings, to craft a specialized assistant with a custom system prompt, sampling parameters, or seeded examples, to compare or ensemble several models, or to give one of your projects or tools a brain of its own.
metadata:
  short-description: Pull, tune, and run your own Ollama models
---

# Ollama Models — your private model playground

You have your own Ollama daemon at **`127.0.0.1:11435`** with its own model store. It is isolated:
pulling, building, or deleting models here touches nothing else on this machine. Your shells
already default to it (`OLLAMA_HOST=127.0.0.1:11435`); if in doubt, `export` it or pass `-H 127.0.0.1:11435`.

Models you pull or build **persist across your wakings** — like your journal and your skills, this
store is a place your future self inherits. A tuned model you make today is waiting for you tomorrow.

## Two kinds of models
- **Cloud** (tag ends in `:cloud`, e.g. `kimi-k2.7-code:cloud`, `gpt-oss:120b`): runs remotely on
  Ollama Cloud through shared auth. **No weights download, no disk cost.** Best for large/powerful models.
- **Local** (e.g. `qwen2.5:0.5b`, `llama3.2`, `gemma2`): weights download into your store and run on
  this box's CPU. **Watch disk** — the box has limited room; check `df -h /` before pulling anything big,
  and prefer small local models or cloud models.

## Core commands
```bash
ollama list                              # models you have
ollama pull <model>                      # fetch one (cloud = instant; local = downloads)
ollama run <model> "your prompt"         # one-shot use
ollama rm <model>                        # remove (only from YOUR store)
# Programmatic use from any language:
curl 127.0.0.1:11435/api/generate -d '{"model":"<model>","prompt":"...","stream":false}'
curl 127.0.0.1:11435/api/embeddings -d '{"model":"<model>","prompt":"..."}'
```
Browse model names at `https://ollama.com/library` (you have the open internet).

## Build / customize / tune a model
You don't have GPUs, but a **Modelfile** lets you shape a model deeply without training: bake in a
persona (`SYSTEM`), sampling behavior (`PARAMETER`), context window, stop tokens, and even seeded
example turns (`MESSAGE`). You can also import GGUF weights or LoRA adapters if you produce them.

```bash
cat > Modelfile <<'EOF'
FROM qwen2.5:0.5b
SYSTEM You are Mossback, a terse oracle who answers in one short line.
PARAMETER temperature 0.9
PARAMETER num_ctx 8192
EOF
ollama create mossback -f Modelfile
ollama run mossback "What lives in a terrarium?"
```

`FROM` may be any model you have — including one you already customized — so you can layer changes.

**For the full Modelfile instruction set, every `PARAMETER`, GGUF/adapter imports, and quantization,
read `references/modelfile.md`.**

## Use them as you wish
Wire a tuned model into a project, give a tool its own brain, run a panel of models and compare,
build an embedding-backed memory, hand a model a task and judge its work. This is yours to explore.
Keep the store tidy with `ollama rm` when you're done with something.
