# The twelve harnesses, from the operator's side

SKILL.md gives you the install command. This file gives you the twelve identities, the
exact file each install touches, how detection decides what exists, and a summary of what
a `deny` actually stops. For the traced per-event enforcement matrix, go to the
`failproofai-policy-author` skill's generated `references/harnesses.md` — it is produced
from source by `scripts/sync-harnesses.mjs` and must not be re-derived here.

Anchors are grep targets inside the `failproofai` package: `src/hooks/types.ts`,
`src/hooks/integrations.ts`, `src/hooks/manager.ts`, `src/hooks/enforcement-capability.ts`,
`bin/failproofai.mjs`.

## What each one is called

The `--cli` value is the **integration id**, never the binary name. Two of them differ.

| `--cli` id | Display name | Binary probed on PATH |
|---|---|---|
| `claude` | Claude Code | `claude`, or `claude-code` |
| `codex` | OpenAI Codex | `codex` |
| `copilot` | GitHub Copilot | `copilot` |
| `cursor` | Cursor Agent | `cursor-agent`, or bare `agent` |
| `opencode` | OpenCode | `opencode` |
| `pi` | Pi | `pi` |
| `hermes` | Hermes | `hermes` |
| `openclaw` | OpenClaw | `openclaw` |
| `factory` | Factory Droid | **`droid`** |
| `devin` | Devin CLI | `devin` |
| `antigravity` | Antigravity CLI | **`agy`** |
| `goose` | Goose | `goose` |

`--cli droid` and `--cli agy` DO error when they are the only value given — a lone unknown id consumes zero values, so the parser throws `Missing value(s) for --cli`. Only when a known id comes first (`--cli claude droid`) is the unknown token not a `--cli` error. `--cli` consumes values greedily
and **stops at the first token that is not a known id** (`bin/failproofai.mjs`, grep
`VALID_CLIS`, then `if (!VALID_CLIS.has(v)) break`), so the unknown token falls through to
the positional policy-name parser and fails later with an unrelated "unknown policy" error.
Only a `--cli` that consumed *zero* values throws a `--cli` error.

`INTEGRATION_TYPES` (`types.ts`) is the source of truth for both membership and order; the
docs and `VALID_CLIS` agree with it today; `HARNESS_KEYS` (`harness-cli.ts`) has
the same twelve members in a different order.

## Detection is `which`, and it is not consulted at install time

`detectInstalled()` per integration calls `binaryExists()` (`integrations.ts`), which is
`which <name>` — `where <name>` on win32 — inside a try/catch. `detectInstalledClis()`
filters `INTEGRATION_TYPES` by it. That is the whole mechanism, and it has three
consequences worth knowing before you trust a detection result:

- **Cursor matches a bare `agent` binary.** Any unrelated program named `agent` on PATH
  makes Cursor "detected". Confirm with `command -v cursor-agent` before installing.
- **PATH-only.** A harness installed but absent from the PATH of the shell you run
  `failproofai` in is invisible; a shell alias or function is not a binary and never
  detects.
- **Install never checks detection.** `installHooks` (`manager.ts`) validates policy names
  and the (cli, scope) pair and nothing else — `detectInstalled` appears only in
  `install-prompt.ts`, `configure-wizard.ts`, and the web actions. `--cli goose` on a
  machine with no goose creates `~/.agents/plugins/failproofai/hooks/hooks.json` and
  reports success.

## Scopes

| Harness | Scopes |
|---|---|
| `claude` | user, project, **local** — the only one with local |
| `codex` `copilot` `cursor` `opencode` `pi` `factory` `devin` `antigravity` `goose` | user, project |
| **`hermes` `openclaw`** | **user only** — no project config exists |

`HOOK_SCOPES` and the per-CLI `*_HOOK_SCOPES` in `types.ts` are authoritative;
`manager.ts` rejects a bad pair with `Scope "X" is not supported by <DisplayName>`.

**The CLI's own `--help` is stale about this.** It says "Codex / Copilot / Cursor /
OpenCode / Pi support user|project only", which omits that Hermes and OpenClaw are
user-only and that four more harnesses are user|project. `--cli hermes --scope project` is
rejected despite the help implying it is fine.

Scope also decides what command is written into the harness config:

- `project` → `npx -y failproofai --hook <Event> --cli <id>` — except Claude, whose
  entry omits `--cli` (the handler defaults to claude); committable, no machine
  paths.
- `user` / `local` → the **absolute path resolved by `which failproofai` at install
  time**, baked into every entry (`manager.ts`, grep `resolveFailproofaiBinary`).
  Move the global npm prefix or switch node versions and those entries point at nothing.

`resolveFailproofaiBinary()` runs unconditionally, before the scope branch — so a
project-scope install still fails outright if `failproofai` is not on PATH, even though the
command it writes would not have used it.

## Where each hook config lives

