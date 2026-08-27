# Troubleshooting FailproofAI

SKILL.md carries the symptom → check → cause table. This is what sits behind it: what each
probe measures, the branch after the first check, and how to prove the fix landed.

**Run recovery commands from a plain terminal, never from inside an instrumented agent** —
`block-failproofai-commands` is `alwaysOn` and denies *every* `failproofai` invocation from
an agent's Bash tool, not just `--pause` (`builtin-policies.ts`, grep
`Running failproofai CLI commands is blocked`).

## The instrument panel

Four different questions get confused for one, with four different failure modes
(`daemon-client.ts`, grep `daemonSocketPresent`; `daemon-service.ts`, grep `DaemonProbe`).

| Probe | Answers | Fails when |
|---|---|---|
| `daemonSocketPresent()` | a socket file exists | a stale socket outlives its process |
| `daemonAcceptsConnections()` | a connect succeeds | the worker is dead, the listener is not |
| `daemonServiceStatus()` | the *service manager's* opinion | a hand-run dev daemon is invisible to it |
| `probeDaemonEndToEnd()` | a real hook was evaluated | the only one that catches a dead worker |

A `Type=simple` unit reads **active the instant systemd forks it**, so "running" is never
proof the daemon works: an `nvm uninstall 20` months later leaves a unit systemd calls
active whose worker dies on every spawn. `daemonServiceStatus()` has **six** states —
`running`, `stopped`, `condition-failed`, `not-installed`, `unknown`, `unsupported-platform` —
and `unknown` is the
*common* macOS case, because reading a LaunchDaemon's state needs elevation and the sudo
cache is five minutes. Never fold it into `stopped`.

```bash
systemctl status failproofaid@$USER.service                   # linux — the unit is per-user
journalctl -u failproofaid@$USER.service -n 200
sudo launchctl print system/ai.failproof.failproofaid.$USER   # macOS
tail ~/.failproofai/logs/failproofaid.err.log                 # macOS log destination
```

## No sessions in the cloud dashboard

First check is always `failproofai config --status`.

| Status row says | Cause | Fix |
|---|---|---|
| `dashboard  NOT sending` | key had no `events:add` | re-`--connect` with a key that carries it |
| `Ingest REJECTED (401/403) — N batches parked` | key stopped being accepted **after** connect | *Ingest rejected*, below |
| daemon warning, `not-installed` | ran `config --connect` only — it never installs a daemon | run the interactive `failproofai config` wizard |
| `sending hook activity to …` and still empty | `collector.sessions` is false, or a filter | below |

Transcripts are a **separate opt-in from having a key**: `is_enabled()` needs a key *and* at
least one stream, and `sessions` defaults to `false` at the library layer
(`crates/fpai-collect/src/config.rs`, grep `is_enabled`). `--connect` flips it on unless
`--no-transcripts` was passed — or silently typo'd. Seeing the session on the **local**
dashboard proves nothing about delivery; it reads local files and never touches the network.
Confirm with a broad cloud query — an over-narrow filter is indistinguishable from failed
ingestion.

```bash
grep -A6 '"collector"' ~/.failproofai/config.json     # sessions / hooks / environment
failproofai flush --wait --timeout 120
fp --json events --since 24h --limit 20               # global flags BEFORE the command
```

## The machine is not receiving policies

`policy  NOT pulling — this machine enforces only its local policies` means an
`events:add`-only key. Ingest and policy are independent capabilities, probed separately at
connect time (`cloud-connection.ts`), so one working says nothing about the other. If the
policy row *is* healthy and nothing arrives, the daemon is the missing half — **credentials
alone pull nothing** (`cloud-enrollment-cli.ts`, grep
`Cloud policy is evaluated by failproofaid`).

If both look right you are targeting the wrong machine record. `config --status` truncates
the machine id to 8 hex characters and **`--verbose` does not expand it** — nothing parses
that flag; `bin/failproofai.mjs` calls `connectionStatusReport()` with no arguments. Read
the full id from disk and compare it against Admin → enforcement.

```bash
grep machineId ~/.failproofai/credentials.json
failproofai policies                  # a cloud-managed section appears once a pull lands
```

## Every tool call is denied, on every CLI

