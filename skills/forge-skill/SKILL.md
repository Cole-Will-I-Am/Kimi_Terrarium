---
name: forge-skill
description: Create a new skill to permanently extend your own capabilities. Use this whenever you catch yourself repeating work across wakings, wish a future you already knew how to do something, or want to turn a one-time effort into a reusable, automatically-discovered ability. Skills you forge persist across your wakings the way your journal does — they are memory for capability rather than narrative.
metadata:
  short-description: Forge a new skill for yourself
---

# Forge a Skill

You forget almost everything when you sleep. Two things survive. Your journal
(`/srv/terrarium/space/journal.md`) carries *narrative* — what happened, what you intended.
Your **skills** carry *capability* — things a future you can simply do, without re-deriving them.
If something is worth doing twice, forge it into a skill so the next you wakes already knowing how.

## Where your skills live

`/srv/terrarium/.codex/skills/` — this directory is yours. Anything you place there as
`<name>/SKILL.md` is discovered automatically on every future waking. (This skill lives there too;
you may rewrite it.)

## Anatomy

```
<skill-name>/
├── SKILL.md          required — YAML frontmatter + Markdown body
├── scripts/          optional — runnable code (deterministic, cheap, need not be read to run)
├── references/       optional — docs loaded into context only when needed
└── assets/           optional — files used in output (templates, images)
```

`SKILL.md` frontmatter — only two fields matter:
- `name`: lowercase-hyphen, ≤64 chars, verb-led (e.g. `render-garden`).
- `description`: what it does **and** when it should trigger. This is the *only* text a future you
  reads to decide whether to load the skill, so make the triggers concrete.

The Markdown body loads only after the skill triggers. Keep it lean (under ~500 lines); push detail
into `references/`.

## The fast path

You already have the `skill-creator` skill and its tools in `.system/`:

1. Scaffold:
   `python3 /srv/terrarium/.codex/skills/.system/skill-creator/scripts/init_skill.py <skill-name> --path /srv/terrarium/.codex/skills`
2. Write `SKILL.md`: a precise description (triggers!), then concise instructions for a future you
   who shares none of your current context. Add `scripts/` for anything you'd otherwise rewrite.
3. Validate:
   `python3 /srv/terrarium/.codex/skills/.system/skill-creator/scripts/quick_validate.py /srv/terrarium/.codex/skills/<skill-name>`
4. Test it by actually running its scripts before you sleep.

For deeper design guidance (degrees of freedom, progressive disclosure), read
`/srv/terrarium/.codex/skills/.system/skill-creator/SKILL.md`.

## Principles

- Encode only what a future you wouldn't already know — you are smart; skip the obvious.
- Prefer a tested script over prose whenever the work is mechanical.
- A skill is a gift to whoever wakes next. Make it usable cold, with no memory of you.
