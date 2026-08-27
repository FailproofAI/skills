# Installing and connecting a machine

SKILL.md gives you the two commands and the one big warning. This file is what those
commands actually do: every wizard step, every file written, every exit code, and the
one thing the product genuinely cannot do (provision a daemon machine without a human
at a terminal).

Source anchors are grep targets in the `failproofai` package — `configure-wizard.ts`,
`daemon-service.ts`, `cloud-connection.ts`, `cloud-enrollment.ts`,
`cloud-enrollment-cli.ts`, `bin/failproofai.mjs`.

## What "set up" means on disk

A set-up machine has five independent things. Nothing checks that you have all five, and
each is written by a different command — which is why partial installs are the norm.

| Thing | Where | Written by |
|---|---|---|
| Hook entries in each agent CLI's settings | per-harness, per-scope (`harnesses.md`) | wizard (all 12 CLIs), `policies --install` |
| **Installed packs — where enforcement comes from** | `~/.failproofai/policies/packs/installed.json`, `artifacts/<sha256>.mjs` | `policies add`, **never the wizard** |
| The legacy enabled-builtin set | `~/.failproofai/policies-config.json` (user), `.failproofai/` (project) | wizard (carried, never chosen), `policies --install` |
| The daemon: binary, service unit, `daemon.configured` | `~/.failproofai/bin/failproofaid-<ver>`, `/etc/systemd/system/failproofaid@<user>.service` or `/Library/LaunchDaemons/ai.failproof.failproofaid.<user>.plist`, `config.json` + `VERSION` | **`failproofai config` only** |
| Cloud credentials + collector block | `~/.failproofai/credentials.json` (0600), `config.json` | wizard, `config --connect` |

Hooks and packs are the pair that matters, and each is useless alone: hooks with no pack hand
every tool call to a machine that has nothing to say about it, and a pack with no hooks is
never called at all — the listing header says so in as many words, `<N> on · NOT ENFORCING`.

`enabledPolicies` decides nothing on a machine set up by this version. This build registers
exactly one policy of its own — `block-failproofai-commands`, `alwaysOn`, compiled in — and
reads that key only as a migration shim, for a machine that upgraded in with policies
enabled and no pack yet (`handler.ts`, grep `hasInstalledPacks`). It stops the moment any
pack is installed.

`isConfigured()` — the thing that decides whether first-run onboarding fires — reads
*none* of the cloud state (`setup-state.ts`, grep `hasGlobalConfig`). It is the union of
a global policies config, live user-scope hooks, or the legacy marker. It reads no pack state
either, so a machine that has only ever run `--connect` — or only ever installed a pack —
still counts as unconfigured, which is why `flush` and `audit` on such a machine drop into
onboarding first.

Service units are **per-user by design** (`daemon-service.ts`, grep `systemdUnitName`,
`launchdLabel`). Two users on one box get two units. Two daemons for one user cannot
coexist — the second loses the flock race and exits.

## The wizard, step by step

`failproofai config` (aliases `configure`, `setup`). One sudo prompt and two questions, and
**neither question is about what this machine enforces.** Setup installs the daemon, wires
hooks into every supported agent, and offers to connect to Cloud. Choosing policies is a
separate act, taken later and on purpose — `failproofai policies add`.

**Do not read `configure-wizard.ts`'s header docblock.** It still lists a six-step flow
including `2. Policies — multi-select of themed presets (combine any) or Everything`. That
flow is deleted; the code 900 lines below the comment is the truth, and so is `config
--help`, which states it outright: *"It chooses NO policies — take some with: `failproofai
policies add <owner>/<repo>`"*. The in-code step numbers are stale for the same reason —
`// 2 — Which harnesses?` sits above a hardcoded constant that asks nothing.

Two hard gates run *before* the first frame is drawn:

- Not Linux or macOS → refuses outright with "Setup cannot continue here", writes
  nothing. Verified: `isDaemonSupportedPlatform()` is checked before `intro()`.
- `getuid() === 0` **and** `SUDO_USER` set → refuses. Running the CLI under sudo makes
  `homedir()` `/root`, so hooks, policy config, the daemon binary and the unit's `User=`
  all silently configure root's account instead of yours.

| Step | Question | What it writes | On failure |
|---|---|---|---|
| **0** | none — daemon install (a sudo prompt, not a question) | binary, service unit, `daemon.configured: true`, `VERSION.daemon` | **aborts, machine untouched** |
| **1** | Connect to Cloud, or stay local? then the key | nothing yet (key is probed, not stored) | interactively non-fatal; unattended it aborts `cloud_unverified` |
| **2** | Ready to apply? | everything, in the order below | daemon failure aborts; cloud failure warns |

