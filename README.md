<p align="center">
  <img src="assets/failproofai-full.svg" alt="FailproofAI" width="440" />
</p>

<p align="center">
  The FailproofAI org's collection of <strong>agent skills</strong> - reusable, cross-agent
  instruction sets that teach a coding agent how to do a specific job well.<br/>
  One repo, many skills, installable with <a href="https://skills.sh"><code>npx skills</code></a>.
</p>

## What's an agent skill?

A skill is a folder with a `SKILL.md` (YAML frontmatter: `name` + `description`,
then instructions). Agents load it when a task matches the description, so the
agent gains a specialized, repeatable capability without you re-explaining it.
The format is shared across agents, so one definition works everywhere.

## Skills in this collection

Choose one of two entry points:

- Install **`failproofai-master`** when an agent should receive the complete product context
  in one self-contained skill: local runtime, Cloud, SDK, policies, publishing, evaluator,
  setup, commands, terminology, and routing.
- Install **`failproofai`** when the agent mainly needs to set up, operate, or troubleshoot
  FailproofAI and can hand specialist work to separately installed skills.

The remaining skills are focused modules. Installing a focused skill does not automatically
install its siblings; installing the whole repository does.

| Skill | What it does | Source of truth |
|---|---|---|
| [`failproofai`](skills/failproofai/) | **Start here.** The way into the product - what FailproofAI is, setting a machine up from zero (local-only or cloud-connected), the `failproofaid` daemon, moving history in with backfill/flush/capture paths, installing hooks and policies across 12 agent CLIs, local vs cloud audits, fleet and org operations, upgrade/uninstall, and troubleshooting by symptom. Routes to the specialist skills below when one owns the job, and stands alone when they aren't installed. | Maintained here. Not synced from anywhere - edit in this repo. |
| [`failproofai-master`](skills/failproofai-master/) | The complete FailproofAI product context in **one self-contained skill**: local runtime and daemon, FailproofAI Cloud, Python SDK, policy authoring and GitHub pack publishing, evaluator, setup, commands, terminology, troubleshooting, and the sibling-skill directory. Give this to an agent that should understand the whole product without depending on the other skills being installed. | Maintained here. Not synced from anywhere - edit in this repo. |
| [`failproofai-policy-author`](skills/failproofai-policy-author/) | Turn what agents keep doing wrong into enforcement for [failproofai](https://github.com/FailproofAI/failproofai) - triage a `failproofai audit` or FailproofAI Cloud findings, convert a CLAUDE.md/AGENTS.md into policies, or take a plain complaint ("agents keep force-pushing") and enforce it. Checks the shipped builtins and their params before writing anything, since most requests are one line of config; knows which of the 12 supported agent CLIs actually enforce a given event, so it never ships a deny the harness discards; tests every policy it authors. | Maintained here. Not synced from anywhere - edit in this repo. |
| [`failproofai-policy-publish`](skills/failproofai-policy-publish/) | The publishing companion to policy authoring - take tested policies, build an installable pack, publish its release assets to GitHub with `failproofai publish`, preview it, and verify the consumer path with `failproofai policies add <owner>/<repo>`. Cloud fleet rollout remains part of `fp-cloud-cli`. | Maintained here. Not synced from anywhere - edit in this repo. |
| [`fp-cloud-cli`](skills/fp-cloud-cli/) | Operate FailproofAI Cloud with `fp`: inspect telemetry, evals and usage; triage issues and audits; manage keys, users, orgs, and settings; publish Cloud policy versions; deploy them to fleet machines; observe enforcement; promote or roll back. Global options go **before** the command: `fp --json sessions`, not `fp sessions --json`. | Synced from `FailproofAI/failproofai` → `fp-cloud-cli/skill/`. Do **not** hand-edit here. |
| [`failproofai-sdk`](skills/failproofai-sdk/) | Make an AI agent report what it did - plan which points in the agent loop to record, write the instrumentation with the `failproofai_sdk` Python module, thread session/agent identity through it, and verify the events actually land. For an agent loop that is **not** one of the 12 supported CLIs. | Synced from `FailproofAI/failproofai` → `sdk/python/skill/`. Do **not** hand-edit here. |
| [`agenteye-evaluator`](skills/agenteye-evaluator/) | Put automatic quality scores on an agent's production runs - decide which dimensions are worth scoring from real sessions, scaffold the scoring service with the `agenteye-evaluator` Python SDK, score with rules or an LLM judge, test it against a captured session, deploy it and confirm scores land. | Synced from `FailproofAI/agenteye` → `evaluator-sdk/skill/` (private). Do **not** hand-edit here. |

## Naming and compatibility

AgentEye was renamed to FailproofAI Cloud. Skill names now follow the current product and
package names, but runtime literals that existing software still consumes are deliberately
preserved. Do not mechanically replace `AgentEye` everywhere.

| Skill name | Folder | Was |
|---|---|---|
| `fp-cloud-cli` | `skills/fp-cloud-cli/` | `agenteye-cli` |
| `failproofai-sdk` | `skills/failproofai-sdk/` | `agenteye-python-sdk` |
| `agenteye-evaluator` | `skills/agenteye-evaluator/` | **unchanged** because the current distribution and import remain `agenteye-evaluator` and `agenteye_evaluator` |

The rename does not alter the `fp` or `failproofai` binaries, SDK behavior, Cloud API, saved
credentials, or policy format. It only changes which skill identifier new installations use.
An already-installed old skill keeps working, but updating it by its old repository name may
no longer resolve. Migrate it once:

```bash
npx skills remove agenteye-cli
npx skills add FailproofAI/skills --skill fp-cloud-cli -a claude-code

npx skills remove agenteye-python-sdk
npx skills add FailproofAI/skills --skill failproofai-sdk -a claude-code
```

Legacy wire and package literals such as `X-AgentEye-*`, `ae_session`, selected
`AGENTEYE_*` variables, `agenteye-evaluator`, and `agenteye_evaluator` remain documented where
they are still part of the running system.

## Install

Using the [`skills`](https://skills.sh) CLI (`vercel-labs/skills`). It auto-detects
your agent(s); pass `-a` to be explicit.

```bash
# Install every skill in this repository.
# The agent receives the master skill plus every focused specialist.
npx skills add FailproofAI/skills

# Install the complete product context as one self-contained skill.
npx skills add FailproofAI/skills --skill failproofai-master

# Install the setup/operations entry point only.
npx skills add FailproofAI/skills --skill failproofai

# Install one focused specialist.
npx skills add FailproofAI/skills --skill failproofai-policy-author
npx skills add FailproofAI/skills --skill failproofai-policy-publish
npx skills add FailproofAI/skills --skill fp-cloud-cli

# explicitly for claude-code
npx skills add FailproofAI/skills -a claude-code

# just ONE skill - use the --skill flag (NOT a /failproofai path segment)
npx skills add FailproofAI/skills --skill failproofai -a claude-code

# global (all projects → ~/.claude/skills/), with real copies instead of symlinks
npx skills add FailproofAI/skills --skill failproofai -a claude-code -g --copy

# Codex instead
npx skills add FailproofAI/skills --skill failproofai -a codex
```

Or point straight at the skill folder by URL:
`npx skills add https://github.com/FailproofAI/skills/tree/main/skills/failproofai -a claude-code`

Pass the skill name exactly as listed above. `npx skills add FailproofAI/skills --list` is
the authoritative list.

### What each install gives the agent

`npx skills add FailproofAI/skills --skill failproofai-master` installs one folder. That
folder contains its own complete product reference; it does not download or invoke the other
skills as hidden dependencies. Its directory tells the agent which focused skill to prefer
when those skills are also installed.

`npx skills add FailproofAI/skills` installs every discovered skill in the repository. The
agent can then route a task to the narrowest matching skill—for example authoring with
`failproofai-policy-author`, publishing the resulting GitHub pack with
`failproofai-policy-publish`, and operating Cloud fleet rollout with `fp-cloud-cli`.

Installing a skill teaches the agent how to work with FailproofAI. It does not silently
install product binaries, sign into Cloud, publish releases, change fleet policy, or mutate a
user's machine. Those actions happen only when the user requests them and the selected skill's
workflow calls for them.

Inspect / verify / manage:
```bash
npx skills add FailproofAI/skills --list   # list skills in the repo (no install)
npx skills list -a claude-code             # what's installed (alias: ls)
npx skills update failproofai              # update an installed skill
npx skills remove failproofai              # remove it
```

### Scope & install method
| Scope | Flag | Where it lands (Claude Code) |
|---|---|---|
| Project (default) | _(none)_ | `./.claude/skills/` - commit with your project |
| Global | `-g` | `~/.claude/skills/` - across all projects |

By default the CLI **symlinks** each agent's skills dir to one canonical copy
(easy updates). If your environment doesn't follow symlinks, add **`--copy`** for
independent real copies.

> **Public-repo note:** for anyone outside the org to `npx skills add
> FailproofAI/skills`, this repo must be **public**. If it stays private, installs
> need auth or an internal mirror. (All synced skills' content is scrubbed
> safe-for-public — that is a standing requirement of the sync, not a one-off.)

### Troubleshooting - "installed, but my agent doesn't see it"
- **Claude Code reads `.claude/skills/` (project) / `~/.claude/skills/` (global) - *not* `.agents/skills/`.** `.agents/skills/` is the vendor-neutral path other agents use (Codex project, Cursor, Gemini CLI, …) and where the symlink **canonical store** lives. If the skill only shows up under `~/.agents/skills/` and Claude Code ignores it, the per-agent symlink wasn't created or wasn't followed.
- **Fix:** re-install targeting the agent explicitly and forcing real copies:
  `npx skills add FailproofAI/skills --skill failproofai -a claude-code -g --copy`
- **Verify with the CLI, not by eyeballing dirs:** `npx skills list -a claude-code`.
- **Codex paths:** project `.agents/skills/`, global `~/.codex/skills/`.

## Layout

```
skills/                         ← this repo
├── README.md
├── LICENSE
├── CONTRIBUTING.md             ← conventions + how to add a skill
├── assets/                     ← banner for this README
├── templates/SKILL.template.md ← starter for a new skill (or use `npx skills init`)
├── scripts/validate-skills.py  ← frontmatter/layout validator (run before merge)
└── skills/                     ← one self-contained folder per skill
    ├── failproofai/             ← the umbrella: start here
    │   ├── SKILL.md
    │   ├── references/          ← concepts · setup · transfer · daemon · policies
    │   │                           harnesses · audits · sessions · cloud · cli
    │   │                           troubleshooting
    │   └── agents/openai.yaml
    ├── failproofai-master/      ← the whole product, one artifact
    │   ├── SKILL.md
    │   ├── references/          ← commands · verticals · setup · directory
    │   │                           env-vars · literals · glossary
    │   └── agents/openai.yaml
    ├── failproofai-policy-author/
    │   ├── SKILL.md
    │   ├── references/          ← api · builtins · cloud · harnesses · patterns
    │   │                           rules-files · traps
    │   ├── scripts/             ← runnable helpers (test a policy, sync a reference)
    │   └── agents/openai.yaml
    ├── failproofai-policy-publish/
    │   ├── SKILL.md
    │   ├── references/          ← publishing and policy-pack semantics
    │   └── agents/openai.yaml
    ├── fp-cloud-cli/            ← mirror · Cloud CLI
    │   ├── SKILL.md
    │   ├── references/commands.md
    │   └── agents/openai.yaml
    ├── failproofai-sdk/         ← mirror · Python SDK
    │   ├── SKILL.md
    │   ├── references/          ← events · install · integration
    │   └── agents/openai.yaml
    └── agenteye-evaluator/      ← mirror · name unchanged upstream
        ├── SKILL.md
        ├── references/          ← brainstorm · scaffold · sdk-api · session-data
        └── agents/openai.yaml
```

Each skill folder is **self-contained**: its references/scripts/assets live inside
`skills/<name>/` and use relative paths, because the installer copies the whole
folder and nothing outside it. See **[CONTRIBUTING.md](CONTRIBUTING.md)** to add
or update a skill.

## Telemetry & license

`npx skills` sends anonymous usage telemetry (and transmits skill files for a
public repo); disable with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` (auto-off in CI).

License: see [`LICENSE`](LICENSE) - _placeholder; to be finalized before public release._
