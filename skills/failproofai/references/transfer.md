# Transfer: moving data, and moving machines

`backfill`, `flush`, `harness`, the re-enrol sequence, `update`/`migrate`, `uninstall`. One
property causes most of the confusion here: **the CLI does not do the work, it writes a file
the daemon reads.** Every success line below means "requested", not "delivered".

## The two request files

`backfill` and `flush` are the same shape — one small 0600 JSON file, then return.

| Command | Writes | Grep |
|---|---|---|
| `backfill` | `~/.failproofai/state/backfill-request.json` | `backfillRequestPath` |
| `flush` | `~/.failproofai/state/flush-request.json` | `flushRequestPath` |

Both drain on the collector manager's tick — **5000 ms by default** (`main.rs`, grep
`collector_config_poll_interval`; floor 500 ms; `FAILPROOFAI_COLLECTOR_CONFIG_POLL_MS`
overrides it, but the daemon reads that from *its* environment and a system-scope unit
inherits essentially nothing from your shell). Each request is deleted *before* it is acted
on, so it is honoured once and an unparseable one is discarded, not retried.

They hand off the work but **not the checking** — every precondition a person can get wrong
is verified synchronously before returning. The alternative already happened on a real
machine: the CLI reported success while the failure sat in the journal for twenty minutes
and batches parked (`backfill-cli.ts` header).

## `backfill` — history the collector has already read past

The collector never re-reads a file it holds a cursor for. This is the only override.

```bash
failproofai backfill --since 6m --dry-run
failproofai backfill --since 6m
```

`--since` grammar (grep `Could not read --since`): `<n>d`, `<n>m`, `<n>y`, or anything
`Date.parse` takes. **`m` is 30 days and `y` is 365 days**, flat — not calendar months.
Default 30 days. An unparseable value is rejected, never silently defaulted; `--since=6m` is
rejected too, there is no equals form.

Daemon-side it is **two** operations in one tick, and the second is load-bearing: cursors are
rewound (`rewind_cursors_for_backfill`) *and* the first-sight window is widened
(`set_backfill_window_days`). Without the widening `new_cursor` refuses any file older than
the default 7 days and gives it no cursor at all — so a backfill asking for 30 days would
**silently deliver 7**, and the dashboard would look complete.

| Gotcha | Consequence |
|---|---|
| `--dry-run` is **not** pure inspection | The ingest-credential and collection-enabled checks run *before* the survey. On an unconnected machine: exit 1, no survey at all |
| The survey covers **7 CLIs; the daemon collects from 13 sources** | `SESSION_DIRS` lists Claude Code, Codex, Cursor, Copilot, OpenCode, Factory Droid, Antigravity. A harness absent from the printout is **not** excluded from the backfill — the message is quieter than the truth |
| The survey walks `dirname(failproofaiHome())`, not `$HOME` | Under `FAILPROOFAI_HOME=/srv/fp` it surveys `/srv/.claude/…`. The count is wrong; the backfill is not |
| A stopped daemon is **not** fatal | Exit 0, request written, one advisory line. Honoured whenever the daemon next starts |
| Re-sending is safe | Redaction is deterministic, so a re-sent event hashes identically and collapses into the row already there |

Refusals in `runBackfillCommand`'s own order, all exit 1: no home; no ingest credential;
`collector.hooks` and `collector.sessions` both false.

## `flush` — deliver what is already spooled

The sweeper is unhurried on purpose: batches older than 120 s, ≤64 per pass, 60 s cadence.
`flush` drops the minimum age and the per-pass cap for one pass. It is the "am I waiting or
is it broken" command.

```bash
failproofai flush --wait --timeout 180
```

Preconditions, in order, each exit 1 with a different remedy: collection off → not connected
→ unsupported platform → daemon not `running`. Then the spool count, where empty is exit 0.
`--timeout` takes a positive finite number of seconds; `NaN` is rejected, not coerced.

