# Installing and connecting a machine

SKILL.md gives you the two commands and the one big warning. This file is what those
commands actually do: every wizard step, every file written, every exit code, and the
one thing the product genuinely cannot do (provision a daemon machine without a human
at a terminal).

Source anchors are grep targets in the `failproofai` package — `configure-wizard.ts`,
`daemon-service.ts`, `cloud-connection.ts`, `cloud-enrollment.ts`,
`cloud-enrollment-cli.ts`, `bin/failproofai.mjs`.

## What "set up" means on disk

A set-up machine has four independent things. Nothing checks that you have all four, and
each is written by a different command — which is why partial installs are the norm.

| Thing | Where | Written by |
|---|---|---|
| Hook entries in each agent CLI's settings | per-harness, per-scope (`harnesses.md`) | wizard, `policies --install` |
| The enabled builtin set | `~/.failproofai/policies-config.json` (user), `.failproofai/` (project) | wizard, `policies --install` |
| The daemon: binary, service unit, `daemon.configured` | `~/.failproofai/bin/failproofaid-<ver>`, `/etc/systemd/system/failproofaid@<user>.service` or `/Library/LaunchDaemons/ai.failproof.failproofaid.<user>.plist`, `config.json` + `VERSION` | **the interactive wizard only** |
| Cloud credentials + collector block | `~/.failproofai/credentials.json` (0600), `config.json` | wizard, `config --connect` |

`isConfigured()` — the thing that decides whether first-run onboarding fires — reads
*none* of the cloud state (`setup-state.ts`, grep `hasGlobalConfig`). It is the union of
a global policies config, live user-scope hooks, or the legacy marker. A machine that has
only ever run `--connect` still counts as unconfigured, which is why `flush` and `audit`
on such a machine drop into onboarding first.

Service units are **per-user by design** (`daemon-service.ts`, grep `systemdUnitName`,
`launchdLabel`). Two users on one box get two units. Two daemons for one user cannot
coexist — the second loses the flock race and exits.

## The wizard, step by step

`failproofai config` (aliases `configure`, `setup`). Six steps, numbered 0–5 in
`configure-wizard.ts`'s own header comment. **`config --help` describes four steps, in
the wrong order** — it omits the daemon and the connect step and lists Harnesses before
Policies. The code runs Policies first (grep `What should we guard against?` then
`Which harnesses should it protect?`).

Two hard gates run *before* the first frame is drawn:

- Not Linux or macOS → refuses outright with "Setup cannot continue here", writes
  nothing. Verified: `isDaemonSupportedPlatform()` is checked before `intro()`.
- `getuid() === 0` **and** `SUDO_USER` set → refuses. Running the CLI under sudo makes
  `homedir()` `/root`, so hooks, policy config, the daemon binary and the unit's `User=`
  all silently configure root's account instead of yours.

| Step | Question | What it writes | On failure |
|---|---|---|---|
| **0** | none — daemon install | binary, service unit, `daemon.configured: true`, `VERSION.daemon` | **aborts, machine untouched** |
| — | Recommended vs Customize | nothing | — |
| **1** | Where: global / this project / both | nothing yet | — |
| **2** | What should we guard against? (bundles) | nothing yet | — |
| **3** | Which harnesses should it protect? | nothing yet | — |
| **4** | Connect to Cloud? paste a key | nothing yet (key is probed, not stored) | non-fatal, setup continues |
| **5** | Review & apply | everything, in the order below | daemon failure aborts; cloud failure warns |

Nothing at all is written until you pick **Yes, apply now** at step 5. The review screen
lists the literal settings-file paths it is about to touch (grep `This will update:`).

### Step 0 is the whole reason the wizard exists

It runs first because it is the only step that needs a password, and `sudo -v` must
prompt on a clean terminal — fired from underneath a drawn TUI the prompt is invisible
and the typed password lands in a redrawn frame. It also *installs* first, at apply time,
because a hook config written against a daemon that then fails to start cannot be undone
cleanly.

`primeElevation()` runs `sudo -v` once with inherited stdio; every later privileged step
uses `sudo -n` and never prompts. It is a no-op when already root or under NOPASSWD.

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

### Steps 1–3, and the fork the header comment does not number

Before step 1 the wizard asks **Recommended or Customize**. Recommended answers steps 1,
2 and 3 in one keystroke: global scope, the CLIs detected on this machine that support
user scope, and `RECOMMENDED_POLICIES` — 14 names, written out longhand in
`policy-presets.ts` (a code comment in `configure-wizard.ts` still says 15; count the
array, it is 14).
Recommended **unions** with whatever is already enabled rather than replacing it.

Customize is the four-question wizard. Its policy step offers 4 themed bundles (Secrets &
data, Git safety, Ship discipline, Cloud & infra), an **Everything** row, a **Custom** row
for convention policies, and a locked row for anything enabled individually. Bundles are
additive; Everything wins over bundles. Ticking nothing is a valid answer and writes an
empty enabled set — hooks still install, so you can enable policies later without
re-running setup.

Customize's selections **REPLACE** the enabled set at each chosen scope (`installHooks`
is called with `replace: true`), which is the opposite of `policies --install` from the
command line. Unticking a bundle in the wizard removes it; `policies --install` can only
ever add.

Steps 2 and 3 are navigable — `←` on the harness step returns to the policy step with
its answer intact. Step 1 is not: from a home directory there is only one possible
target and it is stated, not asked.

Under **Both** + **Everything available**, the CLI list is the union across scopes and is
re-filtered per scope at apply time — this is why a user-scope-only gateway (Hermes,
OpenClaw) survives the project pass instead of throwing `Scope "project" is not supported
by Hermes` mid-apply.

