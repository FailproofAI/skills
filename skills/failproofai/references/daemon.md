# The daemon: `failproofaid`

A compiled Rust service, one process per OS user, that a machine deliberately opts into. It
exists so hooks are evaluated by one warm process instead of a cold Node start per tool call
— and once it exists, it also pulls cloud-managed policy, collects transcripts, runs scheduled
audits, and ships all of it to FailproofCloud. Linux and macOS only.

`run()` in `crates/failproofaid/src/main.rs` starts **six lanes** on their own threads, all
watching one `shutdown` AtomicBool: telemetry (first, so even a bind failure reports), the
warm-worker pre-warm, cloud policy, the collector manager, the scheduled-audit lane, and last
the socket accept loop. Singleton is an advisory flock on
`~/.failproofai/run/failproofaid.lock` (`main.rs`, grep `lock::acquire`) — a second daemon for
the same user loses the race and exits.

## Fail-closed, in full

`daemon.configured` is a boolean in `~/.failproofai/config.json`. Once true, the `--hook`
branch in `bin/failproofai.mjs` (grep `attemptDaemonHook`) routes **every** hook through the
socket and, on any failure to get a verdict, calls `evaluateHookEvent` with
`forceDecision: { decision: "deny" }`. No in-process fallback exists on that branch — one
would be a second policy engine reachable by breaking the first. The blast radius is total:
all 12 CLIs, every event, `UserPromptSubmit` included, so the user cannot even ask their agent
what happened.

| Failure | Message says | Real cause |
|---|---|---|
| `protocol-mismatch` | "running a different protocol version … Run `failproofai config`" | a daemon answered, but it and the CLI are different vintages — `npm i -g` not followed by `update` |
| `unreachable` | "failproofaid could not be reached … check the daemon" | nothing answered. Stopped service, deleted socket and tampering are indistinguishable from here |

**A protocol mismatch does not fall back either** — it denies exactly like an unreachable
daemon. A stale comment once said the opposite and the code was deliberately reversed
(`daemon-client.ts`, grep `deliberately reversed`); the distinction survives only in the
message. Two more edges: being **skipped by systemd on a failed `ConditionPathExists=`** is
not consent to stop enforcing — the machine still denies, the condition only shortens the
outage and explains it; and an **unreadable `config.json` reads as not-configured** on
purpose, since the alternative is a machine failing closed because a config file got
truncated. The flag is global-scope only, read with a single cheap global read, never the
merged project+local+global reader.

Two timeouts, two meanings (`daemon-client.ts`, grep `DAEMON_CONNECT_TIMEOUT_MS`):
`DAEMON_CONNECT_TIMEOUT_MS = 150` ("is anything listening" — never relax it, it is what keeps
a dead daemon from adding latency to every tool call) and `DAEMON_RESPONSE_TIMEOUT_MS =
30_000`, matched to the daemon's own worker read timeout.

## Diagnosing a machine that denies everything

Running **any** CLI command self-heals three provable cases first — `checkLayoutForCli()`
calls `healDaemonFlag()` at the top (`fp-reset.ts`, grep `healDaemonFlag`). Each clears
`daemon.configured` and prints why.

| Service status | Healed? | Means |
|---|---|---|
| `not-installed` | yes | the unit is gone, the flag stayed |
| `condition-failed` | yes | systemd refused to start it, a gated path is missing. This is what `npm rm -g failproofai` leaves behind |
| `running` but `probeDaemonEndToEnd()` fails | yes | the worker will not spawn — classically `nvm uninstall` after `ExecStart` baked in `process.execPath` |
| `stopped` | **no, deliberately** | usually a restart in progress; clearing here trades a loud correct failure for a quiet wrong one |
| `unknown` (darwin only) | no | installed, state unreadable |

**The `stopped` exclusion is exactly where the layout-skew outage lands.** A daemon built
against a different on-disk layout calls `refuse_foreign_layout()` before binding and exits
(`main.rs`); the unit trips `Restart=on-failure`, latches `failed`, and reads as `stopped`.
Self-healing will not rescue it. `failproofai update` will.

