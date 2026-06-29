<p align="center">
  <img src="assets/failproofai-full.svg" alt="FailproofAI" width="440" />
</p>

<h1 align="center">FailproofAI Skills</h1>

<p align="center">
  The FailproofAI org's collection of <strong>agent skills</strong> — reusable, cross-agent
  instruction sets that teach a coding agent how to do a specific job well.<br/>
  One repo, many skills, installable with <a href="https://skills.sh"><code>npx skills</code></a>.
</p>

## Supported agent CLIs

Skills here use the shared `SKILL.md` format, so one repo feeds many agents. A few of them:

<p align="center">
  <a href="https://claude.com/claude-code" title="Claude Code">
    <img src="assets/logos/claude.svg" alt="Claude Code" width="64" height="64" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://developers.openai.com/codex" title="OpenAI Codex">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/openai-dark.svg" />
      <img src="assets/logos/openai-light.svg" alt="OpenAI Codex" width="64" height="64" />
    </picture>
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks" title="GitHub Copilot CLI">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/copilot-dark.svg" />
      <img src="assets/logos/copilot-light.svg" alt="GitHub Copilot" width="64" height="64" />
    </picture>
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://cursor.com/docs/hooks" title="Cursor Agent CLI">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/cursor-dark.svg" />
      <img src="assets/logos/cursor-light.svg" alt="Cursor Agent" width="64" height="64" />
    </picture>
  </a>
</p>
<p align="center">
  <a href="https://opencode.ai/docs/plugins/" title="OpenCode">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/opencode-dark.svg" />
      <img src="assets/logos/opencode-light.svg" alt="OpenCode" width="64" height="64" />
    </picture>
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://pi.dev" title="Pi (pi-coding-agent)">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/pi-dark.svg" />
      <img src="assets/logos/pi-light.svg" alt="Pi" width="64" height="64" />
    </picture>
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://geminicli.com/" title="Gemini CLI">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logos/gemini-dark.svg" />
      <img src="assets/logos/gemini-light.svg" alt="Gemini CLI" width="64" height="64" />
    </picture>
  </a>
</p>

<p align="center"><sub>…and 60+ more via <a href="https://skills.sh"><code>npx skills</code></a> (`-a &lt;agent&gt;`).</sub></p>

## What's an agent skill?

A skill is a folder with a `SKILL.md` (YAML frontmatter: `name` + `description`,
then instructions). Agents load it when a task matches the description — so the
agent gains a specialized, repeatable capability without you re-explaining it.
The format is shared across agents, so one definition works everywhere.

## Skills in this collection

| Skill | What it does | Source of truth |
|---|---|---|
| [`agenteye-cli`](skills/agenteye-cli/) | Operate an AgentEye deployment from the terminal via the `agenteye` CLI — inspect telemetry (errors, sessions, events, evals), triage alerts/incidents, manage keys/users/settings, run queries. | Synced from `FailproofAI/agenteye` → `cli/skill/skills/agenteye-cli/` (private). Do **not** hand-edit here. |

## Install

Using the [`skills`](https://skills.sh) CLI (`vercel-labs/skills`). It auto-detects
your agent(s); pass `-a` to be explicit.

```bash
# the whole collection (project-local → ./.claude/skills/)
npx skills add FailproofAI/skills -a claude-code

# just ONE skill — use the --skill flag (NOT a /agenteye-cli path segment)
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
| Project (default) | _(none)_ | `./.claude/skills/` — commit with your project |
| Global | `-g` | `~/.claude/skills/` — across all projects |

By default the CLI **symlinks** each agent's skills dir to one canonical copy
(easy updates). If your environment doesn't follow symlinks, add **`--copy`** for
independent real copies.

> **Public-repo note:** for anyone outside the org to `npx skills add
> FailproofAI/skills`, this repo must be **public**. If it stays private, installs
> need auth or an internal mirror. (The `agenteye-cli` content is already scrubbed
> safe-for-public.)

### Troubleshooting — "installed, but my agent doesn't see it"
- **Claude Code reads `.claude/skills/` (project) / `~/.claude/skills/` (global) — *not* `.agents/skills/`.** `.agents/skills/` is the vendor-neutral path other agents use (Codex project, Cursor, Gemini CLI, …) and where the symlink **canonical store** lives. If the skill only shows up under `~/.agents/skills/` and Claude Code ignores it, the per-agent symlink wasn't created or wasn't followed.
- **Fix:** re-install targeting the agent explicitly and forcing real copies —
  `npx skills add FailproofAI/skills --skill agenteye-cli -a claude-code -g --copy`
- **Verify with the CLI, not by eyeballing dirs:** `npx skills list -a claude-code`.
- **Codex paths:** project `.agents/skills/`, global `~/.codex/skills/`.

## Layout

```
skills/                         ← this repo
├── README.md
├── LICENSE
├── CONTRIBUTING.md             ← conventions + how to add a skill
├── assets/                     ← banner + per-agent logos for this README
├── templates/SKILL.md          ← starter for a new skill (or use `npx skills init`)
├── scripts/validate-skills.py  ← frontmatter/layout validator (run before merge)
└── skills/                     ← one self-contained folder per skill
    └── agenteye-cli/
        ├── SKILL.md
        ├── references/commands.md
        └── agents/openai.yaml
```

Each skill folder is **self-contained**: its references/scripts/assets live inside
`skills/<name>/` and use relative paths, because the installer copies the whole
folder and nothing outside it. See **[CONTRIBUTING.md](CONTRIBUTING.md)** to add
or update a skill.

## Telemetry & license

`npx skills` sends anonymous usage telemetry (and transmits skill files for a
public repo); disable with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` (auto-off in CI).

License: see [`LICENSE`](LICENSE) — _placeholder; to be finalized before public release._