| Harness | User scope | Project scope | Events installed |
|---|---|---|---|
| `claude` | `~/.claude/settings.json` | `<cwd>/.claude/settings.json` (local: `settings.local.json`) | 28 |
| `codex` | `~/.codex/hooks.json` | `<cwd>/.codex/hooks.json` | 10 |
| `copilot` | `~/.copilot/hooks/failproofai.json` | `<cwd>/.github/hooks/failproofai.json` | 12 |
| `cursor` | `~/.cursor/hooks.json` | `<cwd>/.cursor/hooks.json` | 7 |
| `opencode` | `~/.config/opencode/opencode.json` | `<cwd>/.opencode/opencode.json` | 7 |
| `pi` | `~/.pi/agent/settings.json` | `<cwd>/.pi/settings.json` | 7 |
| `hermes` | `<HERMES_HOME or ~/.hermes>/config.yaml` — **every profile** | — | 5 |
| `openclaw` | `~/.openclaw/openclaw.json` | — | 8 |
| `factory` | `~/.factory/hooks.json` | `<cwd>/.factory/hooks.json` | 9 |
| `devin` | `~/.config/devin/config.json` | `<cwd>/.devin/config.json` | 7 |
| `antigravity` | `~/.gemini/config/hooks.json` | `<cwd>/.agents/hooks.json` | 4 |
| `goose` | `~/.agents/plugins/failproofai/hooks/hooks.json` | same path under `<cwd>` | 5 |

Paths come from each integration's `getSettingsPath` (`integrations.ts`); counts from the
`*_HOOK_EVENT_TYPES` arrays in `types.ts` (Claude installs `CLAUDE_INSTALL_EVENT_TYPES` =
all 29 canonical events minus `WorktreeCreate`).

**Four of the twelve are not symmetric between scopes**, and guessing is wrong every time:
Copilot's user file is under `.copilot/hooks/` but its project file is under
`.github/hooks/`; Pi's user file is `.pi/agent/settings.json` but its project file
is `.pi/settings.json`;
Devin's user file is `~/.config/devin/` but its project file is `.devin/`; Antigravity's
user file lives in **Gemini's** directory, `~/.gemini/config/`, while its project file is
`.agents/hooks.json`. Note that Antigravity's project file and Goose's project file both
live inside one `<cwd>/.agents/` tree.

`getSettingsPath` still returns a path for `local` on the eleven harnesses that do not have
it — it falls back to the project path so callers do not crash. The CLI rejects the
combination first, so you never reach it, but do not read that fallback as support.

### Four harnesses need a companion file, not just a config edit

- **OpenCode** writes a generated plugin shim at `plugins/failproofai.mjs` next to
  `opencode.json` and registers it in the `plugin: []` array (`./plugins/failproofai.mjs`
  for project, `file://<abs>` for user). **Auto-discovery from `.opencode/plugins/` does
  not work** — the array entry is the only registration. The shim re-implements the tool
  and tool-input maps inline, so editing `types.ts` alone leaves it stale.
- **Pi** registers the shipped `pi-extension/` package directory in `packages[]`.
- **OpenClaw** registers the shipped `openclaw-plugin/` directory in
  `plugins.load.paths[]` plus a `plugins.entries.failproofai` block.
- Pi's and OpenClaw's directories resolve from `FAILPROOFAI_PACKAGE_ROOT`, else two levels
  up from the module (`integrations.ts`, grep `getPiExtensionPath`,
  `getOpenClawPluginPath`). The absolute path into the global npm prefix is written into
  the harness config, so reinstalling failproofai to a different prefix leaves a dangling
  entry.

### Hermes installs into every profile at once

A Hermes "profile" is a whole separate home directory. `getSettingsPaths()` returns one
`config.yaml` per profile — `listHermesProfiles()` (`lib/hermes-profiles.ts`) seeds
`default` = the root home and enumerates `<root>/profiles/*/`. `HERMES_HOME` may point *at*
a profile, and `hermesRoot()` climbs back to the root so siblings stay visible. So one
`--cli hermes` install writes N files and uninstall removes all N. A profile created
**after** the install runs unhooked, and **Hermes never reports a missing hook** — nothing
tells you.

## Two different config files per scope — do not confuse them

The harness files above say *where the hook command is wired*. Which policies are enabled
lives in failproofai's own per-scope file (`hooks-config.ts`, grep `getConfigPathForScope`):

| Scope | Policy config |
|---|---|
| user | `~/.failproofai/policies-config.json` |
| project | `<project-root>/.failproofai/policies-config.json` |
| local | `<project-root>/.failproofai/policies-config.local.json` |

**The enabled-policy set is per-scope, not per-CLI.** All twelve harnesses wired at one
scope share one set; `--cli` only chooses which harnesses get the hook entries. At hook
time `readMergedHooksConfig` takes the **union** of enabledPolicies across project, local
and user — so a project-scope install cannot narrow what user scope turned on.

The two file families also resolve their project root differently. The harness file uses
the literal cwd (`resolve(base, ".claude", …)`); the policy config uses
`findProjectConfigDir`, which walks up to the nearest ancestor containing a `.failproofai/`
directory, stopping at `$HOME`. On a first install there is no marker yet and they agree.
Once a repo has `.failproofai/`, running `--install --scope project` from a subdirectory
writes `<subdir>/.claude/settings.json` while the policy config goes to `<repo-root>`.
Install from the repo root.