1. `failproofai config --status` — runs the self-heal, prints the version triad.
2. Versions differ → `failproofai update`.
3. Unit latched "start request repeated too quickly" (systemd 255 makes this sticky at unit
   level even after the definition is replaced) → `restartSystemdUnit()` runs
   `systemctl reset-failed` before `restart`, reached via `failproofai config` or `update`.
4. Last resort, no CLI needed: set `daemon.configured` to `false` in
   `~/.failproofai/config.json` by hand. Policies then evaluate in-process.

**The trap nothing detects:** setting `FAILPROOFAI_HOME` for one process and not the other.
The daemon binds one socket, the hook looks for another, and the machine denies every tool
call with a perfectly healthy daemon running the whole time
(`crates/failproofaid/src/paths.rs`, grep `run_dir`). Relatedly the npm `failproofaid` bin
shim **ignores `FAILPROOFAI_HOME`** and hardcodes `homedir()` — on a relocated home it reports
"not installed" against a binary that is present (`bin/failproofaid-shim.mjs`).

Logs: Linux → stderr into journald, `journalctl -u failproofaid@$USER.service`. macOS →
`~/.failproofai/logs/failproofaid.log` and `.err.log`. `RUST_LOG` overrides the default `info`
filter — but only inside the unit's environment, which a shell export cannot reach.

Four checks, four questions; never treat them as synonyms (`daemon-client.ts`, grep
`daemonAcceptsConnections`): `daemonSocketPresent()` (a stale socket outlives its process),
`daemonAcceptsConnections()` (succeeds even when the worker behind it is dead),
`daemonServiceStatus()` (blind to a hand-run dev daemon that is genuinely enforcing), and
`probeDaemonEndToEnd()` — the only one that counts. **`running` is not proof:** a `Type=simple`
unit is active the instant systemd forks it, and `ping` is answered in `server.rs` without
touching the worker. On darwin, status returns `"unknown"` whenever `!root && !canElevate()`;
folding that into `stopped` made healthy daemons look dead.

## Installing it

**Only the interactive `failproofai config` wizard installs the daemon.** There is no
`failproofai daemon install|start|stop` subcommand at all — grep confirms no `=== "daemon"`
dispatch in `bin/failproofai.mjs`. `config --connect` never installs one.

The wizard's step 0, in order (`configure-wizard.ts`, grep `installDaemonService`):

1. `primeElevation()` runs `sudo -v` once with inherited stdio so the prompt is visible; every
   later privileged step uses `sudo -n` and never prompts from under the TUI.
2. `ensureFailproofaidBinary()` resolves or installs the binary. Any pre-1.0.0-beta.1
   user-scope daemon or LaunchAgent is removed — it holds the same flock the new one needs.
3. The unit or plist is staged in a `mkdtempSync` 0700 directory and placed with
   `install -m 0644` into the root-owned location — never a shell redirect into a predictable
   `/tmp` name. Linux then does `daemon-reload`, `enable`, `reset-failed` + `restart`; macOS
   does `launchctl unload` (best effort), write, `launchctl load -w`.
4. `waitForDaemonRunning()` — 5s to reach running, then a **watched** 750ms settle window that
   exits early the moment the socket accepts.
5. `probeDaemon()` sends a real `SessionStart` hook end to end, retrying every 150ms for up to
   10s. A protocol mismatch counts as OK here: a daemon answered.
6. Only now `setDaemonConfigured(true, cliVersion)` and `pruneOldDaemonBinaries()`.

The daemon step runs **before** any hook config is touched, so a failure leaves the machine
exactly as it was. Everything in `daemon-service.ts` and `daemon-download.ts` fails closed and
never throws — a daemon that cannot be fetched leaves the machine on the in-process path.
**Never infer "a daemon was installed" from an exit code of 0.**

| | Linux | macOS |
|---|---|---|
| Definition | `/etc/systemd/system/failproofaid@<user>.service`, 0644 root-owned | `/Library/LaunchDaemons/ai.failproof.failproofaid.<user>.plist` |
| Runs as | `User=<user>` | `<key>UserName</key>` |
| Inspect | `systemctl status failproofaid@<user>.service` (no root) | `sudo launchctl print system/ai.failproof.failproofaid.<user>` |
| Restart | `sudo systemctl restart failproofaid@<user>.service` | `sudo launchctl kickstart -k system/…` |

