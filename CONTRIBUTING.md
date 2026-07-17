# Contributing skills

This repo is a **collection**: one self-contained skill per folder under
`skills/`. Get the conventions right or an agent will silently skip the skill.

## The rules (so nothing silently breaks)

1. **One folder per skill — we standardize on the flat layout**
   `skills/<name>/SKILL.md`. (The `npx skills` CLI also discovers a one-level
   catalog layout `skills/<category>/<name>/SKILL.md`, and a shallower `SKILL.md`
   shadows nested ones — but keep it flat here unless we deliberately adopt
   categories. Anything deeper than that isn't found without `--full-depth`,
   which is the most common reason a skill silently doesn't load.)
2. **Valid frontmatter, at the very top.** `SKILL.md` must start with `---` on
   line 1 (no blank line or content before it) and define both `name` and
   `description`. A missing/!malformed frontmatter block = silently skipped.
   The skill's identity comes from the `name:` field, not the folder name —
   **keep them matching** to avoid confusion.
3. **Self-contained.** All of a skill's `references/`, `scripts/`, `assets/`
   live inside its own folder and are referenced by relative paths. The
   installer copies the whole folder and nothing outside it — a shared file at
   repo root won't travel. If two skills need the same doc, each gets its own
   copy.

Run the validator before opening a PR:

```bash
python3 scripts/validate-skills.py
```

## Adding a new skill

1. Scaffold a `SKILL.md` — either `npx skills init skills/<your-skill>` (official
   template) or `cp templates/SKILL.md skills/<your-skill>/SKILL.md` — and fill it in.
2. Add any `references/` / `scripts/` / `assets/` **inside** `skills/<your-skill>/`.
3. `python3 scripts/validate-skills.py` until clean.
4. Add a row to the README "Skills" table.
5. Open a PR.

### Staging a work-in-progress skill

To land a skill in the repo without it showing up in normal discovery, add
`metadata.internal: true` to its frontmatter — it's then only listed/installable
with `INSTALL_INTERNAL_SKILLS=1`:

```yaml
---
name: my-wip-skill
description: …
metadata:
  internal: true
---
```

## Synced skills (don't hand-edit these)

Some skills are **mirrored from another repo** and must not be edited here —
edits would be overwritten on the next sync. Their source of truth is listed in
the README "Skills" table.

Each one is a straight one-folder overwrite out of `FailproofAI/agenteye`
(private), published by a manual workflow there:

```
agenteye:cli/skill/            ──▶  skills/agenteye-cli/        (workflow: Sync agenteye-cli skill)
agenteye:evaluator-sdk/skill/  ──▶  skills/agenteye-evaluator/  (workflow: Sync agenteye-evaluator skill)
```

To change one, edit the source folder in agenteye and re-run its workflow from
agenteye `main`. Each workflow rebuilds its own `sync/<skill>` branch off the
latest `main` here and **force-pushes** it, refreshing one long-lived PR. So on
top of not hand-editing the mirrored folder: don't add your own commits to a
`sync/*` branch either — the next run discards them without warning. Changes
outside the mirrored folder (a README row, this file) go in a normal PR.
