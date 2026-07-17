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

| Skill | What it does | Source of truth |
|---|---|---|
| [`agenteye-cli`](skills/agenteye-cli/) | Operate an AgentEye deployment from the terminal via the `agenteye` CLI - inspect telemetry (errors, sessions, events, evals), triage alerts/incidents, manage keys/users/settings, run queries. | Synced from `FailproofAI/agenteye` → `cli/skill/` (private). Do **not** hand-edit here. |
| [`agenteye-evaluator`](skills/agenteye-evaluator/) | Put automatic quality scores on an agent's production runs - decide which dimensions are worth scoring from real sessions, scaffold the scoring service with the `agenteye-evaluator` Python SDK, score with rules or an LLM judge, test it against a captured session, deploy it and confirm scores land. | Synced from `FailproofAI/agenteye` → `evaluator-sdk/skill/` (private). Do **not** hand-edit here. |
| [`agenteye-python-sdk`](skills/agenteye-python-sdk/) | Make an AI agent report what it did - plan which points in the agent loop to record, write the instrumentation with the `agenteye` Python SDK, thread session/agent identity through it, and verify the events actually land. | Synced from `FailproofAI/agenteye` → `python-sdk/skill/` (private). Do **not** hand-edit here. |

## Install

Using the [`skills`](https://skills.sh) CLI (`vercel-labs/skills`). It auto-detects
your agent(s); pass `-a` to be explicit.

```bash
# the whole collection (project-local → ./.agents/skills/)
npx skills add FailproofAI/skills

# just one skill
npx skills add FailproofAI/skills --skill skillname

# explicitly for claude-code
npx skills add FailproofAI/skills -a claude-code

# just ONE skill - use the --skill flag (NOT a /agenteye-cli path segment)
npx skills add FailproofAI/skills --skill agenteye-cli -a claude-code

# global (all projects → ~/.claude/skills/), with real copies instead of symlinks
npx skills add FailproofAI/skills --skill agenteye-cli -a claude-code -g --copy

# Codex instead
npx skills add FailproofAI/skills --skill agenteye-cli -a codex
```

Or point straight at the skill folder by URL:
`npx skills add https://github.com/FailproofAI/skills/tree/main/skills/agenteye-cli -a claude-code`

Inspect / verify / manage:
```bash
npx skills add FailproofAI/skills --list   # list skills in the repo (no install)
npx skills list -a claude-code             # what's installed (alias: ls)
npx skills update agenteye-cli             # update an installed skill
npx skills remove agenteye-cli             # remove it
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
> need auth or an internal mirror. (All three skills' content is scrubbed
> safe-for-public — that is a standing requirement of the sync, not a one-off.)

### Troubleshooting - "installed, but my agent doesn't see it"
- **Claude Code reads `.claude/skills/` (project) / `~/.claude/skills/` (global) - *not* `.agents/skills/`.** `.agents/skills/` is the vendor-neutral path other agents use (Codex project, Cursor, Gemini CLI, …) and where the symlink **canonical store** lives. If the skill only shows up under `~/.agents/skills/` and Claude Code ignores it, the per-agent symlink wasn't created or wasn't followed.
- **Fix:** re-install targeting the agent explicitly and forcing real copies:
  `npx skills add FailproofAI/skills --skill agenteye-cli -a claude-code -g --copy`
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
    ├── agenteye-cli/
    │   ├── SKILL.md
    │   ├── references/commands.md
    │   └── agents/openai.yaml
    ├── agenteye-evaluator/
    │   ├── SKILL.md
    │   ├── references/
    │   │   ├── scaffold.md
    │   │   ├── sdk-api.md
    │   │   └── session-data.md
    │   └── agents/openai.yaml
    └── agenteye-python-sdk/
        ├── SKILL.md
        ├── references/
        │   ├── events.md
        │   ├── install.md
        │   └── integration.md
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