Root-installed, **never root-run**. Socket, lock, credentials and policy config all live in one
user's home and the peer is checked against their uid (SO_PEERCRED / getpeereid) before the
first byte is read; a wrong-uid peer gets the connection dropped with no response. The per-user
unit name is not cosmetic — a shared name would let a second user's install steal the first's.
**Never run the CLI itself under sudo:** `homedir()` becomes `/root`, so hooks, policy config,
the downloaded binary and the unit's own `User=` all end up configured for root, silently.

The wizard bakes two absolute, shell-quoted commands into the unit environment:
`FAILPROOFAI_WORKER_CMD` (from `process.execPath` — a system unit inherits no login environment
and a bare `node` is not on the system PATH under nvm) and `FAILPROOFAI_CLI_CMD` for the audit
lane, whose absence is **silent**. Values containing a quote, backslash or newline are
**rejected, not escaped** (`assertUnitSafe`): a newline ends the directive and would inject
arbitrary settings into a root-owned, boot-loaded file. When it cannot elevate, the CLI prints
the exact `sudo tee … && daemon-reload && enable && restart` sequence verbatim — `restart`, not
`enable --now`, because `--now` is a no-op against an already-active unit, which once left the
OLD process running while the CLI recorded the NEW version and `pruneOldDaemonBinaries()` was
free to delete the binary that process had been started from.

## Where the binary comes from

`resolveFailproofaidBinaryPath()` (`daemon-service.ts`), in order: `FAILPROOFAI_DAEMON_BINARY`
(wins over everything, and **suppresses `daemonVersionSkew()` entirely**);
`~/.failproofai/bin/failproofaid-<version>`, the managed path — **one file per version, never
overwritten in place**, because in-place overwrite hits ETXTBSY against the running daemon on
Linux and would silently repoint a live unit at different source; then
`$FAILPROOFAI_PACKAGE_ROOT/target/{release,debug}/failproofaid`, a contributor's build, only
reachable when that env var is set.

If none exists, `ensureFailproofaidBinary()` installs — npm first, then GitHub:

| Channel | Verified against | Notes |
|---|---|---|
| npm optional package `@failproofai/failproofaid-<os>-<arch>` | the SHA-256 inlined into the root manifest as `failproofaidBinaries` at publish | no network — the only channel that works air-gapped or behind a proxy blocking github.com |
| Release asset `<base>/v<version>/failproofaid-<key>.gz` | `<base>/v<version>/SHA256SUMS` | the URL is **constructed** from this CLI's own version — no API call, no `releases/latest` |

`FAILPROOFAI_NO_DOWNLOAD=1` blocks only the second; `FAILPROOFAI_DAEMON_BASE_URL` repoints it
at an internal mirror. **On a dev build or unpublished commit there is no integrity check at
all on the npm channel** — the digest map is written at publish, and
`binaryDigestMismatch(null, …)` returns null meaning "nothing to compare", never "passed".
`pruneOldDaemonBinaries(keep = 2)` keeps current and previous so a rollback is a local file,
and **only the wizard calls it** — `refreshDaemonToCliVersion()` does not, so `bin/`
accumulates one file per version on a machine that only ever runs `update`.

## Upgrading, and why `npm i -g` is never enough

`npm install -g failproofai@latest` replaces `dist/cli.mjs` and `dist/worker.mjs` and **nothing
else**. The running daemon read the layout marker once at startup and keeps serving happily
from memory, so nothing looks wrong — until the next reboot or `systemctl restart`, where
`refuse_foreign_layout()` exits, the unit latches `failed`, and every tool call denies. Across
a layout bump, `npm i -g` alone **arms a delayed outage**.

`failproofai update` closes it: pending layout migrations first (backing up config.json,
credentials.json, policies-config.json and VERSION into `migrations/backup-layout<n>/`), then
`refreshDaemonToCliVersion()` — which runs the **full** `installDaemonService()`, not a binary
fetch plus restart, because `upgradedServiceDefinition()` deliberately preserves the installed
`ExecStart`; using it as an upgrade path once downloaded the new binary, rewrote the unit,
restarted, and brought the OLD binary back up under a success message. `update` writes
`VERSION.daemon` and **never touches `daemon.configured`** — an update refreshes what is
installed, it does not decide whether the machine requires it. `--no-daemon` migrates the home
only; off a TTY it falls through to `sudo -n`, fails, and prints the exact commands.

