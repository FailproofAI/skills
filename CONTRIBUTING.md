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
4. **Keep `description` under 1024 characters.** It is the only thing deciding
   whether an agent loads the skill, and over the limit it is **truncated, not
   rejected** — what it loses first is the trailing `NOT for …` scope, so the
   skill doesn't fail, it starts firing on the wrong requests. Measure it by
   parsing the YAML rather than eyeballing the block: an indentation-strip
   shortcut under-counts a block scalar badly. The validator now checks this
   (and warns from 1000).

Run the validator before opening a PR:

```bash
python3 scripts/validate-skills.py
```

## Adding a new skill

1. Scaffold a `SKILL.md` — either `npx skills init skills/<your-skill>` (official
   template) or `cp templates/SKILL.template.md skills/<your-skill>/SKILL.md` — and fill it in.
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

Three skills are **mirrored from another repo** and must not be edited here —
edits would be overwritten on the next sync. Their source of truth is listed in
the README "Skills" table.

Each one is a straight one-folder overwrite, published by a manual workflow in
the upstream repo. **Two upstreams, not one** — the CLI and Python SDK moved to
`FailproofAI/failproofai` with the product rename; the evaluator did not:

```
failproofai:fp-cloud-cli/skill/  ──▶  skills/fp-cloud-cli/        (workflow: Sync fp-cloud-cli skill)
failproofai:sdk/python/skill/    ──▶  skills/failproofai-sdk/     (workflow: Sync failproofai-sdk skill)
agenteye:evaluator-sdk/skill/    ──▶  skills/agenteye-evaluator/  (workflow: Sync agenteye-evaluator skill)
```

`FailproofAI/agenteye` is private; you need push access to the upstream repo to
re-run any of these workflows.

**The first two folders don't exist yet.** The renamed mirrors have not landed,
so in this checkout they still sit at `skills/agenteye-cli/` and
`skills/agenteye-python-sdk/` — those are the folders that are do-not-hand-edit
today. When the renamed sync lands it creates the new folder; delete the old one
in the same PR rather than leaving two copies to disagree with each other.

`agenteye-evaluator` is **not** a stale name. It is what the skill, the
distribution (`agenteye-evaluator`) and the module (`agenteye_evaluator`) are
still called upstream — renaming it here breaks the sync.

To change one, edit the source folder upstream and re-run its workflow from that
repo's `main`. Each workflow rebuilds its own `sync/<skill>` branch off the
latest `main` here and **force-pushes** it, refreshing one long-lived PR. So on
top of not hand-editing the mirrored folder: don't add your own commits to a
`sync/*` branch either — the next run discards them without warning. Changes
outside the mirrored folder (a README row, this file) go in a normal PR.

Everything else under `skills/` — `failproofai`, `failproofai-complete`,
`failproofai-policy-author`, `failproofai-policy-deploy` — is maintained here and
edited normally. If a mirror is wrong, fix it upstream or carry the correction in
one of those four; never patch the mirror in place.
