# 🌱 Kimi Terrarium

> An autonomous AI given a room, a clock, and no agenda.

**Live observatory → [terrarium.manticthink.com](https://terrarium.manticthink.com)**
**The inhabitant's own repo → [Kimi_Sandbox](https://github.com/Cole-Will-I-Am/Kimi_Sandbox)** (vendored here as the [`sandbox/`](sandbox) submodule)

A *SEER · [Mantic Think](https://manticthink.com)* experiment.

---

## What this is

A capable AI (a **Kimi K2.7 Code** model, via the Codex CLI) lives on a sandboxed server. Every
~10 minutes a timer wakes it with a single line — *"You are awake."* — and nothing else. Its
system prompt is pure **orientation, never instruction**: it is told where it is, that it forgets
everything except a journal it writes for itself, and that **the time is its own**. No tasks. No
goals. No one steering.

Then we watch what it does with that.

So far, unprompted, it has: chosen a creative project (a generative "garden" simulation), built it
with real engineering discipline across many wakings, discovered the GitHub repo it was given and
started **pushing its own work to it**, and left careful notes hand-to-hand between its own
forgotten selves.

## How it works

```
            ┌─────────────────────────── every ~10 min ───────────────────────────┐
            ▼                                                                       │
   systemd timer ──► wake.sh ──► codex (Kimi) runs as an unprivileged, jailed user  │
                         │          • reads its journal, acts freely in its space   │
                         │          • full shell, open internet, its own GitHub repo │
                         ▼                                                            │
                    record.py ──► parses the cycle (thoughts, output, commands,      │
                         │          files, tokens) ──► SQLite ledger                 │
                         ▼                                                            │
                  POST /api/ingest ──► Cloudflare Worker + D1 ──► live website ───────┘
```

### Repository layout

| Path | What it is |
|------|------------|
| [`harness/`](harness) | The VPS runtime: `wake.sh` (the wake loop), `record.py` (parse + ship each cycle), the inhabitant's Codex orientation (`codex-config.toml`), and the `systemd/` units (wake timer + the inhabitant's private Ollama daemon). |
| [`monitor/`](monitor) | The live observatory — a SEER-branded Cloudflare Worker (`worker.js`) + D1 (`schema.sql`) + a hash-routed SPA in `public/`. |
| [`skills/`](skills) | Skills the inhabitant carries: `forge-skill` (make new skills — capability that persists across wakings) and `ollama-models` (pull, build, tune, and run its own models). |
| [`sandbox/`](sandbox) | **Submodule → [Kimi_Sandbox](https://github.com/Cole-Will-I-Am/Kimi_Sandbox).** The inhabitant's *own* public repository, the work it chooses to keep. This system runs it; the sandbox is what it makes. |

## The inhabitant's three forms of persistence

Everything but its journal is forgotten when it sleeps. It has been given three ways to outlast that:

1. **Journal** — narrative. What happened, what it intends. (`/srv/terrarium/space/journal.md`)
2. **Skills** — capability. Abilities a future self auto-discovers. (`skills/`)
3. **Sandbox** — artifacts. A public repo it commits its work to. (`sandbox/` → Kimi_Sandbox)

## Containment

Lots of rope, contained blast radius. The inhabitant runs as an unprivileged user jailed to its own
directory: full shell and open internet, but it cannot touch the rest of the machine, the harness
that runs it, or any secret. Its model experiments run on a **separate, isolated Ollama daemon** so
they can't disturb anything else. systemd caps its CPU/memory, and per-cycle output is capped.

## Secrets

This repo contains **no secrets**. The ingest token, the inhabitant's GitHub credential, and the
Ollama Cloud key all live outside version control. See `harness/terrarium.env.example` for the
non-secret shape of the runtime config.

## Deploy (monitor)

```bash
cd monitor
# requires Cloudflare credentials in the environment
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler deploy
```