`update` and `migrate` both work — dispatched in `bin/failproofai.mjs` (grep
`args[0] === "update"`) *before* the `SUBCOMMANDS` guard. `update --help` and `migrate --help`
do **not**: neither name is in `SUBCOMMANDS`, so the top-level help guard fires first and
errors `Unexpected argument: migrate`. Their help blocks exist and are unreachable.

`daemonVersionSkew()` compares `VERSION.daemon` against the CLI's `package.json` version, for
the managed path only; on a `daemon.configured` machine `staleDaemonHint()` prints a much
louder message, because there a skew across a layout bump is a scheduled outage.
`daemonServiceNeedsUpgrade()` is a **content** check against the definition on disk, not a
version mirrored into config — the tempting `daemon.installed_version` mirror "is declared,
read and cleared and has never once been WRITTEN", which is precisely how a mirror fails.

## What the collector watches

Collection lives in a separate crate, `fpai-collect`, deliberately not a module inside
`failproofaid`: the daemon crate gates every tool call and must stay small. The collector runs
on its own thread with its own Tokio runtime and every task body is wrapped in `catch_unwind`,
so a bad transform can never become a machine-wide outage.

Thirteen sources across twelve harness keys (`claude` covers both the main and subagent
transcript formats, which share a root). Keys are duplicated in `harness-cli.ts` (grep
`HARNESS_KEYS`) and `main.rs`, with a test that reads the Rust source to prove they agree.

| Engine | Poll | Sources |
|---|---|---|
| `filetail` (append-structured JSONL) | 2s | claude, claude-subagent, codex, copilot, openclaw, pi, factory, antigravity, cursor |
| `sqlitepoll` (sessions in SQLite) | 5s | goose, opencode, devin, hermes (one task per profile DB) |

Two filetail sources are **not** append-only and say nothing about it: factory rewrites its
first line in place, cursor rewrites the whole file per turn. Both need a declared
`RereadPolicy`.

**Cursors** live at `~/.failproofai/cursors/<source>[/<label>]`, keyed on (device, inode) rather
than path so a rotated `current.jsonl` is followed, with the recorded path compared as an
inode-reuse guard. Each source instance gets its **own** directory because the store rewrites
its whole map atomically — two instances sharing one file clobber each other and both re-read
from zero after every restart.

**First-sight window is 7 days** (`main.rs`, grep `file_source_since_days`). A backfill widens
it via the `BACKFILL_SINCE_DAYS` static, and has to: `new_cursor` refuses any file older than
`since_days` outright, so rewinding cursors alone would deliver 7 days no matter what `--since`
asked for, **silently**, and the dashboard would look complete.

**Extra capture paths** (`collector.sources.<harness>.extraPaths`, `label=path`) namespace the
agent id as `<label>-<agentId>`; without a label, two copies of one project derive the same id
from the `cwd` inside the transcript and merge into one agent with interleaved sessions. Three
ways this bites: `harness add-path` reports "configured", **not** "now capturing" — the CLI
cannot detect a path overlapping the harness's own default root, which the daemon owns and
refuses at startup, so verify with `harness list` and the journal, never the exit code. Extras
are read **only when `collector.sessions` is true**, so on a hooks-only machine the config is
written and nothing ever reads it. And `FAILPROOFAI_<HARNESS>_EXTRA_PATHS` **replaces** the
file's list rather than appending — and being an env var it is structurally incapable of
reaching a system-scope unit, so exporting it in a shell configures nothing.

**Collector health** is `~/.failproofai/state/collector-health.json`, rewritten every 30s and
**deleted on clean shutdown** — absence means "no daemon", because a stale file would make a
stopped daemon look like a running one whose sources went quiet. It records three facts a
source cannot fake (root present, last event time, last error) and is deliberately not a health
*check*: no thresholds. (Its module header still names the layout-3 path; the code writes under
`state/`.)