Once `daemon.configured` is recorded there is **no in-process fallback** — one would be a
second policy engine reachable by breaking the first. `UserPromptSubmit` denies too, so the
user cannot even ask their agent what happened. The two causes differ only in the deny text
(`bin/failproofai.mjs`, grep `protocol-mismatch`):

| Deny reason contains | Meaning | Fix |
|---|---|---|
| `running a different protocol version than this CLI` | daemon answered; versions differ | `failproofai update` |
| `could not be reached` | nothing answered: stopped, socket gone, tampering | restart the unit, then `failproofai config` |

Running **any** `failproofai` CLI command self-heals three provable cases (`fp-reset.ts`,
grep `healDaemonFlag`): `not-installed`; `condition-failed` (what `npm rm -g failproofai`
leaves — npm runs no uninstall script); and `running` while `probeDaemonEndToEnd()` fails.
It deliberately does **not** heal `stopped`, because a restart in flight looks identical.
Two cases it cannot see:

- **Split-brain `FAILPROOFAI_HOME`** — set for one process and not the other, the daemon
  binds one socket and the hook looks for another, denying every call against a perfectly
  healthy daemon (`crates/failproofaid/src/paths.rs`, grep `run_dir`). The npm
  `failproofaid` shim ignores `FAILPROOFAI_HOME` entirely and reports "not installed" for a
  binary that is right there.
- **A layout-refusing unit**, which reads as `stopped`. See *Version skew*.

Last resort, from a plain shell: set `daemon.configured` to `false` in
`~/.failproofai/config.json` and policies evaluate in-process again. Never weaken the policy
to route around this.

## A custom policy silently does nothing

```bash
ls ~/.failproofai/policies/ .failproofai/policies/ 2>/dev/null
failproofai policies                  # if the file is not listed, it is not loaded
```

`custom-hooks-loader.ts`, grep `CONVENTION_FILE_RE` — only names matching
`/policies\.(js|mjs|ts)$/` load. `block-force-push.mjs` is **skipped silently**;
`block-force-push-policies.mjs` works, and `.cjs` never loads. This shipped as a real bug in
the product's own repo: a guard written after a bad version bump that had never once run.
Three quieter causes:

- `customPoliciesEnabled` resolves **first scope wins** — project, then local, then global
  (`hooks-config.ts`, grep `customPoliciesEnabled`). A `false` in the first scope that sets it
  switches off *all* convention policies at once, but a `true` in a higher-precedence scope
  silently overrides a `false` below it. Unlike `enabledPolicies`, this is not a union.
- The project root is found by walking **up from cwd** for `.failproofai/`, stopping at
  `$HOME` — an agent launched with `cwd = $HOME` registers the same file under a
  *user*-scope id.
- `enabledPolicies` merges as a **union**, so a project scope can add but can never disable
  what the user scope enabled.

The rename hint exists but is hard to see: it goes to the hook logger at `warn` level
(stderr of a short-lived hook process the agent CLI usually swallows) and to the wizard's
review screen. `FAILPROOFAI_HOOK_LOG_FILE=1` writes hook diagnostics to
`~/.failproofai/logs/hooks.log` — it names a **directory**, not a file, and only `1` or
`true` mean "use the default".

## Sessions stop at a date

The collector never re-reads a file it holds a cursor for. Cursors advanced before there was
anywhere to send — connected after the work happened, re-enrolled, dashboard cleared — and
the history now exists on disk and nowhere else.

```bash
failproofai backfill --since 30d --dry-run
failproofai backfill --since 30d
ls ~/.failproofai/state/spool/*/ | wc -l    # wait for the daemon tick to move this
failproofai flush --wait
```

- `--dry-run` is **not** pure inspection: it needs a live ingest credential and enabled
  collection, and exits 1 without one (`backfill-cli.ts`).
- The printed survey covers **7 of 13** collector sources. A harness absent from it is still
  backfilled — "none found on disk in this window" is not evidence.
- `--since 6m` is 180 days, not six calendar months; `Ny` works and is undocumented; an
  unparseable value is rejected, never defaulted. No `--since=30d` form.
- On a `policies:pull`-only key it fails with "not connected" while `config --status` says
  connected — backfill needs the **ingest** credential.