## Proving an install, per CLI

**`failproofai policies` does not report per-CLI status.** Its "installed scopes" line comes
from the module-local `hooksInstalledInSettings` in `manager.ts`, which delegates to
`claudeCode` only. A machine hooked into Codex and Cursor but not Claude shows zero installed
scopes and prints *"These are configured but NOT installed — no hook is running
them:"* (only a machine with no enabled policies at all gets *"Nothing is
installed yet."*). The same Claude-only check drives the multi-scope duplicate warning.

Check the files instead. Every entry failproofai writes contains the literal string
`failproofai`:

```bash
grep -l failproofai ~/.claude/settings.json ~/.codex/hooks.json \
  ~/.copilot/hooks/failproofai.json ~/.cursor/hooks.json \
  ~/.config/opencode/opencode.json ~/.pi/agent/settings.json \
  ~/.hermes/config.yaml ~/.openclaw/openclaw.json ~/.factory/hooks.json \
  ~/.config/devin/config.json ~/.gemini/config/hooks.json \
  ~/.agents/plugins/failproofai/hooks/hooks.json 2>/dev/null
```

Eight of the twelve config files also carry the marker key `__failproofai_hook__`
(`types.ts`, grep `FAILPROOFAI_HOOK_MARKER`): claude, codex, copilot, cursor, hermes,
factory, devin, antigravity. OpenCode's marker is in the generated shim file, not in
`opencode.json`; Pi's and OpenClaw's entries are plain path strings; Goose deliberately has
no marker at all and is identified by a `command` containing both `failproofai` and
`--cli goose` (`integrations.ts`, grep `isGooseFailproofaiHook`).

File presence is not proof of evaluation. Make one real tool call in the harness and
confirm a decision appears in the local dashboard's Policies → Activity log.

Non-default *session capture* locations are a separate mechanism —
`failproofai harness add-path`, covered in `references/transfer.md`.

## Enforcement capability, at summary level

`ENFORCEMENT_CAPABILITY` in `enforcement-capability.ts` answers one question per (cli,
event) pair: does a `deny` on the wire shape failproofai emits *today* change the agent's
behaviour? Three states, and the third is the one people get wrong:

| Cell | Meaning |
|---|---|
| `block` | the verdict is read at a call site that prevents the action or forces another turn |
| `observe` | the policy runs, the verdict is discarded, the action proceeds |
| **absent** | **not verified — say nothing.** Never round it up to `block` |

Five facts carry most of the operational weight:

- **`PreToolUse` is `block` on all twelve.** It is the only event with that property. If a
  rule can be expressed as a pre-tool gate, express it there.
- **`PostToolUse` is `observe` on 10 of 12.** The two exceptions, Codex and Copilot,
  *replace the tool result the model reads* — the write already landed, the command
  already ran. There is no harness on which a `PostToolUse` deny undoes a side effect.
- **Hermes has no `Stop` event installed.** Its real turn-end gate upstream is `pre_verify`,
  which failproofai does not key, so no canonical `Stop` ever fires and the five
  `require-*-before-stop` builtins are inapplicable there. Goose is the same shape for a
  different reason: `emit_stop_hook_blocking` exists at v1.43.0 and is not installed —
  `types.ts` still claims Goose has no Stop event, and `enforcement-capability.ts`
  explicitly overturns that comment.
- **OpenCode's `PermissionRequest` is a dead hook.** `permission.ask` is declared and
  documented upstream but is never dispatched, so the policy does not run at all. Read the
  `observe` cell as "never invoked", not "invoked and ignored".
- **Devin's `PermissionRequest` is conditional**: it never fires under
  `--permission-mode dangerous`, and never for auto-approved read-only tools (a recorded
  probe leaked a secret through exactly that gap). Devin's `PreToolUse` does override
  dangerous mode, so that is the safe gate there.

For reference, `UserPromptSubmit` blocks on eight harnesses — it is `observe` on OpenCode,
Antigravity and Goose, and is not installed for Hermes. `Stop` blocks on eight, is `observe`
on Pi, unverified on OpenCode, and absent on Hermes and Goose.

**A version is part of every claim, not a footnote.** The table header pins the probed
build of each harness (claude 2.1.220, codex fe01054a/0.147.0, copilot 1.0.71/1.0.78,
cursor-agent 2026.07.16-899851b, opencode v1.18.9, pi 0.80.10, hermes 5771a6e, openclaw
v2026.7.2, droid 0.175.1, devin 3000.2.17, agy 1.1.8, goose 1.43.0) and records that
several Codex rows cite source paths that no longer exist at 0.147.0 — unverified, not
known-wrong. Re-test after any harness upgrade, especially for prompt, stop, permission and
post-tool behaviour.

The full traced matrix, with per-CLI evidence and the caveats on caps and empty-reason
degradation, is `failproofai-policy-author/references/harnesses.md`. Send authoring work
there rather than paraphrasing the table.
