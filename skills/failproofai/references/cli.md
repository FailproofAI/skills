# The `failproofai` command surface

Every subcommand, flag, environment variable and on-disk path of the **local** binary — the
npm package `failproofai` (Node >= 20.9) that installs hooks, runs the daemon, and enforces
on one machine. Nothing on this page is a cloud command.

**Three binaries carry this product's name. Keep them apart.** `failproofai` is local
enforcement and is what this file documents. `fp` (dist `fp-cloud-cli`, installed with `uv
tool install fp-cloud-cli` — `fp_cli` is the module, never the distribution) is the cloud
control plane: sessions, policies, fleet, guardrails. It is a **separate package with a
separate command surface**, documented in `references/cloud.md`. `agenteye` is the legacy
cloud CLI — still installable, still works, but it has no `policies`, `fleet`, `guardrails`
or `usage`. Resolve the cloud one before writing a command and prefer `fp`:

```bash
command -v fp agenteye
```

The blur that costs time is environment: **the prefix follows the binary.** `FAILPROOFAI_*`
below is read by the local CLI and daemon and by nothing in the cloud; `FP_*` is read only
by `fp`; `AGENTEYE_HOME` is a path this codebase reads and not a cloud setting at all. The
single genuine overlap is `FAILPROOFAI_HOME`, which both honour — see *Environment
variables*.

Anchors are greppable names inside the `failproofai` package. `bin/failproofai.mjs` is the
whole CLI entrypoint — one 1,900-line file with hand-rolled parsers, no framework, and **no
type checking at all** (it is `.mjs`, outside the tsconfig include; grep
`cli_configure_invoked` for the in-source admission that a telemetry field has been `null`
for releases because of it).

## What runs before your command

Nothing about this order is obvious and three steps can hijack the command you typed.

| Step | Anchor | What it does |
|---|---|---|
| 1. Alias rewrite | grep `args[0] === "p"` | `p`/`policy`/`pack`→`policies`, `configure`/`setup`→`config`. `pack list` splits by argument into `policies` or `policies show`; `pack build`→`publish`. **`args[0]` only** — `failproofai policies p` does not alias |
| 2. `--hook` fast path | grep `const hookIdx` | Exits before `runCli()` entirely. Own exit-code contract |
| 3. `--help` / `--version` guard | grep `const SUBCOMMANDS` | Fires only when `args[0]` is NOT in `SUBCOMMANDS`, and rejects any leftover token |
| 4. Layout gate | grep `checkLayoutForCli` | A stale home is **reset** (files deleted); a newer home is fatal, exit 1 |
| 5. Install report | grep `maybeReportInstall` | Writes `state/last-version` |
| 6. First-run wizard | grep `shouldOfferFirstRun` | On an unconfigured TTY machine, runs setup **before** your command |
| 7. Subcommand dispatch | `if (args[0] === "flush")` … | In file order: flush, backfill, harness, migrate, update, uninstall, publish, `policies add\|remove\|show`, the `policies` listing, audit, config |
| 8. Unknown flag / subcommand | grep `unknownSubcommand` | Levenshtein nearest match over `SUBCOMMANDS` |
| 9. Bare dashboard | grep `launch("start")` | Parks the process |

`SUBCOMMANDS` is exactly eleven entries: `policies audit config uninstall backfill flush
harness publish update migrate help`. `policy` and `pack` are **not** among them and do not
need to be — step 1 rewrites both to `policies` before this guard ever reads `args[0]`.

`update` and `migrate` are now in the set, so `failproofai update --help` and `failproofai
migrate --help` reach their own help screens instead of erroring on the leftover positional.
So does `failproofai help update`. Quote them freely.

A typo still lands on step 8: `failproofai updat` → nearest match over `SUBCOMMANDS`, exit 1.

**First-run exemptions** (grep `FIRST_RUN_EXEMPT_SUBCOMMANDS`) are `config`, `policies`,
`policy`, `uninstall`, `backfill`, plus `--help`/`-h`/`--version`/`-v`/`--hook`. The gate runs
at step 6, *after* the step-1 rewrite, so `pack` and `p` are exempt too — they are already
spelled `policies` by the time it looks. Not exempt: `flush`, `harness`, `audit`, `publish`,
`migrate`, `update` — so on an unconfigured TTY machine the wizard opens in front of `update`,
which is the command you reach for when the install is already broken.