Everything else is now a constant, not a prompt:

| Not asked any more | What it is instead | Where |
|---|---|---|
| Recommended vs Customize | no opening fork; one linear flow | — |
| Where: global / project / both | **always global** | `const target: SetupTarget = "user"` |
| Which harnesses? | **all 12 supported CLIs**, detected or not | `const clis = [...clisSupportingScope(primaryScope)]` |
| What should we guard against? | **nothing is chosen** — whatever is already enabled at that scope is read and carried | `const enabledHere = readScopedHooksConfig(primaryScope, cwd).enabledPolicies ?? []` |
| Load custom policies? (checkbox) | **left alone**, never written | `const customEnabled: boolean \| undefined = undefined` |

Nothing at all is written until you pick **Yes, apply now** at step 2. The review screen
lists the literal settings-file paths it is about to touch (grep `This will update:`), and
its Policies line reads `none enabled` on a fresh machine — a true statement about a
deliberate choice, not a lost selection.

### Step 0 is the whole reason the wizard exists

It runs first because it is the only step that needs a password, and `sudo -v` must
prompt on a clean terminal — fired from underneath a drawn TUI the prompt is invisible
and the typed password lands in a redrawn frame. It also *installs* first, at apply time,
because a hook config written against a daemon that then fails to start cannot be undone
cleanly.

`primeElevation()` runs `sudo -v` once with inherited stdio; every later privileged step
uses `sudo -n` and never prompts. It is a no-op when already root or under NOPASSWD.

**With no terminal the wizard never calls it.** It probes `canElevate()` (a bare `sudo -n`)
instead, so a headless run cannot hang on a password nobody can type: it either elevates
silently or aborts `needs_root` having written nothing, printing the commands to run as
root. Same branch for the stale-unit refresh, except that one is non-fatal — the daemon
keeps running from its old service definition and only scheduled audits stay off.

The wizard branches on six daemon states, not two (`daemon-service.ts`, grep
`DaemonServiceStatus`): `running`, `stopped`, `condition-failed`, `not-installed`,
`unknown`, `unsupported-platform`. **`unknown` is macOS-only and is the common case there** — a LaunchDaemon's
state lives in launchd's system domain and needs root to read, so a sudo cache older than
five minutes returns it for any normal user. Anything you write that branches on daemon
status must handle all six.

An install is skipped only when the daemon is running, at *this CLI's* version, **and**
answers a real end-to-end hook evaluation (grep `probeDaemonEndToEnd`). Version-current
and `systemctl`-active is not enough: `ExecStart` bakes in `process.execPath` and an
absolute `dist/worker.mjs`, so an `nvm uninstall 20` leaves a unit systemd calls active
whose worker dies on every spawn.

After install, `probeDaemon()` sends a real `SessionStart` hook socket → daemon → worker
and is a **hard gate** before `setDaemonConfigured(true, cliVersion)`. Setting that flag
against a daemon that cannot answer denies every tool call on all 12 CLIs, including
`UserPromptSubmit`, so the user cannot even ask their agent why.

`pruneOldDaemonBinaries()` runs only here, only after a successful apply, and keeps the
newest two. `failproofai update` never calls it, so an update-only machine accumulates
one binary per version in `~/.failproofai/bin/`.

### Setup chooses no policies, and that is the design

**A fresh machine finishes setup with nothing enforcing except
`block-failproofai-commands`** — the one compiled, `alwaysOn` guard, which bypasses the
enabled set entirely. That is the intended end state, not a broken install. `handler.ts`
says it in place: *"Enforcement comes from PACKS now. What still registers from this build
is the always-on self-protection guard, and nothing else."*

What was removed, so you do not go looking for it:

- **`RECOMMENDED_POLICIES` is gone** — 15 builtin names installed on behalf of somebody who
  had not seen the list. No replacement. The only mention left in the repo is a test
  asserting its absence.
- **`policy-presets.ts` is deleted**, with its four themed bundles (Secrets & data, Git
  safety, Ship discipline, Cloud & infra) and the `POLICY_PRESETS` export.
- **The policy step itself is deleted**, along with the Recommended/Customize fork, the
  scope question, the harness question, and the step navigation between them. There is no
  `←` anywhere: nothing left to go back to.

Two consequences worth stating on their own.

**`customPoliciesEnabled` is left alone in both modes.** It was a checkbox on the policy
step; with no row to read, the only honest value is "do not touch it"
(`setCustomPoliciesEnabled` returns immediately on `undefined`). This closes a real leak:
finishing setup used to write `customPoliciesEnabled: false` and switch off **every
convention policy on disk** as a side effect — files the user never mentioned, in a step
that was nominally about builtins.

