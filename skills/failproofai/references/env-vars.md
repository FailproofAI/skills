# Environment variables and configuration locations

**The rule is one line: the prefix follows the binary.**

`FP_*` is read by the cloud CLI `fp` and by nothing else. `FAILPROOFAI_*` is read by the local
CLI and daemon and by nothing in the cloud. The surviving `AGENTEYE_*` names are a *path* and
two *ingest credentials* owned by other components — none of them configure either CLI.

Exporting the wrong family is **silent**. Nothing warns; the binary simply behaves as if
nothing were set, which surfaces as an unauthenticated call, a logged-out `whoami` on a
machine that is signed in, or a relocated home nobody relocated.

## The two mistakes that cost the most

**The infix drops.** It is `FP_TOKEN` and `FP_JSON` — never `FP_CLI_TOKEN` or `FP_CLI_JSON`. A
mechanical `AGENTEYE_` → `FP_` rewrite of the legacy names invents variables nothing reads.
`FP_CLI_DEV` is the sole survivor of the `CLI` infix and is a test switch, not an auth or
output selector; do not generalise from it.

```
AGENTEYE_CLI_TOKEN  ->  FP_TOKEN     (not FP_CLI_TOKEN)
AGENTEYE_CLI_JSON   ->  FP_JSON      (not FP_CLI_JSON)
```

**Going the other way is worse**, because the `AGENTEYE_*` names that survive are live
literals owned by other components. Renaming one breaks a running system rather than a
document. Never substitute one for another — `references/literals.md` is the register.

---

## Where config lives

`fp` and `failproofai` no longer keep two separate config trees. **The cloud CLI's session
file moved *inside* the local home.**

| What | Path | Notes |
|---|---|---|
| Local layout root | `~/.failproofai/` | Layout 4. Nothing outside the CLI's own `fp-home.ts` may join a path onto it |
| Cloud CLI session | `~/.failproofai/fpcli/cli-auth.json` | Mode `0600`. Token, email, user id, active org, `base_url`, `--insecure` preference |
| Local daemon SDK spool | `~/.agenteye/events` | Honours `AGENTEYE_HOME`. Still watched — see below |

Consequences to state before diagnosing anything:

- **`~/.failproofai/` existing tells you nothing about cloud sign-in**, and being signed in
  tells you nothing about the local half. Probe each with its own command:
  `fp --json whoami` and `failproofai config --status`.
- **Relocating one relocates the other.** Exporting `FAILPROOFAI_HOME` to move the local
  layout moves the cloud session with it, and a stale export is enough to make `fp whoami`
  report logged out on a machine that is signed in.

`fp` resolves its config directory in this order:

1. `$FP_HOME` — its own variable, used **as-is**. It names the CLI's directory, not the home
   root.
2. `$FAILPROOFAI_HOME` — the home **root**, with `fpcli/` appended.
3. `~/.failproofai/fpcli`.

**The two variables disagree about what they name**, and that is not a bug to work around: the
local CLI uses `FAILPROOFAI_HOME` verbatim as the layout root, `FP_HOME` is one level deeper.

### Read-once adoption paths

`~/.fp/cli.json` and `$FP_HOME/cli.json` are checked for an older session and **never
written**. A session found there is copied to the new location on the next command and the
original is left alone — copying rather than moving keeps a downgrade working. `~/.fp` is only
a candidate when `FP_HOME` is *not* set: somebody who exported `FP_HOME` said where their
config lives, and reaching past it into the home directory would adopt a session from a
different tenant or another user's leftovers on a shared box.

---

## Group 1 — `FP_*`, owned by the cloud CLI `fp`

Everything `fp` reads, in full. Confirmed against `fp_cli/app.py`, `config.py` and
`analytics_config.py` in 0.0.1b1. **`fp` reads zero `AGENTEYE_*` variables.**