## Where the shipped help text is wrong

Do not copy these lines into anything. Each is contradicted by the code beside it.

| The help says | Reality | Anchor |
|---|---|---|
| `config --help`: "the machine id defaults to this host's name" | It never touches the hostname. Explicit `--machine-id` → the id already on disk → `randomUUID()`. Hostname is only the mutable **label** | `cloud-enrollment.ts`, grep `resolveMachineId`, `resolveMachineLabel` |
| `backfill --help`: "follows [collector] in `~/.failproofai/config.toml`" | `config.toml` is the layout-2 name. The live file is `config.json`, and the layout gate **deletes** any `config.toml` it finds | `fp-home.ts`, grep `configFile`, then `legacy` → `configToml` |
| `config --help`: "Walks you through 4 quick steps" | Six. Step 0 is the daemon (sudo, before any TUI frame) and step 4 is cloud enrolment — the two that decide whether the machine does anything | `configure-wizard.ts`, grep `step` markers |
| Doc comment: "`config --status --verbose` prints the full id" | No `--verbose` exists. Nothing parses it, and the `config` branch validates no flags at all — it is **silently swallowed** | `cloud-enrollment-cli.ts`, grep `verbose` |
| `audit --help`: "only a scheduled digest ever leaves it" | True of a bare audit. `--schedule` signs you in and each report sends counts, redacted example commands, machine id, hostname, platform | `audit/schedule-cli.ts`, grep `reportsConsentedAt` |
| CLI error hints: `https://be.failproof.ai` | Stale host. Current docs and `DEFAULT_INGEST_URL` both say `https://app.befailproof.ai` | `collector-config.ts`, grep `DEFAULT_INGEST_URL` |

Also dead: `connectionStatusLines()` is exported and referenced only by its own test.
`config --status` renders through `connectionStatusReport()` + `versionStatusLines()`.

## Parser rules that hold everywhere

Everywhere in `failproofai`, that is. None of this transfers to `fp`, which is a
conventional option parser and takes `--timeout=5` and the like without complaint.

- **No `--flag=value`, with a short list of exceptions.** Every guard in `bin/failproofai.mjs`
  compares whole tokens against a `Set`, so `--since=6m`, `--timeout=30` and `--scope=user`
  all trip "Unexpected argument". The exceptions all live in the pack/publish lane or in
  `--cli`, and are these:

  | Flag | Where | Anchor |
  |---|---|---|
  | `--cli=` | everywhere `--cli` is accepted | grep `parseCliList`, `startsWith("--cli=")` |
  | `--out=` | `publish` | grep `outFlagFrom` |
  | `--effect=` | `publish` | grep `effectFlagFrom` |
  | `--email=` | `audit --schedule` | grep `--email=` in `audit/cli.ts` |
  | `--policy=` / `--only=` / `--category=` | the pack lane of `policies add` | grep `parseList` in `pack-cli.ts` |

  `--scope` is **not** among them, despite sitting beside `--cli` in the same `policies add`
  invocation and reading like a set with it. Write it as two tokens.
- **Unknown-flag validation is per-branch, and `config` has none.** `failproofai config
  --statuss` does not error — it falls through every check and **launches the interactive
  wizard**. Same for a mistyped `--no-transcript`, `--disconect`, or any typo at all.
- **`--cli` is greedy and stops at the first token that is not a known CLI name.** So `--cli
  bogus` reports "Missing value(s) for --cli", never "unknown CLI", and `--cli claude
  block-sudo` correctly reads `block-sudo` as a policy — which means a typo'd CLI name is
  silently reinterpreted as a policy name.
- **Non-zero means everything goes to stderr.** Every `{lines, exitCode}` subcommand does
  `exitCode === 0 ? console.log : console.error` per line (flush, backfill, harness, publish,
  uninstall). The bare `policies` listing is **not** one of them: a pack that will not load is
  a warning row (`pack <id> will not load: <reason>`), not a non-zero exit.
- **Twelve CLI names, everywhere the same set**: `claude codex copilot cursor opencode pi
  hermes openclaw factory devin antigravity goose` (grep `VALID_CLIS`, `HARNESS_KEYS`).

