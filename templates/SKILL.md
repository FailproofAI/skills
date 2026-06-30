<!-- TEMPLATE — not a loadable skill -->
---
name: my-skill
description: >-
  One or two sentences on WHAT this skill does and exactly WHEN to use it —
  this is the primary trigger signal, so name concrete situations/phrases.
  Add a "NOT for …" clause naming the near-misses it should avoid, so it
  doesn't fire on adjacent-but-different tasks.
---

# My Skill

Briefly: what this skill operates on and how. Keep the body under ~500 lines;
push exhaustive detail into `references/` and point to it from here.

## When to use / not use
- Use when: …
- Don't use for: …

## How to do the task
1. …
2. …

## Conventions / contract
- …

> Layout reminder: keep `SKILL.md` at `skills/<name>/SKILL.md`, put supporting
> files in `references/` · `scripts/` · `assets/` INSIDE this folder, and
> reference them with relative paths. Optional `agents/openai.yaml` tunes Codex.