| Variable | Equivalent flag | Effect |
|---|---|---|
| `FP_TOKEN` | `--token` | Session token override, for CI and agents |
| `FP_API_KEY` | `--api-key` | Authenticate as an API key against `/v1`. Never written to disk |
| `FP_JSON` | `--json` | Truthy values: `1`, `true`, `yes`, `on` |
| `FP_ORG` | `--org` | Active tenant slug |
| `FP_DASHBOARD_URL` | `--base-url` | Default `https://app.befailproof.ai` |
| `FP_INSECURE` | `--insecure` | Skip TLS verification. Honoured only for the base URL it was saved for |
| `FP_HOME` | — | The CLI's config **directory**, used as-is |
| `FAILPROOFAI_HOME` | — | The failproofai home **root**; `fpcli/` is appended. The only variable both binaries read |
| `FP_ANALYTICS_DISABLED` | — | Opt out of telemetry. `DO_NOT_TRACK` works too |
| `FP_CLI_DEV` | — | Internal dev/test switch. Keeps source checkouts out of the shared telemetry project |

### Credential precedence

A flag always beats an env var, and a key env var beats a token env var — Click's parameter
source is the only thing that can tell the two apart, which is why the ordering below is not
simply "later wins":

```
--api-key AND --token on the CLI  ->  usage error, exit 2 (never guess)
--api-key                         ->  key mode
--token                           ->  session mode
FP_API_KEY                        ->  key mode
FP_TOKEN                          ->  session mode
the saved cli-auth.json session   ->  session mode
nothing                           ->  exit 4 on the first command that needs auth
```

**`--api-key ""` — an unset CI variable spelled out — keeps key mode with an empty
credential** and fails, rather than quietly acting as whichever human is logged in on that
machine. `--token ""` behaves the same. Click treats an *empty env var* as unset, so
`FP_API_KEY=""` falls through to the next rung instead.

### `FP_API_KEY` was named to avoid a collision

Deliberately **not** `AGENTEYE_KEY` and **not** `AGENTEYE_API_KEY`, both of which are typically
already set on a dashboard host:

- `AGENTEYE_KEY` is the collector's **ingest** key, normally `events:add` only. Picking it up
  here would make every read command 403 for no visible reason.
- `AGENTEYE_API_KEY` is the dashboard service's own **admin-grade** key. Silently promoting an
  operator credential to "the CLI's identity" is a privilege surprise.

Never tell anyone to reuse either one for `fp`.

### The legacy binary's own family

`agenteye` 0.1.13 reads eight variables and **no `FP_*` at all**, confirmed by reading the
installed `agenteye_cli/`:

| Legacy | The `fp` equivalent |
|---|---|
| `AGENTEYE_CLI_TOKEN` | `FP_TOKEN` |
| `AGENTEYE_CLI_JSON` | `FP_JSON` |
| `AGENTEYE_ORG` | `FP_ORG` |
| `AGENTEYE_DASHBOARD_URL` | `FP_DASHBOARD_URL` |
| `AGENTEYE_INSECURE` | `FP_INSECURE` |
| `AGENTEYE_HOME` | `FP_HOME` — but see the warning below |
| `AGENTEYE_ANALYTICS_DISABLED` | `FP_ANALYTICS_DISABLED` |
| `AGENTEYE_CLI_DEV` | `FP_CLI_DEV` |

There is **no key-mode variable** for the legacy binary, because it has no `--api-key` flag at
all. If someone's exports are the `AGENTEYE_CLI_*` family they are configuring the legacy
binary — a valid thing to be doing, not a mistake to correct — but `fp` ignores every one of
them, silently.

**`AGENTEYE_HOME` is the one name that is not merely a legacy synonym.** It is the
`~/.agenteye` **root**, and two live things sit under it: legacy `agenteye` keeps its session
at `$AGENTEYE_HOME/cli.json` (mode `0600`, default `~/.agenteye/cli.json`), and the local
daemon watches the SDK spool at `$AGENTEYE_HOME/events`. Setting it moves both. That is why it
survives — see *Group 3*.

Note where that leaves the two cloud sessions: `agenteye`'s lives at `~/.agenteye/cli.json`,
`fp`'s at `~/.failproofai/fpcli/cli-auth.json`. **They are separate files and separate
logins.** Being signed in to one says nothing about the other.

---

## Group 2 — `FAILPROOFAI_*`, owned by the local CLI and daemon

Confirmed read sites only. **`FAILPROOFAI_KEY` is not among them** — it appears in docs as a
shell placeholder for a pasted token and nothing in the product reads it.