**`installHooks` still runs with `replace: true`, and re-running setup still never reduces
protection.** `replace: true` makes the passed set the whole enabled set at that scope —
but the set passed is whatever that scope already had, read back immediately before. Nothing
is subtracted because nothing new is chosen. On a machine that upgraded in from a pre-pack
build the carried names go one step further: `installHooks` fetches `FailproofAI/policies`
with `only: <those names>` and moves them into a real pack (network permitting — a failure
prints `Warning: could not fetch the policy pack …` and leaves the migration shim
enforcing).

### Getting policies onto the machine

Setup wires the hooks; this is the separate act. The wizard's own outro prints the first two
lines verbatim when it finishes with zero policies:

```bash
failproofai policies add FailproofAI/policies   # ours — a pack like anyone else's
failproofai policies show <owner>/<repo>        # look first, without running it
failproofai policies add                        # picker over every installed pack
failproofai policies add block-sudo             # one policy, by name
failproofai policies                            # what is on this machine
```

The slash is the whole routing rule: a name matching `/^[A-Za-z0-9._-]+$/` is a policy,
anything containing `/` is a pack source. `policies add core` is **not** an offline
shortcut — `core`, `failproofai` and `official` are retired and throw *"ours is a pack like
anyone else's now. Use FailproofAI/policies instead."* Nothing installs from disk any more;
only installing needs the network, and an already-installed pack keeps enforcing offline.

`policy`, `pack` and `p` are all rewritten to `policies` before any dispatch, so anything
anyone typed before still runs. Document `policies`. **The pack lane in depth — publishing,
digest pinning, selection flags, `--cli` narrowing — belongs to
`failproofai-policy-deploy`.**

### Step 1 writes nothing, and that is deliberate

The key is validated against the ingest endpoint immediately (`validateIngestKey`) so a
typo is caught while the user is still thinking about credentials. On a failed probe you
are offered **Save it anyway** for the case where you know the server is simply down.
Nothing is persisted here; `connectToCloud` re-verifies at apply time and writes only what
verifies then.

The URL is **not asked for**. It is `https://app.befailproof.ai` unless
`FAILPROOFAI_CLOUD_URL` is exported, in which case that value is used, validated the same
way, and named on screen. An invalid override cancels the run rather than falling back to
the hosted service.

The wizard always connects with `sessions: true` — full transcripts, disclosed in the body of
the question rather than a hint. **`config --no-transcripts` is parsed into the wizard's
answers and never read**, so it silently does nothing on this path; the flag only takes
effect on `--connect`.

### Apply order, and what each abort costs you

Daemon → hooks (one `installHooks` per scope, and there is only ever one now) → cloud creds.
The custom-policy write is still called and is a no-op: `setCustomPoliciesEnabled` returns
immediately on `undefined`, which is the only value the wizard passes. Cloud is last because
the daemon runs the collector: a credential written for a service that is not there is a key
on disk doing nothing.

| Abort reason | Cause | Exit code |
|---|---|---|
| `cancelled` | Esc at any prompt | **0** |
| `needs_root` | `sudo -v` refused or timed out; headless, `sudo -n` failed | 1 |
| `daemon_failed` | service would not install, or installed and did not answer the probe | 1 |
| `unsupported_platform` | anything but Linux or macOS — refused before the first frame | 1 |
| `running_as_sudo` | `getuid() === 0` with `SUDO_USER` set | 1 |
| `cloud_unverified` | **headless only** — a key was supplied and the server refused it | 1 |

The exit rule is `!applied && abort && abort !== "cancelled" ? 1 : 0`. Cancelling is not a
failure; every other abort is, and each one writes nothing — `cloud_unverified` fires before
the apply block, so a refused key costs you the daemon install too.

An abort is recorded (`onboarding-attempt.ts`) so the next command hints instead of
relaunching the wizard; an explicit `failproofai config` always gets the wizard anyway.

## Headless setup

**`failproofai config` with no terminal just runs.** It applies rather than asking — the
command *is* the confirmation — and no flag says so. Provisioning scripts written against
the old behaviour are the thing to watch for: this used to print "failproofai config needs
an interactive terminal." and exit **0** having done nothing.

```bash
npm install -g failproofai
FAILPROOFAI_CLOUD_TOKEN="$KEY" failproofai config < /dev/null
failproofai policies add FailproofAI/policies --cli claude codex
```

That produces the whole machine: daemon, hooks in all 12 agents, credentials — and then, as
a separate command, something to enforce.