## `--hook <event> [--cli <name>]`

The internal fast path. This is what an installed hook entry actually invokes, and it never
reaches `runCli()` — no layout gate, no first-run wizard, no telemetry import on the hot
path.

- Missing event after `--hook` → usage on stderr, **exit 1**.
- An unrecognised `--cli` value is **silently defaulted to `claude`** (grep the `cliArg &&`
  chain) for back-compat with hooks installed before multi-CLI support.
- On a daemon-configured machine (grep `isDaemonConfigured`) the daemon is the only
  evaluator and there is deliberately **no in-process fallback**: `protocol-mismatch` and
  `unreachable` both force a deny, differing only in message text.
- Exit codes are shaped per CLI by the real evaluator (grep `exitCode: 2` in
  `policy-evaluator.ts`): **0** = allow, or a deny carried in stdout JSON for the eight CLIs
  that read their verdict from stdout; **2** = deny by exit code plus stderr (Claude, and
  Factory's non-`Stop` events).
- The outer catch is the fail-closed boundary (grep `failing closed`). It writes the union
  of every CLI's deny shape when the handler module itself will not load — because the
  earlier version wrote zero bytes and exited 2, which is a **silent allow** on those eight
  CLIs.

## `config` (aliases `configure`, `setup`)

Bare `failproofai config` is one linear wizard — daemon, connect, review — and it asks about
**neither policies nor harnesses**: hooks go into all twelve agent CLIs at global scope and
nothing is enabled on your behalf (`references/setup.md`). It needs a TTY, refuses on any non-Linux/
macOS platform (grep `unsupported_platform`), and is the **only** thing that installs the
daemon — `update` refreshes an existing service and returns early otherwise (grep
`refreshDaemonToCliVersion`). Exit 1 when not applied and the abort is anything other than
`cancelled`.

| Flag | Notes |
|---|---|
| `--connect <url> --token <key>` | Verifies `policies:pull` and `events:add` separately, writes only what verified. **Exit code tracks the policy half only** |
| `--machine-id <id>` | The stable identity. Absent → the id on disk → random UUID |
| `--machine-label <name>` | The dashboard name. **Used alone it is a rename**, a different code path (grep `wantsRename` → `runRenameCommand`) |
| `--no-transcripts` | Matched by exact string. Transcripts default **on** (grep `sessions: !args.includes`) |
| `--disconnect` | Clears both credentials, `mode: "oss"`. Cannot combine with `--connect`. **Does not stop a running daemon** — the uploader cached its key at construction |
| `--status` | Pause block + connection rows + version triad, one shared column |
| `--pause [<dur>] [--session <id>]` | Bare number = **minutes**. Default 30m, ceiling 8h from `firstPausedAt` of an unbroken run. Regex is `/^(\d+)\s*(s\|m\|h)?$/i`, so `30 m` parses |
| `--resume [--all] [--session <id>]` | Always exits 0, even with nothing paused |

`--pause` / `--resume` / `--status` are mutually exclusive, as are `--connect` /
`--disconnect`. `--pause` with no recent agent session for the cwd is an **error, not a
guess** (grep "Deliberately an error").

URL rules (grep `validateCloudUrl`): plain `http` is refused for anything but
localhost/127.0.0.1/::1; a trailing `/v1/events` or `/events` is stripped, so pasting the
ingest endpoint instead of the base works.

## `policies` (alias `p`) and `policy`

`failproofai policies` lists; `--list` is accepted as a no-op alias. Unknown flags *and*
positionals are rejected on the list path.

| | `policies --install` / `-i` | `policies --uninstall` / `-u` | `policy add` | `policy remove` |
|---|---|---|---|---|
| Names | many, or `all` alone | many, or none = remove hooks | exactly one | exactly one |
| `--scope` | user\|project\|local | + `all` | user\|project\|local | + `all` |
| `--cli` | yes | yes | yes | yes |
| `--beta` | includes beta | removes only beta | yes | parsed, **ignored** |
| `--custom` / `-c` | **takes a path**, repeatable | **takes no path** — clears every explicit custom path | rejected | rejected |

`policy add|remove` accepts only `--scope`, `--cli`, `--beta` (grep `const knownFlags` in
the policy branch); `--custom` there is a hard error even though the docs' flag table sits
under the same heading. `policies --install all block-sudo` is refused — `all` must be the
sole name.

Two silent-blast-radius traps: `policies --uninstall --scope all` has **no confirmation
prompt at all** (unlike top-level `uninstall`), and with `--cli` omitted off a TTY,
install/uninstall target **every detected agent CLI** with no prompt — grep `all_detected`
in `install-prompt.ts`; with none detected it defaults to `claude` with a warning that names
only 6 of the 12 harnesses.

## Packs — `policies add|remove|show`, and `publish`

Packs have no command of their own. A **slash** routes them: a policy name matches
`/^[A-Za-z0-9._-]+$/`, so `policies add block-sudo` turns one policy on and `policies add
acme/deploy-guard` installs a pack.

`policies` (bare) lists what is installed. `policies add <source> [--policy a,b] [--category
x,y] [--all]`, `policies remove <publisher/name>`, `policies show <source> [--releases]` for a
remote preview that reads the manifest only. Sources: `owner/repo`, `owner/repo@tag`,
`owner/repo@<commit-sha>`, `github:owner/repo@tag`, or a full releases/tag URL. No tag installs
the newest release **and pins it**. Default selection is the pack's own defaults, not
everything. Artifacts are verified against the release `SHA256SUMS` at install and re-verified
before every import. `FAILPROOFAI_NO_DOWNLOAD=1` refuses to fetch while installed packs keep
enforcing — there is no offline install of anything, ours included.

`failproofai publish` is the other half: build the three assets, cut the release, upload them.

`pack`, `policy` and `p` are rewritten to `policies` above every dispatch, so older spellings
still work — `pack list` becomes `policies` bare or `policies show <source>` with an argument,
and `pack build` becomes `publish`. Write the new spelling.

Full publishing detail lives in `failproofai-policy-publish/references/publishing.md`.

## `harness`

`harness list [<h>]`, `harness add-path <h> [<label>=]<path>`, `harness remove-path <h>
<path|label>`. No flags on any subcommand; bare `harness` prints help. Writes **only**
`~/.failproofai/config.json` — no sudo, no daemon call, picked up within seconds.

- `add-path` **joins every trailing token with a single space** — grep `addPath(rest[0]` in
  `harness-cli.ts` — so `add-path claude a=/x b=/y` writes one entry literally
  `"a=/x b=/y"` and reports success.
- Duplicate detection normalises labels (lowercase, non-alphanumeric runs → `-`, trimmed),
  so `Team Share` and `team-share` collide, and two unlabelled paths ending in the same
  folder name collide too — the second is refused.
- It reports "configured", never "capturing". A path overlapping a harness's own default
  root is refused by the **daemon at startup** and reported only in the journal.
  `harness list` is where reality shows up, and it surfaces a hand-edited typo too — as does the daemon at startup (grep `unknown_sources` in `main.rs`), but only in the journal — and it is the cheapest place to find one, for a
  hand-edited `collector.sources.claud` typo.

## `audit`

Takes **no arguments** except the four flags below; anything else, including `--sched`, is
rejected rather than quietly running a scan. The flags are not composable — each rejects
every other argument.

| Form | Behaviour |
|---|---|
| `audit` | Scans, writes the cache, opens `localhost:8020/audit`, **parks forever** |
| `audit --schedule [days] [--email <a>]` | Days 1..90, default 7. Always signs you in (grep `ensureSignedIn`); `--email` only supplies the address so it is not prompted for, and is REFUSED if the machine is already signed in as someone else. Turns on outbound reporting |
| `audit --no-schedule` | Stops the timer; stays signed in, history kept |
| `audit --status` | Scheduling, report address, daemon state, last result, next due |
| `audit --scheduled` | **Undocumented**, daemon-spawned, headless. One letter from `--schedule` |

Exit **75** (`EX_TEMPFAIL`, grep `EXIT_AUDIT_ALREADY_RUNNING`) means another audit holds the
lock — come back later, not a failure. Four writers contend for it. The cache is written
before the server starts, so `timeout 180 failproofai audit` (exit 124) still leaves you
`~/.failproofai/audit/dashboard.json`.

## `backfill` and `flush`

Both write a request file for the daemon and both **fail loudly (exit 1) on an unconnected
machine** rather than no-op'ing — every precondition is checked synchronously in the CLI so
success is never reported while the real failure sits in the journal.

| Command | Flags | Notes |
|---|---|---|
| `backfill` | `--since <30d\|6m\|YYYY-MM-DD>`, `--dry-run` | `6m` = 180 days, not six months. `Ny` = N×365 works and is undocumented. Unparseable is rejected, never defaulted. Writes `state/backfill-request.json` |
| `flush` | `--wait`, `--timeout <secs>` | Default timeout 60s. Writes `state/flush-request.json`. Bypasses the daemon's 2-min age / 64-per-pass / 60s cadence. Re-sends nothing |

`flush --wait` **exits 1 on timeout** ("Still N batches spooled after Ns"), which is not a
real failure but will kill a `set -e` script. `flush` also refuses outright on Windows.

## `update`, `migrate`, `uninstall`

`update [--no-daemon]` runs pending migrations itself, installs the matching daemon binary
and restarts the service. It refuses a **newer** home (exit 1, "This CLI is the stale
half"). It refreshes the daemon **even when a migration step failed** — deliberately; the
exit code still reports the failure.

`migrate [--dry-run]` runs layout migrations alone, keyed on `~/.failproofai/VERSION`, not
the npm version — skipping thirty releases with no layout change runs nothing. Irreplaceable
files are copied to `migrations/backup-layout<n>/` first and every step lands in
`migrations/applied.json`.

`uninstall [--purge] [--dry-run] [--yes|-y]` rejects any unknown token **including
positionals**. It clears the "require the daemon" flag **first**, and a failure there is
uniquely fatal (exit 2, stops before touching the service) — removing the service while that
flag is set is the every-tool-call-denied lockout. Never hand-roll this by deleting the
unit.

- `--yes` does more than skip a prompt: it **also removes the systemd service**,
  unconditionally (grep `opts.purge || opts.yes`). A plain interactive run asks separately
  and defaults to keep.
- No TTY and no `--yes` is a **refusal**, exit 1 — never an assumed yes.
- After `--purge` no telemetry fires at all, because `getInstanceId()` lazily writes
  `state/telemetry-id` and would recreate the directory the purge just deleted.

## Bare `failproofai` — the dashboard

Launches the bundled Next.js standalone on `127.0.0.1:8020` and **parks**. The port is
effectively hardcoded: `launch.ts` parses `--port`, but the top-level unknown-flag guard
(`knownFlags = ["--version","-v","--help","-h","--hook"]`) rejects it first, and `launch()`
then unconditionally overwrites `process.env.PORT`, so exporting `PORT` does nothing either.
Same for `--host`, `--logging`, `--allowed-origins`.

The bind host **is** changeable, through the undocumented `FAILPROOFAI_DASHBOARD_HOST` — and
should almost never be. The dashboard has no authentication and is a write surface: it can
toggle policies and uninstall failproofai's hooks from every agent CLI. A non-loopback bind
prints a loud warning (grep `resolveDashboardHost`).

## Environment variables

Confirmed read sites only, and **all of them are `FAILPROOFAI_*` except one**.
`FAILPROOFAI_KEY` is **not** among them — it appears in docs as a shell placeholder for the
pasted token and nothing in the product reads it.

| Variable | Effect | Anchor |
|---|---|---|
| `FAILPROOFAI_HOME` | Relocates the entire layout. **Used verbatim** — `.failproofai` is NOT appended (unlike the `home` function argument). The **only** variable the cloud binary `fp` also reads | `fp-home.ts`, grep `failproofaiHome` |
| `FAILPROOFAI_NO_FIRST_RUN` | Suppresses the first-run wizard. Must be exactly `"1"` | `configure-wizard.ts`, grep `NO_FIRST_RUN` |
| `FAILPROOFAI_DAEMON_BINARY` | Names the daemon binary explicitly; also **disables version-skew warnings entirely** | `daemon-service.ts`, grep `resolveFailproofaidBinaryPath`, `daemonVersionSkew` |
| `FAILPROOFAI_CLOUD_URL` | Overrides `credentials.json` outright; `--status` says "configured by environment". **Requires `FAILPROOFAI_CLOUD_TOKEN` and `FAILPROOFAI_MACHINE_ID` or the daemon errors** | `crates/failproofaid/src/cloud_client.rs`, grep `from_env` |
| `FAILPROOFAI_CLOUD_CREDENTIALS` | Points the cloud credential at a standalone JSON file | `cloud-enrollment.ts`, grep `cloudCredentialPath` |
| `FAILPROOFAI_INGEST_URL` / `_KEY` | Collector delivery target and bearer | `crates/fpai-collect/src/config.rs` |
| `FAILPROOFAI_<SOURCE>_EXTRA_PATHS` | Comma-separated capture roots. **REPLACES** the file's list, never appends. Name derives from the collector source (upper, `-`→`_`), and there are 13 sources vs 12 harness keys, but the extra source buys nothing: `main.rs` resolves extras per HARNESS KEY and hands `claude`'s list to the `claude-subagent` source as well, so `FAILPROOFAI_CLAUDE_SUBAGENT_EXTRA_PATHS` is never read — set `FAILPROOFAI_CLAUDE_EXTRA_PATHS` and subagent transcripts under that root are captured too | `config.rs`, grep `extra_paths_for` |
| `FAILPROOFAI_NO_DOWNLOAD` | Refuses network fetches (daemon binary, packs) | grep `NO_DOWNLOAD` |
| `FAILPROOFAI_TELEMETRY_DISABLED` | Exactly `"1"`. The **weaker** switch — it cannot reach the system-scope daemon. The machine-wide one is `telemetry.enabled = false` in `config.json` | `lib/telemetry-enabled.ts` |
| `FAILPROOFAI_NO_AUTO_AUDIT` | Exactly `"1"`. Suppresses the post-setup audit | `audit/cli.ts` |
| `FAILPROOFAI_DASHBOARD_HOST` | Dashboard bind address. See the warning above | `scripts/launch.ts` |
| `FAILPROOFAI_LOG_LEVEL` | `info`\|`warn`\|`error`, default `warn` | `hook-logger.ts`, `lib/logger.ts` |
| `FAILPROOFAI_HOOK_LOG_FILE` | **Names a DIRECTORY, not a file.** `"1"`/`"true"` = default `logs/`; anything else is used as a directory and `hooks.log` is created inside it | `hook-logger.ts`, grep `rawFile !== "1"` |
| `FAILPROOFAI_API_URL` | Auth/report base. Note `FAILPROOF_API_URL` (no `AI`) is checked **first** in the audit login path | `audit/cli-login.ts` |
| `FAILPROOFAI_DAEMON_SOCKET`, `_STATE_DIR`, `_AUTH_DIR`, `_PACK_DIR`, `_PACK_BASE_URL`, `_CLOUD_POLICY_DIR`, `_POLICY_LOAD_TIMEOUT_MS`, `_PACKAGE_ROOT`, `_DIST_PATH` | Path/timeout overrides, mostly for tests and containers | grep each name |
| `AGENTEYE_HOME` | The only `AGENTEYE_*` variable this codebase reads. It is a **path, not a credential**: it locates the local daemon's legacy SDK spool, default `~/.agenteye/events`, and the daemon still watches that path. Nothing cloud-facing reads it | `config.rs` |

### `FP_*` is the cloud binary and is not read here

Not one `FP_*` name reaches this codebase. `FP_HOME`, `FP_JSON`, `FP_TOKEN`, `FP_API_KEY`,
`FP_ORG`, `FP_DASHBOARD_URL`, `FP_INSECURE`, `FP_ANALYTICS_DISABLED` and `FP_CLI_DEV`
configure `fp` and only `fp` — the prefix follows the binary. Two things routinely go wrong
when someone crosses the streams:

- **The infix drops.** It is `FP_TOKEN` and `FP_JSON`, never `FP_CLI_TOKEN` /
  `FP_CLI_JSON`. A mechanical `AGENTEYE_` → `FP_` rewrite of the legacy names produces
  variables nothing reads, and they fail silently as an unauthenticated call.
- **The homes now nest.** `fp` keeps its session at `~/.failproofai/fpcli/cli-auth.json`
  (mode `0600`) — a subdirectory of the local home, not a second tree beside it. Its
  precedence is `FP_HOME` (its own variable, used **as-is**: it names the CLI's directory,
  not the home root) → `FAILPROOFAI_HOME` (the home **root**, with `fpcli` appended) →
  `~/.failproofai/fpcli`. So exporting `FAILPROOFAI_HOME` to relocate the local layout
  relocates the cloud session with it, and a stale export is enough to make `fp whoami`
  report logged out on a machine that is signed in. Note the two variables disagree about
  what they name: the local CLI uses `FAILPROOFAI_HOME` verbatim as the layout root (see
  the table), `FP_HOME` is one level deeper.

Going the other way is worse, because these names are **live literals owned by other
components** and renaming one breaks a running system: `AGENTEYE_KEY` is the collector's
ingest bearer, `AGENTEYE_API_KEY` is dashboard admin, and `FP_API_KEY` was named
deliberately so it would *not* collide with either. Never substitute one for another.
`AGENTEYE_SPOOL_TO_FAILPROOFAI`, `AGENTEYE_ENVIRONMENT` and `AGENTEYE_ORG` appear in
FailproofAI's docs but exist **nowhere in this codebase** — they belong to the Python SDK.

## `~/.failproofai/` — layout 4

`LAYOUT_VERSION = 4` in `fp-home.ts`, which is the single authority; nothing outside that
file may join a path onto the home. The Rust side mirrors it in
`crates/failproofaid/src/paths.rs`.

| Path | Holds |
|---|---|
| `VERSION` | Layout / CLI / daemon versions. The layout marker |
| `config.json` | `0644`, non-secret: mode, daemon, collector prefs, `telemetry`, `audit`. **Never a token** |
| `credentials.json` | `0600`, every token |
| `policies-config.json` | Builtin enable/disable set and per-policy params, global scope |
| `bin/failproofaid-<version>` | Downloaded daemon binaries, one per version, never overwritten in place |
| `policies/*.mjs` | The user's convention policies, directly in the directory |
| `policies/cloud-policies/` | `active.json`, `desired-state.json`, `artifacts/` |
| `policies/packs/` | `installed.json`, `artifacts/` |
| `cursors/<source>/` | Per-source collector watermarks. Never shared between sources |
| `audit/` | `dashboard.json` (**the cache** — layout 4 path), `cache/`, `schedule.json`, `session.json` `0600`, `machine.json` |
| `hook-activity/` | The decision log the dashboard's Activity tab reads |
| `custom-agents/` | SDK spool: `events/`, `failed/` |
| `run/` | `failproofaid.sock`, `worker.sock`, `failproofaid.lock`, `audit.lock`. **Deliberately not under `state/`** — `sun_path` is ~108 bytes |
| `state/` | `spool/`, `failed/`, `shims/`, `sessions/`, `collector-health.json`, `telemetry-id`, `launcher-configured`, `last-version`, `onboarding.lock`, `onboarding-attempt.json`, `codex-session-paths.json`, `backfill-request.json`, `flush-request.json` |
| `logs/` | `hooks.log` when file logging is on |
| `migrations/` | `applied.json`, `backup-layout<n>/` |

Retired paths that current builds never write — they exist only so `detectLayout()`
recognises an old home and a reset can prune it (grep `export const legacy`): `config.toml`,
`credentials.toml`, `cloud.json`, `ingest.json`, `auth.json`, `next-audit.json`,
**`audit-dashboard.json`** (the layout-3 audit cache), `cache/`, `spool/` at the root,
`policies/local-policies/`, `policies/custom-policies/`, `policies/cloud-managed/`.

Project scope is **not** under the home and keeps its old shape: `<project>/.failproofai/`
holds `policies-config.json` and `policies/*.mjs` at the top, owned by `hooks-config.ts`,
because those files are committed to users' repos.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success — including `flush` on an empty spool, `config --resume` with nothing paused, and `config --connect` when `policies:pull` verified but `events:add` did not |
| 1 | `CliError`: parse error, unmet precondition, refused platform, newer layout, `--connect` without `policies:pull`, `flush --wait` timeout, missing `--hook` event |
| 2 | Unexpected internal error; also the `--hook` deny code for Claude and Factory's non-`Stop` events; also `uninstall` failing to clear the daemon-required flag |
| 75 | `audit`: another audit holds the lock. **Not a failure** |
| 124 | Only from your own `timeout` around the two commands that never exit |