- **On macOS with an expired sudo timestamp, `flush` hard-fails against a healthy daemon.**
  `daemonServiceStatus()` returns `"unknown"` on darwin when `!root && !canElevate()` — a
  LaunchDaemon is in launchd's system domain and reading its state needs the same elevation
  installing it did. `flush-cli.ts` tests `status !== "running"` with no `unknown` branch.
  Run `sudo -v` first. (`cloud-enrollment-cli.ts` handles `unknown`; flush does not.)
- **`flush` counts the spool but not `failed/`.** `pendingBatches` skips that directory by
  name, so a machine with 26 batches parked on a 401 gets `Nothing spooled — everything
  already delivered.` and **exit 0**. Read the `dashboard` row of `config --status`
  (`deliveryHealth`) — the only thing that describes now rather than connect time.
- **`--wait` exits 1 on timeout, and a timeout is not a failure.** A large backlog
  legitimately outruns the 60 s default. Never gate CI on this exit code.
- **`flush` and `backfill` disagree about a stopped daemon** — 1 and nothing written vs 0 and
  the request written. A script treating them alike misreads one.

### The backfill → flush race

Back to back, this reports success while nothing shipped. `backfill` returns in
milliseconds; `flush` then reads the spool **now**, finds it empty because the daemon has not
ticked yet, prints "Nothing spooled — everything already delivered" and exits 0.

The real sequence is tick (≤5 s), rewind cursors, rebuild the collector, re-read the files —
minutes for six months of transcripts. Watch `config --status` until batches appear, *then*
flush. On Linux the journal says it outright: `backfill requested; re-reading those sessions
from the start`, with `cursors_forgotten` and `window_days`.

## `harness` — capture from more than one location

```bash
failproofai harness list [<harness>]
failproofai harness add-path <harness> [<label>=]<path>
failproofai harness remove-path <harness> <path|label>
```

Twelve valid keys (`HARNESS_KEYS` in `harness-cli.ts`, asserted against `main.rs` by test):

    claude codex copilot openclaw pi factory antigravity cursor goose opencode devin hermes

Twelve keys, thirteen sources — `claude` covers subagent transcripts, same root. The harness
name is the one thing validated CLI-side, because `collector.sources.claud` is valid JSON
that parses cleanly and captures nothing.

**The grammar splits on the FIRST `=`.** A bare path *containing* one is therefore read as
`label=path`: `/mnt/share=1/.claude/projects` becomes label `mnt-share`, path
`1/.claude/projects`, silently. Pass an explicit label whenever the path is unusual. The
label namespaces agent ids as `<label>-<agentId>` and exists because two copies of the same
project derive the *same* id from the cwd inside the transcript — unlabelled they merge into
one agent whose sessions interleave. Labels are sanitised daemon-side (`sanitize_label`,
`extra_paths.rs`): lowercased, non-alphanumeric runs collapsed to one `-`, dashes trimmed;
unlabelled entries derive from the final path component with leading dots stripped.

| Rejection | Caught by | Visible via |
|---|---|---|
| Same path, normalised (`~` expanded, trailing `/` trimmed) under a different label | CLI, exit 1 | immediately |
| Same **effective** label — `"Team Share"` vs `team-share`, or two unlabelled paths whose folder names collapse alike | CLI, exit 1 | immediately |
| Path overlapping the harness's **own default root**, either direction (`overlaps` is lexical `starts_with`, no symlink resolution) | **daemon only** | `harness list`, or `ignoring extra path …` in the journal |
| A label a default task already reserves (Hermes derives one per profile database) | **daemon only** | same |

The success line says `configured`, deliberately **not** "now capturing" — teaching the CLI
all thirteen default roots would be the second parser the module exists to avoid. **Verify
with `failproofai harness list` a few seconds later, never with the add-path exit code.**

- **Extra paths are read only when `collector.sessions` is true.** The whole extras block in
  `main.rs` sits inside `if cfg.settings.sessions`. On a hooks-only machine `add-path`
  reports success and writes config nothing ever reads.
- **`FAILPROOFAI_<HARNESS>_EXTRA_PATHS` replaces the file's list rather than appending** —
  and being an env var it cannot reach a system-scope unit at all.