The **collector manager** re-reads `config.json` + `credentials.json` every 5s
(`FAILPROOFAI_COLLECTOR_CONFIG_POLL_MS`, floor 500ms) and cycles the collector whenever the
resolved config changes — which is what makes `--connect`, a stream toggle, a key rotation and
`harness add-path` take effect with no restart and no sudo. An **unreadable** config means
"wait one tick", not "disabled": a file caught mid-save would otherwise tear down a healthy
collector and rebuild it from the same bytes. Two sibling lanes follow the same per-tick
pattern: cloud policy polls `<base>/enforcement/v1/desired-state` every 30s
(`FAILPROOFAI_CLOUD_POLICY_POLL_MS`) so `--connect` needs no root, and the audit lane spawns
`failproofai audit --scheduled` as a **separate** short-lived process — a ~104-second scan on
the worker's single serialized chain would blow the 30s cap and turn into a machine-wide deny.

## The spool, and how a batch actually gets delivered

`~/.failproofai/state/spool/` is the durable hand-off. Batches are
`<prefix>-<tag>-<run>-<seq>.jsonl`, written `.tmp` → fsync → rename, so a reader never sees a
partial file and `.tmp` is invisible to the watcher. Oversized string fields are truncated
**deterministically** — the server dedups on a content hash, which is what makes a re-shipped
backfill event collapse into the row already there instead of duplicating it. Both `spool/` and
`failed/` are classified `undelivered` in `HOME_CLASSES` (`fp-home.ts`), so no reset or
migration ever deletes them. **Three spool directories are watched, not one:** the daemon's
own, the SDK spool `~/.failproofai/custom-agents/events`, and the legacy AgentEye SDK spool
`~/.agenteye/events` (honouring `AGENTEYE_HOME`) — both SDK roots indefinitely, so an
unupgraded SDK is never writing where nothing reads.

Two paths reach the uploader, for different reasons. The **watcher** (inotify/FSEvents) is for
latency — delivered within milliseconds of the rename. The **sweeper** is for the guarantee — a
periodic scan has none of the watcher's failure modes (daemon was down, watch failed to
register, queue overflow, filesystem with no events). Both hand work to one shared `Delivery`
with one semaphore and one in-flight set, or the same batch is POSTed twice.

| Knob | Value | Anchor |
|---|---|---|
| Sweep interval | 60s | `delivery.rs`, grep `SWEEP_INTERVAL` |
| Sweep minimum batch age | 120s | `SWEEP_MIN_AGE` |
| Sweep files per pass | 64 | `SWEEP_MAX_FILES` |
| Concurrent uploads | 8 | `MAX_CONCURRENT_UPLOADS` |
| Upload attempts per batch | 5, exponential from 1s | `uploader.rs`, `DEFAULT_MAX_RETRIES` |
| Max request body | 8 MiB (bigger spool files are split) | `DEFAULT_MAX_UPLOAD_BYTES` |
| `Retry-After` ceiling | 300s | `MAX_RETRY_AFTER` |

`failproofai flush` writes `~/.failproofai/state/flush-request.json` (0600); the manager tick
sets a shared flag and the sweeper makes **one pass with no minimum age and no per-pass cap**.
It re-sends nothing — only what is already spooled and undelivered. Both request files
(`flush-request.json`, `backfill-request.json`) are the hand-off pattern: a file, not IPC, so a
request survives a daemon restart, and the daemon removes it **before** acting so a panic
mid-pass cannot re-trigger it forever. An unparseable request is deleted rather than retried.

`~/.failproofai/state/failed/` is a **retry queue, not a graveyard**. Retry state is encoded in
the filename by rename — `<base>.a<N>[.c<STATUS>].jsonl[.poison]` — deliberately, so the record
cannot desynchronise from the batch it describes. `.a` is the attempt count, `.c` the server's
definitive client status, `.poison` means the parked retry budget (3) is exhausted. Nothing is
ever deleted. The automatic pass runs **hourly**, oldest first, at most 16 files, minimum age 5
minutes, and skips anything poison or carrying a client status — those fail identically until a
human fixes the cause.

### Delivery health

`delivery-health.ts` is a pure **reader** of `failed/` — it never retries, deletes or probes the
network, and reports an unreadable directory as healthy because it runs on the hook path. It
mirrors `ParkedName::parse`, counts 401/403 as `credentialRejected`, and produces the one-line
verdict `deliveryHealthLine()` that **overrides the cheerful "connected" row** in
`config --status`. It stays silent unless a batch was **definitively refused**: batches parked
after exhausting server-error retries carry no client status and get picked up again, so
reporting them would cry wolf over a blip the daemon is already handling.