| Variable | Effect |
|---|---|
| `FAILPROOFAI_HOME` | Relocates the entire layout. **Used verbatim** — `.failproofai` is NOT appended. The only variable `fp` also reads |
| `FAILPROOFAI_NO_FIRST_RUN` | Suppresses the first-run wizard. Must be exactly `"1"` |
| `FAILPROOFAI_DAEMON_BINARY` | Names the daemon binary explicitly; also **disables version-skew warnings entirely** |
| `FAILPROOFAI_CLOUD_URL` | Overrides `credentials.json` outright; `config --status` then says "configured by environment" and every other row is suppressed. **The daemon then also requires `FAILPROOFAI_CLOUD_TOKEN` and `FAILPROOFAI_MACHINE_ID` or it errors** |
| `FAILPROOFAI_CLOUD_TOKEN`, `FAILPROOFAI_MACHINE_ID` | Required companions to the above |
| `FAILPROOFAI_CLOUD_CREDENTIALS` | Points the cloud credential at a standalone JSON file |
| `FAILPROOFAI_INGEST_URL` / `FAILPROOFAI_INGEST_KEY` | Collector delivery target and bearer |
| `FAILPROOFAI_<SOURCE>_EXTRA_PATHS` | Comma-separated capture roots. **REPLACES the file's list, never appends** |
| `FAILPROOFAI_NO_DOWNLOAD` | Refuses network fetches (daemon binary, packs). Installed packs keep enforcing |
| `FAILPROOFAI_TELEMETRY_DISABLED` | Exactly `"1"`. The **weaker** switch — it cannot reach a system-scope daemon; the machine-wide one is `telemetry.enabled = false` in `config.json` |
| `FAILPROOFAI_NO_AUTO_AUDIT` | Exactly `"1"`. Suppresses the post-setup audit |
| `FAILPROOFAI_DASHBOARD_HOST` | Dashboard bind address. Undocumented, and should almost never be changed — see below |
| `FAILPROOFAI_LOG_LEVEL` | `info` \| `warn` \| `error`, default `warn` |
| `FAILPROOFAI_HOOK_LOG_FILE` | **Names a DIRECTORY, not a file.** `"1"`/`"true"` means the default `logs/`; anything else is used as a directory and `hooks.log` is created inside it |
| `FAILPROOFAI_API_URL` | Auth/report base. Note `FAILPROOF_API_URL` (no `AI`) is checked **first** in the audit login path |
| `FAILPROOFAI_WORKER_CMD`, `FAILPROOFAI_CLI_CMD` | Absolute commands the daemon uses for its worker and audit lanes — a system unit inherits no login environment and a bare `node` is not on the system PATH under nvm |
| `FAILPROOFAI_DAEMON_SOCKET`, `_STATE_DIR`, `_AUTH_DIR`, `_PACK_DIR`, `_PACK_BASE_URL`, `_DAEMON_BASE_URL`, `_CLOUD_POLICY_DIR`, `_POLICY_LOAD_TIMEOUT_MS`, `_PACKAGE_ROOT`, `_DIST_PATH`, `_COLLECTOR_CONFIG_POLL_MS`, `_CLOUD_POLICY_POLL_MS` | Path, URL and timeout overrides, mostly for tests and containers |

Three of these have edges that decide whether the machine does what you think:

- **`FAILPROOFAI_DASHBOARD_HOST`.** The local dashboard has no authentication and is a *write*
  surface — it can toggle policies and uninstall failproofai's hooks from every agent CLI. A
  non-loopback bind prints a loud warning. The port is effectively hardcoded at 8020: the
  top-level unknown-flag guard rejects `--port` before the launcher sees it, and the launcher
  then overwrites `PORT` unconditionally, so exporting `PORT` does nothing either.
- **`FAILPROOFAI_<SOURCE>_EXTRA_PATHS` replaces, never appends**, and the source-vs-harness
  split is a trap: extras resolve per **harness key**, and `claude`'s list is handed to the
  `claude-subagent` source as well. `FAILPROOFAI_CLAUDE_SUBAGENT_EXTRA_PATHS` is never read —
  set `FAILPROOFAI_CLAUDE_EXTRA_PATHS` and subagent transcripts under that root are captured
  too.