- No restart, no sudo: one file in your own home, picked up on the next tick.
- `harness` is **not** first-run exempt (`FIRST_RUN_EXEMPT_SUBCOMMANDS`), so on an
  unconfigured machine `harness list` drops into onboarding first. `backfill` is exempt;
  `flush`, `migrate` and `update` are not.
- `remove-path` matches the whole entry, its path, *or* its label — whichever `list` showed
  you. It stops new capture only; delivered sessions are on the server and stay.

## Re-enrol a machine into a different org

```bash
failproofai config --disconnect
sudo systemctl restart failproofaid@$USER.service     # only if you need it stopped NOW
failproofai config --connect <new url> --token <new key>
failproofai backfill --since 6m
```

`runDisconnectCommand` does four things: clears the cloud (policy) table, clears the ingest
table, **clears the active cloud-managed policy set** — so those policies stop being
*enforced*, not merely refreshed — and sets `mode: "oss"`. Before that third part existed a
machine that had deliberately left its organisation went on being governed by whatever
deployment was current when it left, indefinitely, while `--status` called it unconnected.

**`--disconnect` does not stop the running daemon from shipping.** The uploader caches its
bearer key at construction, so "no new hook activity will be queued" was only ever true of
the *next* daemon start. The collector manager does cycle on a config change within a tick
(which covers a credential swap); the restart is for certainty.

### Keep the machine id, or reset it

`resolveMachineId` (`cloud-enrollment.ts`) resolves most-explicit first:

1. explicit `--machine-id`
2. the id in the **cloud credential** — what the server keyed enrolment, deployment and
   history on, so it deliberately outranks the collector value
3. `collector.machineId` in `config.json`
4. a fresh random UUID

So a plain `--connect` after `--disconnect` **reuses the existing id** and the machine keeps
its identity in the new org. To present as genuinely new, pass `--machine-id "$(uuidgen)"`.
Never pass `--machine-id "$(hostname)"` on more than one machine — they silently merge into
one row. Backfill afterwards is not optional if you want history: the new org has none of it,
and the collector will not re-read a file it holds a cursor for.

### Rename without reconnecting

```bash
failproofai config --machine-label "Nikita's Mac"
```

`--machine-label` **alone** is a rename (`wantsRename` — set only when neither `--connect` nor
`--disconnect` is present); alongside `--connect` it keeps its old meaning of "the name to
enrol under". It stores locally first, then rides the next desired-state request, so an
unreachable server is not a failure and it **exits 0 either way**. Two edges: it needs the
**cloud (policy) credential**, so an `events:add`-only machine gets exit 1 and "has no name
to change" despite holding a working machine id; and the label is never the identity —
mutable, and free to collide.

## Upgrade: the version triad

Three versions move independently — the npm CLI, the daemon binary at
`~/.failproofai/bin/failproofaid-<version>`, and the `~/.failproofai` layout
(`LAYOUT_VERSION = 4`, `fp-home.ts`). `config --status` prints all three on one line
(`versionStatusLines`): `CLI 1.4.0 · daemon 1.3.2 (STALE) · layout 4`.

```bash
npm install -g failproofai@latest    # replaces dist/cli.mjs and dist/worker.mjs. Nothing else
failproofai update                   # migrations, matching daemon binary, restart
```

**npm alone arms a delayed outage across a layout bump.** The running daemon read the layout
marker once at startup and keeps serving from memory; the failure lands at the next reboot,
when `refuse_foreign_layout()` exits, `Restart=on-failure` trips the start limit and the unit
latches `failed`. `healDaemonFlag()` will not rescue it — a layout-refusing unit reads as
`stopped`, which it deliberately excludes. `update`, in order: `detectLayout()`; a **newer**
layout is refused outright (the CLI is the stale half); a stale one runs `runMigrations`;
then `refreshDaemonToCliVersion()` unless `--no-daemon`; then `writeVersionFile({ daemon })`.