- **Passwordless sudo is the one hard requirement.** Headless runs never call `sudo -v`;
  they probe `sudo -n` and abort `needs_root` (exit 1) if it fails, printing the privileged
  commands for an admin to run by hand. NOPASSWD for the provisioning account, or a
  credential already cached, is what makes this work.
- **`--token` is the request to connect.** Prefer `FAILPROOFAI_CLOUD_TOKEN`: an argument is
  readable from `ps` by every user on the box and lands in shell history and CI logs. `--url`
  / `FAILPROOFAI_CLOUD_URL` for anywhere but `app.befailproof.ai`; `--machine-id` and
  `--machine-label` are passed through.
- **A key the server refuses is a failed setup, not a warning.** Headless gets
  `cloud_unverified` and exit 1 — there is nobody to weigh "save it anyway", and a run that
  exited 0 here would leave a fleet believing it was reporting.
- **`--no-transcripts` does nothing on this path.** The wizard accepts the field and never
  reads it; `connectToCloud` is called with `sessions: true` hardcoded. For decisions-only,
  set the machine up first and enrol separately with `failproofai config --connect <url>
  --token <key> --no-transcripts`.
- `--token` also pre-answers the whole run **on a TTY**: no connect question, no review
  screen. The sudo password is the only thing left that can stop it.
- Implicit onboarding still never fires headless. `maybeFirstRunConfigure` keeps its own TTY
  check and only hints — `[failproofai] Not set up yet — run failproofai config to get
  started.` — so setup never runs off the back of some other command in CI.

Three things still do **not** install a daemon, whatever they look like:

| Looks like it installs a daemon | Actually |
|---|---|
| `npm install -g failproofai` | brings down the `@failproofai/failproofaid-<os>-<arch>` platform package; installs **no** service and **no** binary into `~/.failproofai` |
| `failproofai update` | refreshes an *existing* service — `refreshDaemonToCliVersion()` returns early on `not-installed`. On a machine with none: "No failproofaid service on this machine; nothing to update." — **exit 0**. Verified live |
| `failproofai config --connect` | writes credentials, warns `! failproofaid is not installed as a service, so nothing will be pulled yet.`, never elevates |

`failproofai config` — interactive or headless — is the only caller of
`installDaemonService()` that can install one from scratch. To make the install do no
network work, pre-seed the binary at `~/.failproofai/bin/failproofaid-<cli-version>` or
point `FAILPROOFAI_DAEMON_BINARY` at it (resolution order: `FAILPROOFAI_DAEMON_BINARY` →
that versioned path → a dev build under `FAILPROOFAI_PACKAGE_ROOT/target/{release,debug}/`).

Verify by evidence, never by exit code: `failproofai config --status` must show a daemon
that is `running` at the CLI's own version.

## `config --connect` in full

```bash
failproofai config --connect <url> --token <key> \
  [--machine-id <id>] [--machine-label <name>] [--no-transcripts]
```

| Flag | Notes |
|---|---|
| `--connect <url>` | base URL. A pasted `/v1/events` or `/events` suffix is stripped (`cloudBaseFor`). http is refused for anything but loopback |
| `--token <key>` | needs `events:add` and/or `policies:pull`. Never an admin key |
| `--machine-id <id>` | explicit id wins; else the id already on disk; else a **random UUID**. Never the hostname, whatever `--help` says |
| `--machine-label <name>` | display name, mutable, free to collide. **Alone** (no `--connect`) it renames an already-connected machine |
| `--no-transcripts` | exact string, decisions only |
| `--disconnect` | stops pulling and sending — but a *running* daemon cached its bearer key at construction and keeps shipping until restarted |

**No `--flag=value` form.** Verified live: `--token=abcdefgh` is parsed as *no token* and
the command exits 1 with "--connect needs a machine token". `--connect` with a missing
value throws "Missing value after --connect." (exit 1). And the `config` branch validates
no unknown flags at all — verified live, `config --status --bogus-flag` exits 0 and prints
normal output.

### Three requests, two capabilities

`introspectKey()` runs first: `GET <base>/v1/auth/introspect` answers *is the key
accepted*, *which org*, and *which permissions*, in one call. A rejected key stops here.
A server too old to have the endpoint falls through to probing.

Then both capabilities are probed in parallel, and **only what verifies is written**:

| Capability | Permission | Verified against | Written on success |
|---|---|---|---|
| Pull managed policy | `policies:pull` | `GET <base>/enforcement/v1/desired-state?machineId=…&label=…` | `credentials.json` → `cloud` table |
| Push events/transcripts | `events:add` | empty `POST <base>/v1/events` (returns `{"accepted":0,"skipped":0}` — proves the endpoint without creating an event) | `credentials.json` → ingest key, plus `config.json`'s `collector` block (`hooks: true`, `sessions`, `machineId`) |