- **`FAILPROOFAI_HOME` set for one process and not the other** is the trap nothing detects.
  Part of the status shim ignores it and hardcodes `homedir()`, so on a relocated home it
  reports against a directory the daemon is not using.

---

## Group 3 — the surviving `AGENTEYE_*`

Three names, and **not one of them configures either CLI**. Each is a live contract with a
different component. Renaming or "modernising" one breaks a running system.

| Variable | Owned by | What it is |
|---|---|---|
| `AGENTEYE_HOME` | the local daemon (and legacy `agenteye`) | A **path, not a credential**. The `~/.agenteye` root: the daemon watches the legacy SDK event spool at `$AGENTEYE_HOME/events`, default `~/.agenteye/events`. The only `AGENTEYE_*` name the local codebase reads at all, and `fp` does not read it |
| `AGENTEYE_KEY` | the collector | The **ingest** bearer, normally scoped to `events:add` alone |
| `AGENTEYE_API_KEY` | the dashboard service | Its own **admin-grade** key |

The spool path is a contract with the collector, not a preference, which is why it did not
move when everything around it was renamed. The daemon watches both SDK roots indefinitely.

**Never reuse `AGENTEYE_KEY` or `AGENTEYE_API_KEY` as `FP_API_KEY`.** They are different
credentials with different scopes; see *Group 1*.

### `AGENTEYE_TOKEN` is not a variable — it is a trap

It appears in the SDK install doc as `GITHUB_TOKEN=$AGENTEYE_TOKEN` and
`Authorization: Bearer $AGENTEYE_TOKEN`. **It is an invented placeholder for a GitHub personal
access token.** No artifact in this product defines it, nothing reads it, and it authenticates
a release download from GitHub — not FailproofAI.

It must **not** become `FP_TOKEN`. A mechanical rename here points a GitHub credential at the
dashboard, or a dashboard session at GitHub, and neither fails in a way that names the cause.

### Names that look like they belong here and do not

`AGENTEYE_SPOOL_TO_FAILPROOFAI` and `AGENTEYE_ENVIRONMENT` appear in FailproofAI's docs but
exist **nowhere in the local codebase** — they belong to the Python SDK. Do not go looking for
a read site in `failproofai`; there is none.

`AGENTEYE_ORG` is a third case again: legacy `agenteye` genuinely reads it as its tenant slug,
the Python SDK uses it, and the local codebase does not. Under `fp` the equivalent is `FP_ORG`
— while the *header* it ends up as stays `X-AgentEye-Org` and must never be modernised.

---

## Variables neither product owns but both honour

| Variable | Effect |
|---|---|
| `NO_COLOR` | `fp` binds it to `--no-color`. The cross-tool convention |
| `DO_NOT_TRACK` | `fp` treats it as `FP_ANALYTICS_DISABLED`. Customer CI is deliberately not excluded from telemetry by default, so this is the way out |
| `PYTEST_CURRENT_TEST` | Set by pytest; `fp` reads it to suppress telemetry, alongside `FP_CLI_DEV` |

## Quick disambiguation

Given a variable name, this is the whole decision:

| It starts with | It configures | If it does not work, the likely cause |
|---|---|---|
| `FP_` | `fp`, the cloud CLI | You added a `CLI` infix, or you are running `agenteye` |
| `FAILPROOFAI_` | the local CLI and daemon | You set it for the CLI but not the daemon's unit, which inherits no login environment |
| `AGENTEYE_HOME` | the `~/.agenteye` root — the daemon's spool, and legacy `agenteye`'s session | You expected it to configure `fp`. It never did |
| `AGENTEYE_KEY` / `AGENTEYE_API_KEY` | the collector / the dashboard service | You expected it to authenticate `fp`. Use `FP_API_KEY` |
| `AGENTEYE_CLI_*` | legacy `agenteye` 0.1.13 | Nothing is wrong — but `fp` ignores every one of them |
| `AGENTEYE_TOKEN` | nothing | It is a GitHub PAT placeholder from a doc. It has no read site |