| Fact | Why it matters |
|---|---|
| `update` never *installs* a daemon | On a machine with no service it returns ok with "nothing to update". Only the interactive wizard installs one |
| `daemon.configured` is deliberately untouched | An update refreshes what is installed; it does not decide whether the machine requires it |
| The daemon is refreshed **even when a migration step failed** | Independent halves; the exit code still reports the failure |
| sudo is primed only on a TTY | On CI it falls through to `sudo -n`, fails, and prints the exact commands |
| `update` does **not** prune old binaries | Only the wizard calls `pruneOldDaemonBinaries`; `bin/` accumulates one file per version |
| `daemonVersionSkew()` is a file check | Null when `FAILPROOFAI_DAEMON_BINARY` is set or the recorded binary is gone. It never queries the running process |
| `update --help` and `migrate --help` **error out** | `Unexpected argument: update` — neither name is in `SUBCOMMANDS`, so the top-level help guard fires before they are ever dispatched and their help blocks are unreachable. The commands themselves work |

### `migrate --dry-run`

Prints the chain (`Layout 2 on disk; this build speaks 4`, then each step) and the exact
basenames that would be copied to `migrations/backup-layout<n>/` first. Steps are keyed on
the **layout**, not the npm version — skipping thirty releases with no layout change runs
zero migrations. It normally happens by itself on the first command after an upgrade;
`migrate` is for doing it deliberately and seeing it first. A *newer*-than-current layout is
refused here exactly as `update` refuses it.

- The backup is taken **once**, against the layout actually found, before the first step. A
  step that throws stops the chain and does **not** roll back — `runMigrations` un-stamps
  `VERSION` back to that step's `from`, because a step stamps `LAYOUT_VERSION` rather than its
  own `to`, and a two-hop chain would otherwise leave a home marked *current* that was never
  migrated and that nothing would ever retry.
- **The backup keeps a copy of a live bearer credential.** `migrations/` is classed
  `identity` so no reset removes it, and only *moved* sources are pruned (clean chains only);
  a *deleted* source's backup is the last copy and must stay. Treat
  `migrations/backup-layout<n>/` as secret material in any dotfile backup or image.

## `uninstall`

```bash
failproofai uninstall            # hook entries everywhere; ASKS about the daemon service
failproofai uninstall --purge    # also deletes ~/.failproofai; removes the service outright
failproofai uninstall --yes      # skips the prompt — and this DOES remove the service
npm rm -g failproofai            # only after one of the above
```

**Order is the safety property, and not the obvious one.** `daemon.configured` is cleared
*first* — before hooks, before the service, before anything that can fail or need a password.
From that instant the machine can only fail **open**. The intuitive order leaves a window
where the flag demands a daemon that is already gone: a total lockout of every agent CLI.

- **`npm rm -g failproofai` runs no uninstall script.** It deletes `dist/worker.mjs` and
  leaves the root-owned unit, the daemon binary, and hook entries in up to twelve CLIs — and
  those entries invoke `npx -y failproofai`, which re-downloads the package, so a "removed"
  failproofai keeps running on every tool call.
- **`--yes` removes the service.** It means "yes to the plan", and the plan always included
  it. The only case that keeps the daemon is an *interactive* run where the person declined
  or could not be asked.
- **`--purge` never asks**, because it deletes the binary the unit's `ExecStart` points at;
  leaving the unit enabled is a boot-time crash loop.
- **No TTY and no `--yes` is a refusal**, never an assumed yes. Exit 1, nothing changed.
- Any unrecognised argument is rejected **including a bare positional** — this parser checks
  `!KNOWN.has(a)` with no leading-dash guard.

Exit codes: `0` clean; `1` something durable is still installed and you must act (the output
prints the exact `systemctl`/`launchctl` commands); `2` `config.json` could not be updated,
so it stopped *before* touching the service rather than risk the lockout. After a purge
nothing may touch the home — `getInstanceId()` lazily writes `state/telemetry-id`, which once
re-created the whole directory seconds after the purge reported deleting it.