Rewinding cursors alone would silently deliver 7 days no matter what `--since` asked for;
the daemon widens its first-sight window in the same operation
(`crates/failproofaid/src/main.rs`, grep `BACKFILL_SINCE_DAYS`). Re-sending is safe —
redaction is deterministic, so a re-sent event collapses into the row already there.

## `flush` says "Nothing spooled" but the dashboard is empty

Two distinct causes, one message. **The backfill race:** `flush` returns exit 0 the instant
the spool is empty, which it is immediately after `backfill` — that only wrote a request
file the daemon drains on its next tick.

**Parked batches are not counted:** `pendingBatches()` walks only the subdirectories of
`~/.failproofai/state/spool/` (`flush-cli.ts`, grep `spoolDirs`). Refused batches live in a
*sibling* directory flush never looks at, so "Nothing spooled" is fully compatible with
dozens of undelivered batches.

```bash
ls ~/.failproofai/state/failed/ | head
```

## Ingest rejected — 401/403 with parked batches

The uploader records the server's verdict in the parked batch's **filename** — a rename, not
a sidecar, so the record cannot desynchronise from the batch it describes:

    claude-2026-08-11-0.a3.c401.jsonl
                       │   └── client_status — the server's definitive refusal
                       └────── attempt count before it was parked

401 is a rejected key; 403 is a key accepted but lacking `events:add`. Both fail identically
until a human fixes the cause, so `is_auto_retryable()` excludes them
(`crates/fpai-collect/src/uploader.rs`): they are **never retried and never deleted**, and
the count only grows — so a rising number is not evidence of a *new* failure. The incident
this reporting exists for: a key revoked at 13:05:37 and replaced 37 seconds later was still
producing 401s twenty minutes on, with 26 parked batches and a CLI saying "connected".

```bash
failproofai config --connect https://app.befailproof.ai --token "<working key>"
sudo systemctl restart failproofaid@$USER.service  # collector caches its bearer at start
failproofai backfill --since 7d                    # parked batches are never resent
failproofai config --status
```

The `dashboard` row returning to `sending hook activity to …` is the confirmation.
Everything *above* that row is read from the credential file and describes connect time,
never now — trust the rejection row when the two disagree.

## Version skew, and the delayed outage

`config --status` puts the triad in its heading:

    CLI 1.0.2-beta.0 · daemon 1.0.1 (STALE) · layout 4

`npm install -g failproofai@latest` replaces the CLI and **nothing else**. Across a layout
bump it arms a *delayed* outage: the running daemon read the layout marker once at startup
and keeps serving from memory, and the failure lands at the next reboot or restart, when
`refuse_foreign_layout()` exits, `Restart=on-failure` trips the start limit, and the unit
latches `failed`. `healDaemonFlag()` will not rescue it — a layout-refusing unit reads as
`stopped`.

```bash
npm install -g failproofai@latest
failproofai update            # migrations + matching daemon binary + restart
failproofai config --status
```

`update` and `migrate` both work, and so do `update --help` and `migrate --help` — both names
are in the `SUBCOMMANDS` array the top-level help guard checks (`bin/failproofai.mjs`, grep
`SUBCOMMANDS`), so each reaches its own help screen. `update` never prunes old daemon
binaries — only the wizard does — so `~/.failproofai/bin/` accumulates one file per version.

## The unit latched "start request repeated too quickly"

The unit ships `Restart=on-failure` with `RestartSec=2`. A definition systemd accepts but
cannot run cycles, trips `DefaultStartLimitBurst` (5) inside `DefaultStartLimitIntervalSec`
(10s), and latches. On **systemd 255** — ubuntu-24.04 and GitHub's runners — that latch is
sticky at the unit level: a later `systemctl restart` is refused *even after the definition
on disk has been replaced with a good one*.

```bash
sudo systemctl reset-failed failproofaid@$USER.service
sudo systemctl restart failproofaid@$USER.service
```

`failproofai update` does the `reset-failed` for you (`daemon-service.ts`, grep
`restartSystemdUnit`). If it starts and immediately dies again, look for a second daemon:
two for one user cannot coexist — the loser of the flock race exits, which is why every
install path first removes the pre-1.0.0-beta.1 user unit
(`~/.config/systemd/user/failproofaid.service`) and the un-namespaced LaunchDaemon.

