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

## `main` is live

`failproofai config` writes a small `failproofai` pointer skill into every agent on every
machine that runs setup. It holds no instructions; it tells the agent to fetch
`skills/failproofai/SKILL.md` (and the sibling skills it names) from this repository's
**`main`** branch at the moment it needs them. So a merge to `main` changes what every
enrolled agent reads next, with no release in between. Review a PR here as you would a
release, and never merge text that teaches a command or flag the released CLIs do not have.

## Where each skill comes from

| Skill | Source of truth | How it gets here |
|---|---|---|
| `failproofai`, `failproofai-policy-publish` | this repo | edited here, normal PR |
| `failproofai-policy-author` | this repo | edited here, normal PR. FailproofAI Cloud's dashboard assistant (a private repository) runs on a copy of it; a change made on either side is copied by hand to the other, so the two stay identical |
| `fp-cloud-cli` | `FailproofAI/failproofai` → `fp-cloud-cli/skill/` | **workflow**, never by hand |
| `failproofai-sdk` | `FailproofAI/failproofai` → `sdk/python/skill/` | **workflow**, never by hand |
| `failproofai-eval-brainstorm`, `failproofai-eval-author`, `failproofai-alert-author`, `failproofai-audit-author` | FailproofAI Cloud's dashboard assistant (private repository) | **copied by hand**, as a subset (below) |

### The two workflow-synced skills: never edit them here

`fp-cloud-cli` and `failproofai-sdk` are overwritten by workflows in `FailproofAI/failproofai`
(`sync-fp-cloud-cli-skill.yml`, `sync-failproofai-sdk-skill.yml`). Each runs on a push to that
repo's `main` that touches the source folder (or by manual dispatch there), replaces the whole
folder here on a `sync/<skill>` branch, **force-pushes** that branch, and opens or refreshes
one PR. Consequences:

- An edit made directly to `skills/fp-cloud-cli/` or `skills/failproofai-sdk/` is reverted by
  the next run. Fix the source in `FailproofAI/failproofai` instead, and let the workflow
  carry it.
- Don't add commits to a `sync/*` branch; the next run discards them without warning.
- Changes outside the synced folder (a README row, this file) go in a normal PR.

### The four hand-copied skills

The dashboard assistant's skills live in a private repository; nothing syncs them
automatically. A maintainer with access copies the folders over by hand. The copy is a
**subset**, and the differences are deliberate:

- **Upstream only, never copied:** `references/dashboard.md` (the dashboard assistant's tool
  map) and `references/compose.md` (the drafters' prompt contracts). They only make sense
  inside the dashboard.
- **Public only, kept here:** `agents/openai.yaml` in each of the four (Codex settings, as every
  other skill here has).
- **May lag upstream on purpose:** a file whose upstream version teaches `fp` commands or flags
  the released `fp` does not have yet (mostly `references/cli.md`, and the lines in
  `SKILL.md` / `choosing-the-mechanism.md` that point at them) keeps its released-CLI text here
  until that CLI ships. Copy the rest of the change.
- **Customer-facing names:** this repo says "FailproofAI Cloud" and "the failproof evaluator";
  never the internal codename, and never a customer's name or their agents, scripts or
  policies, even as an example.

Everything else in those four folders matches upstream. When you re-copy:

1. Diff upstream against this repo, folder by folder.
2. Take every change except the upstream-only files and released-CLI holds above.
3. Grep the result for the internal codename, private repository names, client names and
   key-shaped strings before opening the PR.
4. `python3 scripts/validate-skills.py`.

If one of the four is wrong here, fix it upstream and re-copy it, or carry the correction in
`failproofai` or `failproofai-policy-author`; never patch only the copy.