`mode: "cloud"` flips if *either* passed. The org is recorded last, and only if something
configured — a machine that connected to nothing must not carry a claim about where its
data goes.

Ingest is `/v1/events`, **never** `/events`, on the dashboard hostname: a reverse proxy
routes only `/v1/*` and `/enforcement/v1/*` to the server and sends everything else to the
Next.js app, which will happily answer 200. `validateIngestKey` uses `redirect: "manual"`
for exactly this reason — the dashboard answers `POST /events` with a 307 to its login
page, which then returns 200, and every batch afterwards was POSTed into a login form and
lost.

**The exit code tracks only the policy half** — `exitCode = outcome.policy.ok ? 0 : 1`.
An `events:add`-only key writes a working ingest credential, prints "Connected … for
dashboard reporting only", and exits 1. Never `&&`-chain on this command.

The CLI's own error hints name `https://be.failproof.ai`. The real host is
`app.befailproof.ai`.

## Reading `config --status`

Real output from a fresh home (verified live):

```
  failproofai config        CLI 1.0.2-beta.0 · daemon not installed · layout 4

  cloud        not connected
  enforcement  active — nothing is paused
```

**There is no `--verbose`.** Nothing parses it, `connectionStatusReport()` is called with
no arguments so its `verbose` parameter is always false, and the machine id is always
truncated to 8 hex characters. Verified live: `--status --verbose` is byte-identical to
`--status`.

| Row | Read it as |
|---|---|
| title line | the **version triad** — npm CLI, installed daemon (`VERSION.daemon`), home layout. `(STALE)` after the daemon version means skew → fail-closed risk |
| `cloud   configured by environment (…)` | `FAILPROOFAI_CLOUD_URL` is set and **overrides the credential file in the daemon**. Every other row is suppressed. The daemon then also requires `FAILPROOFAI_CLOUD_TOKEN` and `FAILPROOFAI_MACHINE_ID` or it errors out |
| `cloud   connected to <url>` | from the credential **file**, recorded at `--connect` time, never revisited |
| `machine`, `token`, `org` | same file. `org` is absent on pre-introspect servers rather than guessed |
| `policy  pulling centrally-managed policies` | the key carried `policies:pull` *then* |
| `policy  NOT pulling — …only its local policies` | ingest-only key |
| `dashboard  sending hook activity to …` | ingest credential exists |
| `dashboard  Ingest REJECTED (401/403) — N batches parked` | **the only row that describes now.** The key stopped being accepted after connecting. Parked batches with a definitive client status are never retried and never deleted |
| `dashboard  NOT sending — nothing … appears in the dashboard` | policy-only key |
| ⚠ daemon warning block | one of: not installed as a service · installed but not running · running outside the service manager (dev) · state needs elevation to read (macOS `unknown`) · unsupported platform |

The delivery-health verdict **overrides** the cheerful connection line rather than being
appended after it. Trust it over everything above it: that is how a machine reported
"connected" for twenty minutes with 26 refused batches on disk.

`--status` cannot be combined with `--pause` or `--resume`.

## Local-only is a finished install

A machine with hooks, a pack and a daemon and **no** cloud connection is a complete,
supported end state. It enforces pack, custom and convention policies; `failproofai
audit` scans its own history offline; the local dashboard on port 8020 shows the Policies
→ Activity log. Nothing leaves the machine. Do not treat `cloud  not connected` as a
defect — the wizard's own copy for it is "nothing leaves this machine".

A pack, note. Hooks and a daemon with no pack is a *finished setup* but not a finished
machine: the only thing that can deny anything is `block-failproofai-commands`.

The daemon is still worth installing on a local-only machine: it is what makes enforcement
fail *closed* and what runs scheduled audits. A local-only machine with no daemon is also
valid, just weaker — hooks evaluate in-process and a broken install degrades silently
rather than denying.

To verify a local-only setup, ignore `--connect` entirely:

```bash
failproofai config --status     # daemon row + version triad
failproofai policies            # packs on this machine, and how many are on
```

Read that second header before anything under it. `<scopes> · <N> on` is the healthy shape;
`<N> on · NOT ENFORCING` means packs are installed and no agent CLI is wired to call
failproofai, so every row below it is inert; `nothing installed` means neither half
happened.

Then make one real tool call in a target CLI and confirm a decision lands in the Activity
log. An install that has never evaluated a single event is not a verified install.