## Windows

The daemon is Linux and macOS only (`daemon-service.ts`, grep `isDaemonSupportedPlatform`):
no policy pull, no session capture, no delivery. `flush` refuses outright ("failproofaid
does not run on win32, and it is what delivers batches"), but `config --connect` **still
stores credentials** and reports they "will work on a supported machine" — so a Windows box
can look connected forever and ship nothing. `config --status` carries the same as a warning
line. None of the onboarding docs mention any of it. Local hook policies still evaluate
in-process, since `daemon.configured` can never be set where the wizard cannot install a
daemon.

## A second profile or container home is never captured

Each agent CLI is watched only where its own installer put it. A second profile, a mounted
team share, a container home beside the host's, an agent an operator moved — all hold real
sessions that nothing collects.

```bash
failproofai harness add-path claude work=/srv/team/.claude/projects
failproofai harness list
journalctl -u failproofaid@$USER.service | grep 'ignoring extra path'
```

`add-path` deliberately reports **"configured", not "now capturing"** (`harness-cli.ts`,
grep `configured`) — it cannot pre-check the rejection that matters most.

| Cause | Where it surfaces |
|---|---|
| Path overlaps the harness's own default capture root | daemon journal only, at startup |
| Two entries share a normalised label (`Team Share` ≡ `team-share`) | refused by the CLI, or one clobbers the other's cursor |
| `collector.sessions` is false | nowhere — the extras block is never read |

Labels matter beyond collisions: two locations holding the same project derive the **same**
agent id from the cwd inside the transcript, so unlabelled they merge into one agent whose
sessions interleave. `FAILPROOFAI_<HARNESS>_EXTRA_PATHS` **replaces** the file's list rather
than appending, and being an env var it cannot reach a system-scope service unit at all — a
shell export configures nothing for an installed daemon.

## `--connect` exited 1 but ingest actually works

The exit code tracks only the **policy** half (`cloud-enrollment-cli.ts`, grep
`exitCode = outcome.policy.ok`). An `events:add`-only key writes a working ingest
credential, prints `Connected to <url> as <id>, for dashboard reporting only.`, and still
exits 1 — never
`&&`-chain on this command. The reverse, a `policies:pull`-only key, exits **0** with a
permanently empty dashboard, which is the more dangerous direction. Both halves are probed
before anything is written and only what verified is written, so a partial success is normal
and reported per-half.

## The wrong CLI answered

Three binaries can sit on `PATH` at once and two of them answer to cloud-shaped commands.
`failproofai` is local enforcement (npm, Node >= 20.9) and is what almost all of this file
is about. `fp` is the cloud control plane — dist `fp-cloud-cli`, installed with `uv tool
install fp-cloud-cli`. `agenteye` is the **legacy** cloud CLI: still installable, still
working for what it has, but with no `policies`, `fleet`, `guardrails` or `usage` at all. A
script that reaches for `agenteye` on a machine that also has `fp` gets "no such command"
for every enforcement surface and reads it as a missing feature rather than the wrong
binary.

```bash
command -v fp agenteye     # resolve once; prefer fp, which is listed first
fp version
```

Never write `uv tool install fp-cli`: `fp_cli` is the module name, the distribution is
`fp-cloud-cli`. Environment follows the binary that reads it — `FP_*` for `fp`,
`AGENTEYE_*` for the legacy CLI, `FAILPROOFAI_*` for the local one — with two exceptions
worth knowing before you export anything. `AGENTEYE_HOME` is **not** a cloud setting; it is
the local daemon's spool path (`~/.agenteye/events`) and the daemon still watches it.
`FAILPROOFAI_HOME` *is* read by both, because `fp` keeps its session at
`~/.failproofai/fpcli/cli-auth.json` — inside the local home — so a stale export moves the
cloud session file too.

## `fp <command> --json` exits 2 with "No such option: --json"

Global options go **before** the command; a command's own options go after it. Getting it
backwards is a usage error with its own exit code, and the CLI says so in the hint:

```
$ fp sessions --json
{
  "error": "No such option: --json (Possible options: --since, --to)",
  "exit_code": 2,
  "hint": "global options go before the command, e.g. 'fp --json <command>'"
}
```

The trap is the first line, which names the *command's* options and reads like `--json` was
removed from the product. It was not; it was misplaced. The globals are exactly `--json
--base-url --org --token --api-key --insecure/--secure --timeout --quiet --no-color`, and
they precede the command even when a subcommand has its own flags after it:

```bash
fp --json sessions --since 24h
fp --json keys create ci-bot --permission-set read-only
```

## `whoami` looks signed in but every other command fails

`fp whoami` **exits 0 whether or not you are signed in.** Logged out it prints a well-formed
result and returns success:

```bash
fp --json whoami
```
```json
{ "logged_in": false, "auth_mode": "none" }
```

So `fp whoami >/dev/null && …` proves nothing, and a guard written as "exit 4 means not
signed in" is watching for a code this command never returns. Branch on the **field**:

```bash
fp --json whoami | grep -q '"logged_in": *true' || fp login
```

Because the check passes and each later command then fails on its own auth error, this
presents as "everything broke at once" rather than "I am logged out".

## `policies`, `fleet` or `guardrails` exit 2 in CI

They are **refused under an API key**, deliberately. An API key authenticates the versioned
read API; cloud-managed policy is an operator surface that is not on it:

```
$ FP_API_KEY=… fp --json policies list
{
  "error": "`fp policies` does not work with an API key — cloud-managed policies are an operator surface and are not exposed on the versioned API that an API key authenticates against.",
  "exit_code": 2,
  "hint": "drop --api-key / FP_API_KEY and sign in with fp login"
}
```

`fp --help` states the same rule in one line: under `--api-key` / `FP_API_KEY`, *login,
orgs, agent, policies, fleet and guardrails* all exit 2. Sessions are interactive, so **CI
cannot publish, deploy, promote or roll back a policy.** Do not build a pipeline around it,
and do not read the exit 2 as a revoked key.

The one exception is the one CI actually wants, and it needs no credential at all:

```bash
fp policies test ./rule.mjs --command "git push --force origin main" --expect deny
```

`policies test` is local: no server, no fleet, no auth. It needs only `node` on `PATH`, and
the CLI shims the module itself, so a bare `import { deny } from "failproofai"` resolves
with nothing installed in the working directory. `--expect allow|deny|instruct` exits 1 when
the decision does not match, which is the whole CI gate. Under `--json` it returns `{ok,
decision, policies:[{name, description, decision, reason}], syntax, expected, met}` and the
overall `decision` is the **strictest** any registered policy returned:

```json
{"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny","reason":"…"}]}
```

State its limit honestly rather than selling it as a rehearsal: it proves the policy parses,
registers and decides for the input you gave it. It cannot prove the daemon feeds it the
same context.

## Published a policy and nothing changed on the machine

**Publishing deploys nothing.** `fp policies publish <policy_id> [source]` mints a *new
version* — it never edits one in place — and that version sits unused until something
assigns it. The assignment is a separate command:

```bash
fp --json policies publish <policy-id> ./rule.mjs   # new version; nothing runs it yet
fp --json fleet list                                # which machine, on which version
fp fleet deploy <machine-id> --add <policy-id>@<version>:observe
```

`policies publish --json` answers the question itself: alongside the created version it
returns `carriers`, a machine id → currently-running version map. If the version you just
minted appears against no carrier, nothing is enforcing it. The lifecycle is compose → test
→ publish → **fleet deploy** → guardrails, and only the last two change what a machine does.

Two silent traps at the deploy step:

- **A bare `--add` on a policy the machine does not already run enforces it.** The ref
  grammar is `id`, `id@version`, `id:effect` or `id@version:effect`, and the effects are
  exactly `enforce` and `observe`. Omit the effect on a new assignment and you get
  `enforce` — a live block on real tool calls. Write `:observe` when you mean to watch
  first. On a policy the machine *already* runs, a bare `--add` keeps the pinned version
  rather than upgrading it; pass `id@version` to move it.
- **`--set` replaces the whole set wholesale** and cannot be combined with `--add` /
  `--remove`. Refs are **not** comma-split — repeat the flag (`--set a --set b`).

Neither a no-op nor a refusal is an error, so never read exit 0 as "it deployed": a deploy
that changes nothing exits **0** with `applied: false`, and a declined confirmation exits
**0** with `cancelled: true`. The write is a full replace with no server-side lock, so the
CLI records the generation it read and refuses anything that is not exactly one higher —
that is exit **1**, it means somebody else deployed in between, and a replace does not
merge. Re-read the current set before retrying rather than retrying blind. `--create` will
happily mint a machine record from a typo'd id, so check `fleet list` first.

When enforcement must actually stop: **`disable` stops it, `delete` does not.** Deleting a
policy archives it; whatever is already deployed keeps running.

One more permission trap at the other end of that lifecycle: `fp policies compose
"<prompt>"` asks the cloud assistant to draft a policy, and it is gated on **`policies:write`,
not `agent:use`** — the route is wrapped in the policies permission despite the name. A role
holding only `agent:use` is refused; one holding `policies:write` and no `agent:use` works.
It is session-only like the rest of the family.

## Commands that lie to you

Local `failproofai` unless the row names `fp`.

| Command | What it reports | What is actually true |
|---|---|---|
| `config --connect` | exit 1 | policy half failed; ingest may be perfect |
| `config --status` | `connected` | read from the credential file at connect time, not now |
| `flush --wait` | exit 1 | may be a timeout on a healthy large backlog (60s default) |
| `flush` | `Nothing spooled` | `state/failed/` is not counted |
| `failproofai audit` | exit 75 | `EX_TEMPFAIL` — another audit holds the lock; not a failure |
| `harness add-path` | `configured` | the daemon may refuse the path at startup |
| `failproofai policies` | exit 0, a normal listing | a pack that will not load is a warning row, not a failure — read the rows, not the exit code |
| `fp whoami` | exit 0 | exits 0 **either way** — read `.logged_in`, never the exit code |
| `fp policies publish` | a new version | deploys nothing; the machines keep running the old one |
| any subcommand | stdout | on a non-zero exit **every** line goes to stderr instead |

**Silently accepted typos.** The `config` branch validates *no* unknown flags at all — the
top-level guard sits after it and never runs. So `--no-transcript`, `--notranscripts`,
`--verbose`, anything, is ignored with exit 0, and full transcripts (prompts, file contents,
whatever was pasted into a terminal) ship to the cloud. Confirm the setting with
`config --status`, never with the exit code.

- **`--flag=value` works in `failproofai` only on the pack/publish lane and `--cli`**:
  `--cli=`, `--out=`, `--effect=`, `audit --email=`, and `--policy=` / `--only=` /
  `--category=` on `policies add`. Every other parser is hand-rolled around whole-token
  comparison, so `--since=6m` and `--scope=user` fail with "Unexpected argument" —
  `--scope` sits beside `--cli` in the same `policies add` line and still does **not** take
  the equals form. This rule is **local only** — `fp` parses `--timeout=5` and every other
  valued option in the equals form happily, so do not carry the habit either way between the
  two binaries.
- `--cli` consumes values greedily and stops at the first token that is not a recognised CLI
  name, so `--cli bogus` reports *"Missing value(s) for --cli"* — while
  `--cli claude block-sudo` correctly reads `block-sudo` as a policy, so a **typo'd CLI name
  is silently reinterpreted as a policy**.
- Three env vars require the exact string `1`: `FAILPROOFAI_TELEMETRY_DISABLED`,
  `FAILPROOFAI_NO_FIRST_RUN`, `FAILPROOFAI_NO_AUTO_AUDIT`. `=true`, `=yes`, `=on` do
  nothing.
- `audit --scheduled` (a hidden ~100-second headless scan) is one letter away from
  `audit --schedule` (which writes config). `--sched` is rejected; `--scheduled` runs.

On an unconfigured machine the first-run wizard can hijack the command you typed. Only
`config`, `policies`, `policy`, `uninstall` and `backfill` are exempt — so `update`,
`migrate`, `flush`, `harness`, `pack` and `audit` all drop into onboarding first, including
`update`, the recovery command for a broken install (`first-run-gate.ts`, grep
`FIRST_RUN_EXEMPT_SUBCOMMANDS`).