It exists because of one recorded incident: a key revoked at 13:05:37 and replaced 37 seconds
later was still producing 401s twenty minutes on, with 26 parked batches and a CLI saying
"connected". Everything above that row is read from the credential **file**, which records what
was true at `--connect` time and is never revisited — a revoked key leaves it byte-for-byte
correct while nothing arrives. **Only the delivery-health row describes now.** A growing
rejected count is not evidence of a new failure; refused batches are never retried and never
deleted, so the number only goes up until the cause is fixed.

## Enrollment and re-enrollment

`resolveMachineId()` looks in **two** places before minting: the `[cloud]` credential first
(that is what the server keyed enrolment, deployment and history on), then
`collector.machineId`, then a random UUID. Missing the second split one host into two machines
whenever the first connect was ingest-only.

The ingest probe is an **empty** `POST <base>/v1/events` — proving the endpoint without
creating a spurious event — with `redirect: "manual"`, an explicit 3xx rejection, and a
required numeric `accepted` field in the body. Without those, the dashboard's 307 from
`POST /events` to its login page returned 200, `res.ok` was true, the credential was written,
setup reported success, and every batch afterwards was POSTed into a login form and lost.

Secrets live in `~/.failproofai/credentials.json` at 0600 (`[ingest]`, `[cloud]`, `[org]`);
`config.json` is **world-readable by design** (bare `writeFileSync`, umask → 0664), so never
put a token there. The unit is root-owned 0644 and `systemctl show` prints its environment back
with no privilege at all — which is why the cloud token is in a file the daemon reads rather
than an `Environment=` line. Writers **merge, never replace**: disconnecting policy must not
revoke the ingest key or the dashboard session. `mode: "oss" | "cloud"` is the hard gate, read
by the daemon too.

```bash
failproofai config --disconnect
sudo systemctl restart failproofaid@$USER.service   # see below
failproofai config --connect <new url> --token <new key>
failproofai backfill --since 6m
```

**`--disconnect` does not stop the running daemon from shipping.** The collector resolves its
ingest credential once when it starts and the uploader caches the bearer key at construction.
The manager does cycle the collector on a config *change* within ~5s, which covers a credential
swap; the explicit restart is for certainty on a disconnect. `--connect` reuses the machine id
already on disk, so re-enrolment keeps the machine's identity — pass an explicit
`--machine-id <fresh uuid>` to present as a new machine.

## Gotchas worth carrying

- **`flush` hard-fails on macOS whenever the sudo timestamp has expired**, healthy daemon or
  not: `flush-cli.ts` tests `daemonServiceStatus() !== "running"` with no branch for
  `"unknown"`, and darwin returns `"unknown"` on `!root && !canElevate()`.
  `cloud-enrollment-cli.ts` has that branch; `flush-cli.ts` does not.
- **`flush` and `backfill` disagree about a stopped daemon.** `flush` exits 1 and writes
  nothing; `backfill` exits 0, writes the request, and merely notes nothing moves until the
  daemon starts. A script treating them alike will misread one.
- **An ingest credential alone collects nothing.** `is_enabled()` needs a key AND at least one
  stream, and `sessions` defaults to false at the library layer because transcripts carry
  prompts and file contents. `--connect` flips that on unless `--no-transcripts` is passed.
- **A comma in `collector.environment` makes the daemon refuse to start collection at all** —
  the ingest endpoint splits on commas and would silently drop every event from the machine.
- Telemetry's only off-switch is `telemetry.enabled` in `config.json`;
  `FAILPROOFAI_TELEMETRY_DISABLED` cannot reach a system-scope unit. Re-read every tick, never
  memoised, and a tick that sees it off clears the buffered ring as well.
- `~/.failproofai/run/` is deliberately **not** under `state/`: a Unix socket path must fit in
  `sockaddr_un.sun_path` (~108 bytes) and that ceiling has been hit twice in development.
- `failproofai uninstall` clears `daemon.configured` **first and unconditionally**, so a partial
  uninstall can never leave the machine denying every tool call.