### Step 4 writes nothing, and that is deliberate

The key is validated against the ingest endpoint immediately (`validateIngestKey`) so a
typo is caught while the user is still thinking about credentials. On a failed probe you
are offered **Save it anyway** for the case where you know the server is simply down.
Nothing is persisted here; `connectToCloud` re-verifies at apply time and writes only what
verifies then.

The URL is **not asked for**. It is `https://app.befailproof.ai` unless
`FAILPROOFAI_CLOUD_URL` is exported, in which case that value is used, validated the same
way, and named on screen. An invalid override cancels the run rather than falling back to
the hosted service.

The wizard always connects with `sessions: true` — full transcripts. There is no
`--no-transcripts` equivalent in the wizard; that flag exists only on `--connect`.

### Apply order, and what each abort costs you

Daemon → hooks (one `installHooks` per scope) → custom-policy flag → cloud creds.
Cloud is last because the daemon runs the collector: a credential written for a service
that is not there is a key on disk doing nothing.

| Abort reason | Cause | Exit code |
|---|---|---|
| `cancelled` | Esc at any prompt | **0** |
| `needs_root` | `sudo -v` refused or timed out at step 0 | 1 |
| `daemon_failed` | service would not install, or installed and did not answer the probe | 1 |
| `unsupported_platform` | Windows | 1 |
| *(no abort field)* | **no TTY** — wizard never started | **0** |

That last row is the trap. Off a TTY the wizard prints three lines and exits **0** having
done nothing. Verified live: `failproofai config < /dev/null` → "failproofai config needs
an interactive terminal." → `EXIT=0`. A provisioning script that checks the exit code sees
success.

An abort is recorded (`onboarding-attempt.ts`) so the next command hints instead of
relaunching the wizard; an explicit `failproofai config` always gets the wizard anyway.

## The non-interactive path, and what it cannot reach

Everything except the daemon is scriptable:

```bash
npm install -g failproofai
failproofai policies --install block-rm-rf block-force-push --cli claude --scope user
failproofai config --connect https://app.befailproof.ai --token "$KEY"
```

That produces a machine with hooks, policies and working credentials — and **no daemon**.
`--connect` deliberately avoids sudo and only warns:

> `! failproofaid is not installed as a service, so nothing will be pulled yet.`

With no daemon there is no policy pull, no transcript capture and no delivery. Hooks still
enforce, in-process, because `daemon.configured` was never set.

## The headless gap: say it plainly

**There is no documented fully-non-interactive path that produces a working daemon
machine.** The interactive wizard is the only caller of `installDaemonService()` that can install
one from scratch. `refreshDaemonToCliVersion()` in `daemon-service.ts` — what
`failproofai update` runs — also calls it, but returns early on `not-installed`, so it
only ever refreshes a service that already exists. Three
things that look like escape hatches are not:

| Looks like it installs a daemon | Actually |
|---|---|
| `npm install -g failproofai` | brings down the `@failproofai/failproofaid-<os>-<arch>` platform package; installs **no** service and **no** binary into `~/.failproofai` |
| `failproofai update` | refreshes an *existing* service. On a machine with none: "No failproofaid service on this machine; nothing to update." — **exit 0**. Verified live |
| `failproofai config --connect` | writes credentials, warns about the missing daemon, never elevates |

The closest approximation, and be honest with the user that it is one:

1. Give the provisioning account **NOPASSWD sudo**. `primeElevation()` then returns true
   without prompting, and every privileged step (`sudo -n`) succeeds.
2. Pre-seed the binary so the install does no network work: drop it at
   `~/.failproofai/bin/failproofaid-<cli-version>`, or point `FAILPROOFAI_DAEMON_BINARY`
   at it. Resolution order is `FAILPROOFAI_DAEMON_BINARY` → that versioned path → a dev
   build under `FAILPROOFAI_PACKAGE_ROOT/target/{release,debug}/`.
3. Run `failproofai config` **under a pty** (`script -qec 'failproofai config' /dev/null`
   or equivalent) and drive the prompts. UNVERIFIED — I did not execute this, because it
   installs a root-owned service on the machine running it. The TTY check is
   `!stdin.isTTY || !stdout.isTTY` and nothing else gates the wizard, so a pty should
   satisfy it, but treat that as reasoning from source, not a tested recipe.
4. Verify by evidence, never by exit code: `failproofai config --status` must show a
   daemon that is `running` at the CLI's own version.

Do not hand a user step 3 as if it were supported. The honest answer is: bake an image
where a human ran the wizard once, or accept a daemonless (local-enforcement-only) fleet.

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

A machine with hooks, policies and a daemon and **no** cloud connection is a complete,
supported end state. It enforces builtin, custom and convention policies; `failproofai
audit` scans its own history offline; the local dashboard on port 8020 shows the Policies
→ Activity log. Nothing leaves the machine. Do not treat `cloud  not connected` as a
defect — the wizard's own copy for it is "nothing leaves this machine".

The daemon is still worth installing on a local-only machine: it is what makes enforcement
fail *closed* and what runs scheduled audits. A local-only machine with no daemon is also
valid, just weaker — hooks evaluate in-process and a broken install degrades silently
rather than denying.

To verify a local-only setup, ignore `--connect` entirely:

```bash
failproofai config --status     # daemon row + version triad
failproofai policies            # what is enabled, in which scope
```

Then make one real tool call in a target CLI and confirm a decision lands in the Activity
log. An install that has never evaluated a single event is not a verified install.
