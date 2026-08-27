# Every command of both binaries

The `fp` surface in full — all 23 commands, every subcommand, real flag spellings,
permissions, and the `--json` shape where the CLI states one. Then a compact map of the
local `failproofai` binary. Verified against `fp-cloud-cli` 0.0.1b1 by running
`fp <cmd> [<sub>] --help` down to every leaf, plus the installed `fp_cli/` source under
`~/.local/share/uv/tools/fp-cloud-cli/lib/python*/site-packages/`.

**Resolve the binary before writing a command.** `command -v fp agenteye` — prefer `fp`.
Legacy `agenteye` 0.1.13 is a different package with a smaller surface; see *What the legacy
binary does not have* at the end of the `fp` section.

## Argument order is a hard rule

Global options go **before** the command. A command's own options go **after** it. Getting
it backwards is a usage error, not a warning:

```bash
fp --json sessions                              # OK
fp sessions --json                              # usage error, exit 2
fp --json keys create ci-bot --permission-set read-only
#  ^global   ^command ^subcommand ^its own option
```

`fp sessions --json` exits 2 and, when it can tell you meant JSON, prints the envelope
itself:

```json
{"error": "No such option: --json (Possible options: --since, --to)",
 "exit_code": 2,
 "hint": "global options go before the command, e.g. 'fp --json <command>'"}
```

Every command accepts `--json`, so the whole surface is agent-drivable. Under `--json`,
failures print `{"error": …, "exit_code": …}` (plus `"hint"` when there is one) **on
stdout**; human status and progress go to stderr.

### Globals

| Option | Env | Notes |
|---|---|---|
| `--json` | `FP_JSON` | JSON to stdout instead of a table |
| `--base-url URL` | `FP_DASHBOARD_URL` | Default `https://app.befailproof.ai`. Saved at login |
| `--org SLUG` | `FP_ORG` | Active tenant. In key mode **only an explicit `--org` is ever sent** |
| `--token` | `FP_TOKEN` | Session token override |
| `--api-key` | `FP_API_KEY` | Authenticate as a key against `/v1`. Never written to disk |
| `--insecure` / `--secure` | `FP_INSECURE` | Skip TLS verification. Saved at login, honoured only for the base URL it was saved for |
| `--timeout` | — | HTTP seconds, default `30.0`. `<= 0` is a usage error |
| `--quiet` / `-q` | — | Suppress stderr status |
| `--no-color` | `NO_COLOR` | Disable colour |

`--api-key` and `--token` on the command line together is a usage error — the CLI never
guesses. Precedence, highest first: `--api-key` flag → `--token` flag → `FP_API_KEY` →
`FP_TOKEN` → the saved session. A key env var beats a token env var; an explicit `--token`
beats `FP_API_KEY`. `--api-key ""` (an unset CI variable spelled out) keeps key mode with an
empty credential and fails, rather than quietly acting as whichever human is logged in.

## Exit codes

Stable, and the thing to script on (`fp_cli/errors.py`):

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | unexpected error — an unhandled server status, a refused audit run, a `--expect` miss |
| `2` | usage error — including **"this credential can never do that"** (see below) |
| `3` | cannot reach the dashboard |
| `4` | not signed in, or the session expired |
| `5` | authenticated, but missing the required permission |
| `6` | resource not found |

**Do not branch on exit 4 to test sign-in.** `fp whoami` never errors — see *whoami*.

## What an API key cannot run

Key mode reuses **exit 2**, deliberately, and every refusal fires *before* any HTTP call, so
an unsupported command never half-runs. Refused outright:

| Refused under `--api-key` / `FP_API_KEY` | Why the CLI says no |
|---|---|
| **every `policies` subcommand except `policies test`** | cloud-managed policies are an operator surface, not on the versioned API a key authenticates against |
| **every `fleet` subcommand** | same — the fleet is an operator surface |
| **every `guardrails` subcommand** | same — guardrails reads that operator surface |
| every `agent` subcommand | the assistant's chats belong to a person; there is no API route behind it |
| every `orgs` subcommand | org membership belongs to a signed-in user; a key already acts for one org |
| `login`, `logout` | there is no session to establish or clear |
| `keys update` | it needs `keys:update`, which cannot be granted to **any** key — unreachable by construction, not merely unlikely |

**CI cannot drive enforcement**, and no flag changes that. `fp policies test` is the single
exception in the enforce group: it never authenticates at all. Plan a rollout as something a
person runs. `fp whoami` is the one command that still works under a key and reports an
honest third shape.

---

# ESSENTIALS

## `version`

The CLI version in a small branded box. No flags. `fp --json version` emits
`{"version": "<x.y.z>"}` and nothing else; `fp --version` is a bare unboxed string.

## `help`

The command list, plus the argument-order rule that is also printed at the foot of every
command's help page. No flags.

## `login`

Sign in with a 6-digit code emailed to you. The session lands in
`~/.failproofai/fpcli/cli-auth.json` (mode `0600`) and lasts ~24h. Already signed in, it
prints who you are and exits 0 without prompting — `--force` re-authenticates anyway.

| Flag | Notes |
|---|---|
| `--email` / `-e` | Prompted if omitted |
| `--org SLUG` | Skip the org picker. Must be one you can access |
| `--force` | Re-authenticate over a valid session |

The active org is chosen here and saved. One org is picked automatically; several open a
picker (your last-used org is the Enter default). First run, set the dashboard with the
**global** `--base-url` — it is saved for next time.

`--json`: `{"logged_in": true, "email": …, "org": "<slug>", "expires_in_secs": <n>}`.
**Exit 2 means sign-in worked but the org is still unresolved** (multi-org, no `--org`,
non-interactive). The token is saved — re-run with `--org <slug>`; do not re-authenticate.

```bash
fp --base-url https://dash.example.com login
fp login --email you@example.com --org <org>
```

## `logout`

Best-effort server-side revocation, then wipes the token, your email and user id, and the
active org. **Keeps `base_url` and the `--insecure` preference**, so the next login is quick.
Not signed in is a no-op reporting "already signed out". No flags.

`--json`: `{"logged_out": true}`, plus `"already_signed_out": true` when there was nothing to
clear.

## `whoami`

The current user, the active org, and that org's permissions. No flags.

**It never errors on a missing or expired session** — it reports not-logged-in instead, which
is what makes it safe for an agent to probe. Signed in:

```json
{"logged_in": true, "auth_mode": "session", "id": …, "email": …,
 "is_instance_admin": false, "active_org": "<slug|null>",
 "permissions": [...], "memberships": [...]}
```

Signed out it prints `{"logged_in": false, "auth_mode": "none"}` **and exits 0**. Branch on
the `.logged_in` / `.auth_mode` field. Any instruction to read "exit 4 means not signed in"
is wrong and will misreport a healthy machine.

Under a key it reports a third shape: `{"logged_in": false, "auth_mode": "api_key",
"active_org": "<slug|null>"}`. A `null` there is worth reading — an instance-scoped key with
no `--org` resolves server-side to the **default** org, so you get *an* org's data, just not
necessarily the one you meant, with no error anywhere.

```bash
fp --json whoami | jq -r '.auth_mode'
```

---

# OBSERVE

Four listing commands share a time window and a paging model, and then diverge on one thing
that matters: **`events` and `sessions` accept multiple values per filter; `evals` and
`errors` take exactly one value per filter.** Passing `--env prod,staging` to `errors` does
not mean "either" — it looks for one environment literally named `prod,staging`.

Shared across all four: `--since` (presets `all`, `15m`, `1h`, `6h`, `24h`, `7d`), `--from` /
`--to` (ISO-8601 UTC, both override `--since`), `--limit` / `-n` (default 50), `--all`
(auto-paginate up to `--limit`), `--cursor` (resume from a prior `next_cursor`),
`--page-size` (max 200), `--fields` (comma-separated subset, applies to table and `--json`).

Discover legal filter values with `fp list` before guessing one.

## `events`

The raw per-step trail — tool calls, model requests/responses, hooks, results — newest first.
Needs `events:read`.

| Flag | Notes |
|---|---|
| `--env` | Multiple: repeat or comma-separate. Matches any |
| `--event-type` | Multiple. `fp list event_types` for values |
| `--agent-id` | Multiple. `fp list agents` for values |
| `--session-id` | Multiple |
| `--search` | Free-text in the payload, repeatable; matches **any** term |
| `--order` | `asc` or `desc` (default newest-first) |
| `--full` | The heavy feed, with raw `payload` |
| plus the shared window/paging/`--fields` flags | |

Values within one filter match any; different filters are ANDed.

**The default feed is payload-free**, and that is the fast path: each event carries `id`,
`session_id`, `agent_id`, `event_type`, `ts`, `environment`, `summary`, `is_error`,
`error_type`, `output_tokens`, `context_window`, `context_fill`. `summary` is
server-computed — never the raw payload. `--search` keeps the response payload-free but still
scans payload server-side, so broad searches can be expensive.

`--full` (or `--fields payload`) switches to the heavy `/events` endpoint, which is slow at
scale. **Bound it to one `--session-id`.**

`--json`: `{"events": [...], "next_cursor": <cursor|null>}`.

```bash
fp --json events --session-id <session> --all
fp --json events --full --session-id <session> --all | jq '.events[].payload'
```

## `sessions`

One row per agent run, newest first: time · env · agent · session · status.

**`status` is the session's latest *evaluation* outcome** (`done`/`error`/`timeout`), so this
command needs `evaluations:read`, not `events:read`. **Blank means never evaluated, not
failed.**

| Flag | Notes |
|---|---|
| `--env`, `--status`, `--agent-id`, `--session-id` | Multiple each: repeat or comma-separate |
| `--full-ids` | Full session ids in the table (`--json` always has the full id) |
| `--agents` | Expand every multi-agent session into an indented roster. Rendered view only |
| plus the shared window/paging/`--fields` flags | |

A session can involve more than one agent: `agent_id` is the **root** agent (first to start)
and `agents` is the full roster. `--agent-id` matches a session if *any* of its agents is one
you named, not just the root.

`--json`: `{"sessions": [...], "next_cursor": …}`. Each row: `session_id`, `agent_id`,
`agents`, `environment`, `status`, `scores`, `event_count`, `started_at`, `last_event_at`,
`first_event_id`, `last_event_id`, `latest_evaluation`. `status` and `scores` are flattened
up from the latest evaluation for convenience; the whole evaluation stays under
`latest_evaluation`.

```bash
fp --json sessions --status error,timeout --since 24h
```

## `evals`

Scored judgements of agent runs, newest first — or rolled up with `--aggregate`. Needs
`evaluations:read`.

| Flag | Notes |
|---|---|
| `--aggregate` | Totals card + per-metric score stats, worst average first |
| `--env`, `--status`, `--agent-id`, `--session-id` | **One value each**, ANDed |
| `--score KEY:MIN..MAX` | Either bound optional (`factuality:0.9..`, `tool_efficiency:..0.3`). Repeatable; all ranges must match |
| `--full-ids`, `--scores-full` | Table rendering (list mode) |
| plus the shared window/paging/`--fields` flags (list mode) | |

Every filter applies to both modes. `--status` is one of `done`, `error`, `timeout`.

`--json`, list: `{"evaluations": [...], "next_cursor": …}`. Aggregate: `{total,
status_counts, score_stats[], timeline}`.

```bash
fp --json evals --aggregate --agent-id <agent> | jq '.score_stats'
```

## `errors`

Errored events, newest first — or `--aggregate` for a count plus its blast radius. Needs
`events:read`.

| Flag | Notes |
|---|---|
| `--aggregate` | Total, plus sessions and agents affected and how recent the last one is |
| `--env`, `--error-type`, `--event-type`, `--agent-id`, `--session-id` | **One value each**, ANDed |
| `--search` | Free-text in the payload, repeatable; matches any term |
| `--order`, `--full-ids` | List mode |
| plus the shared window/paging/`--fields` flags (list mode) | |

Rows are **light, payload-free events** with the same shape `events` returns by default. The
rendered summary is the server's `summary` field — there is no client-side payload parsing
here. For an errored run's raw payload, go to `fp events --full --session-id <id>`.

`--json`, list: `{"errors": [...], "next_cursor": …}`. Aggregate: `{total, sessions, agents,
last_ts, bins}`.

```bash
fp --json errors --since 24h | jq '.total'
```

## `usage`

The active org's current **fixed 30-day metering window**: telemetry, evaluations, workspace
objects, audits, API keys, members. No flags. Needs `usage:read`.

Read-only, and it **applies and displays no limits** — do not read a usage number as a quota
check.

`--json` returns the dashboard response unchanged: `org_id`, `billing_anchor`, `window`,
`usage`, `calculated_at`, `stale_after`.

Legacy `agenteye` has no `usage` command at all.

---

# ENFORCE

The headline capability of 0.0.1b1, and the group with the sharpest traps. The lifecycle is
**compose → test → publish → fleet deploy → guardrails**, and the two ends of it are the ones
people get wrong: publishing deploys nothing, and a bare `--add` enforces.

**Deployment is CLI-drivable.** Any text saying assignment, promotion or rollback is
"dashboard work" or "not exposed by the cloud CLI" is stale and stops an agent looking for
shipped commands.

**Every subcommand here except `policies test` exits 2 under an API key.**

Rollout depth — sequencing, proving a policy fired, recovering a bad deploy — belongs to
Cloud rollout belongs to `fp-cloud-cli`; GitHub pack publishing belongs to
`failproofai-policy-publish`. This page is the surface.

## `policies`

`list show publish enable disable delete test compose`. Bare `fp policies` prints help and
exits 2.

### `policies list`

Every published policy **version**, newest of each policy first. No flags. Needs
`policies:read`.

Versions are immutable and every one stays addressable, so a policy published three times is
three rows. `state` is `active`, `disabled` (kept, not enforced) or `archived` (deleted;
machines already carrying it keep it until something redeploys).

`--json` is the server's list verbatim — also one entry per version, so **deduplicate on `id`**
if you want one row per policy. It carries full policy source; never paste it into a file.

### `policies show <policy_id>`

One policy including its full source. Needs `policies:read`. `--json`: the policy object with
`source`.

### `policies publish <policy_id> [source]`

**Mints a NEW VERSION; it never edits one in place.** Needs `policies:write`.

| Flag / arg | Notes |
|---|---|
| `policy_id` | Required. Charset: letters, numbers, `.`, `_`, `-` |
| `source` | A path, `@path`, `-` for stdin, a pipe, or omit it to paste interactively |
| `--description` | One-line description |
| `--no-verify` | Skip the JavaScript syntax check |

The source is parse-checked with `node` **before it is sent**, and nothing downstream repeats
that: the server validates the id and a size ceiling, and a broken policy otherwise fails on
the machine at enforcement time. A host without `node` publishes with a warning rather than a
block.

***Publishing deploys nothing.*** A new version sits unused until `fp fleet deploy` puts it
on a machine.

`--json`: the created version plus **`carriers`** — a map of machine id → the version of this
policy it currently runs, so a harness can see what the publish left behind without a second
call.

```bash
fp policies publish no-force-push ./rule.mjs
cat rule.mjs | fp policies publish no-force-push
```

### `policies enable <policy_id>` / `policies disable <policy_id>`

`--yes` / `-y` on both. Needs `policies:write`.

`disable` is not merely "machines stop enforcing it": the server **reissues each affected
machine's deployment without the policy**, advancing that machine's generation. `fp fleet
history` shows the reissue as an ordinary entry. `enable` is the exact inverse — it puts the
policy back into every deployment it was removed from. Nothing needs redeploying by hand
either way.

`--json` on both: `{id, disabled, archived, machinesUpdated}`. `machinesUpdated` is the count
of deployments rewritten, and is the number to check when you expected a no-op.

### `policies delete <policy_id>`

Archive. **Cannot be undone from the CLI.** `--yes` / `-y`. Needs `policies:write`.

Archiving hides the policy from `policies list` and from future deployments. **A machine
already carrying it keeps enforcing it until something redeploys.** Deleting is not a way to
stop enforcement everywhere — `disable` is.

`--json`: `{id, disabled, archived, machinesUpdated}`, or `{"cancelled": true}` if you
decline.

### `policies test [source]`

Run a policy locally and print what it would decide. **No server, no fleet, no auth** — the
one enforce command an API key can run, because it authenticates nothing.

| Flag / arg | Default | Notes |
|---|---|---|
| `source` | — | Policy file, `@path`, `-` for stdin, or omit to paste |
| `--tool` | `Bash` | Tool name the hook fired for |
| `--command` | — | Bash command to test against |
| `--file` | — | File path to test against |
| `--event` | `PreToolUse` | Hook event type |
| `--expect` | — | Assert `allow`/`deny`/`instruct`; **exit 1 if it is not** |

Needs `node` on PATH. It executes the real file — a bare `import { deny } from "failproofai"`
resolves with **nothing installed in the working directory**, because the CLI shims the module
itself. Nothing is published and nothing is installed.

**State its limits honestly.** It proves the policy parses, registers and decides for the
input you gave. It **cannot** prove the daemon feeds it the same context.

`--json`:

```json
{"ok": true, "decision": "deny",
 "policies": [{"name": …, "description": …, "decision": …, "reason": …}],
 "error": "", "syntax": {"ok": true, "checked": true, "message": ""},
 "expected": null, "met": true}
```

The overall `decision` is the **strictest** any registered policy returned. `ok` is `false`
when the file registered no policies — a common shape mistake, since a policy registers with
`customPolicies.add({...})` at import time and a default export registers nothing.

Known-good shape to paste:

```bash
fp policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",...}]}
```

### `policies compose "<prompt>"`

The Cloud assistant drafts a policy from plain English. Session-only.

| Flag | Notes |
|---|---|
| `--out PATH` | Write the draft to a file |
| `--publish <policy_id>` | Publish it immediately, still syntax-checked first |

By default the draft is printed and nothing else happens — a generated policy that deploys
itself is a generated policy nobody read.

***It needs `policies:write`, not `agent:use`.*** The route is `POST
/api/agent/compose-policy`, which the dashboard exports as `withAuth("policies:write", …)`;
`agent:use` gates the assistant's *other* routes (chat, answer, conversations) and is not
checked here. So a role holding only `agent:use` is **refused**, and one holding
`policies:write` without it **works**. That is backwards from what the command name implies —
check the grant, not the intuition.

`--json`: `{prompt, source, syntax, published}`.

## `fleet`

`list show deploy diff history rollback rename`. The fleet and what each machine enforces.

### `fleet list`

Machines and how many policies each is told to run: machine · label · pol · intended ·
applied · seen · events · state. No flags. Needs `policies:read`.

`intended` is the generation deployed, `applied` the one the machine last collected, `seen`
when it last reported anything. **A machine can be in sync and dead, or alive and behind, and
those are different problems.** A machine appears from its very first check-in, including the
poll that finds nothing deployed — which is usually the machine you are looking for.

`--json`: `{machines, deployments}`, each machine carrying raw timestamps plus a computed
`drifted`.

### `fleet show <machine_id>`

Exactly what one machine is told to enforce. Needs `policies:read`.

**Read this before a `--set`** — that flag replaces all of it. It also reports whether the
machine has actually *collected* that deployment; a machine can be told to run a policy and
not yet have it, and the policy list alone cannot tell you which.

`--json`: `{machine, deployment}` — the machine record (`appliedDeployment`, `drifted`,
`lastSeen`, both label fields, raw timestamps) and the deployment, or `deployment: null` when
nothing is deployed.

### `fleet deploy <machine_id>`

Change what a machine enforces, showing the full resulting set first. Needs `policies:write`.

| Flag | Notes |
|---|---|
| `--add REF` | Add or update one policy |
| `--remove ID` | Remove one policy by id |
| `--set REF` | **REPLACE the whole set** with exactly these. Cannot combine with `--add`/`--remove` |
| `--create` | Allow deploying to a machine id that has not checked in yet (pre-staging) |
| `--yes` / `-y` | Skip the confirmation prompt |

Ref grammar is exactly `id` | `id@version` | `id:effect` | `id@version:effect`. Effects are
exactly **`enforce`** and **`observe`**.

***A bare `--add` on a policy the machine does not already run deploys it as `enforce`.***
That is the most dangerous default on the surface: the effect resolution is explicit → the
deployed effect → `enforce`. If you want a dry run on a machine, you must say
`--add <id>:observe`.

Traps, each one confirmed in `fp_cli/enforcement.py`:

- **Refs are not comma-split.** `--add a,b` is one malformed ref, exit 2. Repeat the flag.
- **`--add` on a policy already deployed keeps its pinned version** rather than silently
  upgrading. Pass `id@version` to move it.
- **`--set` is exclusive with `--add`/`--remove`** — mixing "these exactly" with "these as
  well" has no single reading, and the CLI refuses rather than guess about somebody's fleet.
- **No flags at all is exit 2**, not a no-op.
- **A no-op exits 0 without writing** — desired-state semantics, so a retrying harness
  succeeds. `applied: false` in `--json` is the *only* way to tell "I changed it" from "it
  already matched". The short-circuit happens before the write, so a reader without
  `policies:write` also gets 0 here; **the exit code alone is not proof of write access**.
- **A declined prompt exits 0** with `{"plan": …, "cancelled": true, "applied": false}`.
- **Concurrency is base+1.** The write is a full replace with no server-side lock, so the CLI
  records the generation it read and refuses if the result is not exactly one higher — exit 1,
  meaning somebody else deployed in between and a replace does not merge. Re-read with `fleet
  show` before retrying; never loop on it.
- **`--create` mints a machine on a typo.** The server accepts a deploy to any id, so without
  the pre-flight check a typo creates a machine nobody owns carrying policies nobody will
  collect. Without `--create` the CLI refuses with exit 6 and says so.
- **A disabled policy is refused** in a ref unless the machine already carries it — the server
  would reject the deployment.

`--json`: the plan plus the resulting deployment.

```bash
fp fleet deploy <machine-id> --add no-force-push:observe
fp fleet deploy <machine-id> --add no-force-push@2 --remove old-rule
fp fleet deploy <machine-id> --set no-force-push --set no-secret-echo
```

### `fleet diff [machine_id]`

Intent vs delivery — what a machine is told to run vs what it last pulled. Omit the id for
the whole fleet. Needs `policies:read`.

**The gap is the interesting part**: a machine that has not collected its latest deployment is
not enforcing what the dashboard says it is, and nothing else surfaces that as a single
number.

`--json`: `{machines:[{machineId, intended, delivered, drifted}]}` — `drifted` is computed by
the CLI, so a harness need not derive it.

### `fleet history <machine_id>`

Deployment generations, newest first. Needs `policies:read`. A reissue — the server rewriting
a deployment because a policy was disabled — appears as an ordinary entry.

`--json`: `{machineId, history:[{deployment, policies, updatedAt}]}`.

### `fleet rollback <machine_id> <deployment>`

Reinstate a past generation's policy set. `--yes` / `-y`. Needs `policies:write`.

**It mints a NEW generation carrying the old set** rather than rewinding the counter, so
history stays append-only. A generation containing a policy since disabled or deleted cannot
be reinstated; the server says so.

`--json`: the resulting deployment, or `{"cancelled": true}`.

### `fleet rename <machine_id> <label>`

A human label. **The id itself never changes.** Needs `policies:write`.

`--json`: `{machineId, labelOverride}` — the server stores the label as an override *beside*
the machine's self-asserted one rather than replacing it.

## `guardrails`

`summary timeline` — what enforcement actually did. Bare `fp guardrails` prints help and exits
2; the summary is a named subcommand. Both need `policies:read`. Both take `--since` (`1h`,
`6h`, `24h`, `7d`; default `24h`) and `--machine <machine_id>`.

### `guardrails summary`

Evaluated/blocked totals, how many machines are enforcing versus merely reporting, a 24-bin
sparkline of denies, and per policy: fired / blocked / instructed / p95.

**A `(no policy)` row is normal, not a gap.** Most evaluations are allows no policy objected
to, and the row keeps the denominator on screen — a blocked count means little without the
total it came from.

`--json`: the server summary plus the timeline.

### `guardrails timeline`

One row per time bucket: time · activity · total · denied · instructed. The bar is scaled to
the busiest bucket in the window with the blocked share drawn inside it. Times are UTC and the
label follows the bucket size the server chose — a clock for hourly buckets, a date for daily.

`--json`: the server's timeline verbatim.

---

# MANAGE

## `orgs`

`list switch current perms`. Every subcommand is refused under an API key.

| Subcommand | Notes | `--json` |
|---|---|---|
| `list` | Orgs you belong to, your role in each, the active one marked `●`. Read from the current session | `{active_org, is_instance_admin, orgs:[{org_slug, org_name, permission_set, permissions, active}]}` |
| `switch [slug]` | Slug switches straight; omit it for an arrow-key picker. Persisted to `cli-auth.json` | `{"active_org": "<slug>"}` — **a slug is required under `--json`** |
| `current` | Compact identity card: slug, name, role, permission count, signed-in email | `{slug, name, role, permission_count, user_email}` |
| `perms` | Your grants in the active org, grouped by resource | `{slug, role, permissions, permission_count}` |

The active org resolves as `--org`/`FP_ORG` → the saved default → your sole org if you belong
to just one. **`orgs switch` rewrites persistent state and silently retargets every later
command**; `--org` scopes one invocation. A non-interactive `switch` with no slug falls back
to a numbered prompt.

## `keys`

`list show create update disable regenerate`. Keys are referenced **by name**, unique in the
org. A key carries a flat set of permissions: a role via `--permission-set`, plus `--add` /
`--remove` overrides. Effective grants are `(set ∪ added) − removed`.

`--add` / `--remove` take the compact `slug:action.action` token format — dotted actions
expand (`events:read.add` → `events:read`, `events:add`) — and compose by comma, repeated
flag, or a quoted group.

| Subcommand | Flags | Needs | `--json` |
|---|---|---|---|
| `list` | `--show-id`, `--fields` | `keys:read` | `{"keys": [{id, name, permissions, created_at, revoked_at}]}` |
| `show <name>` | — | `keys:read` | the full key object |
| `create <name>` | `--permission-set`, `--add`, `--remove` | `keys:create` | `{id, name, permissions, created_at, key}` |
| `update <name>` | `--permission-set`, `--add`, `--remove`, `--yes` | `keys:update` | `{…, added, removed}` |
| `disable <name>` | `--yes` | `keys:disable` | `{"name", "status": "disabled"}` |
| `regenerate <name>` | `--yes` | `keys:regenerate` | `{"name", "key"}` |

Edges worth knowing before you run one:

- **The secret is revealed exactly once**, at create or regenerate, under the `key` field.
  Output routing is sensitivity-blind: interactive gets a decorated box, **piped or redirected
  the bare secret goes to stdout**.
- **`keys update` cannot be run by a key** — `keys:update` is grantable to no key at all.
- **`disable` cannot be undone.** Mint a replacement.
- On `update`, `--add`/`--remove` alone are incremental against the key's *current* grants;
  adding `--permission-set` reseeds first and then applies them. A no-op exits without calling
  the server.
- Human-only permissions are dropped when a role is expanded into a key.

## `users`

`list show create update disable enable`. Members are referenced **by email** (a UUID id is
also accepted). Same `--permission-set` + `--add`/`--remove` language as `keys`.

| Subcommand | Flags | Needs | `--json` |
|---|---|---|---|
| `list` | `--active-only`, `--show-id` | `users:read` | `{"users": [{id, email, permissions, permission_set, disabled_at, is_protected, created_at, …}]}` |
| `show <email>` | — | `users:read` | the full member object |
| `create <email>` | `--permission-set`, `--add`, `--remove` | `users:create` | `{id, email, permission_set, permissions}` |
| `update <email>` | `--permission-set`, `--add`, `--remove`, `--yes` | `users:update` (+ `users:read`) | `{…, added, removed}` |
| `disable <email>` | `--yes` | `users:delete` | `{id, email, status: "disabled"}` |
| `enable <email>` | `--yes` | `users:delete` | `{id, email, status: "active"}` |

`disable` refuses a protected member and refuses your own account; already-disabled is a calm
no-op. Note the permission: disabling and enabling both need `users:delete`, **not**
`users:create`.

On `update`, `--permission-set` **replaces the member's per-member overrides**; apply fresh
ones with `--add`/`--remove` in the same call.

## `query`

`list show create update delete run schema`. Saved SQL against the read-only analytics pool.
Referenced by name (a UUID-shaped id also works).

| Subcommand | Flags | Needs |
|---|---|---|
| `list` | `--show-id`, `--fields` | `queries:read` |
| `show <name>` | — | `queries:read` |
| `create <name>` | **`--sql` (required)**, `--description` | `queries:write` |
| `update <name>` | `--name`, `--sql`, `--description`, `--yes` | `queries:write` |
| `delete <name>` | `--yes` | `queries:delete` |
| `run [name]` | `--sql`, `--limit`, `--all`, `--arg` (alias `--param`) | `queries:run` |
| `schema [table]` | — | `queries:read` |

`--sql` takes inline SQL or `@file.sql`. `run` takes either a saved query name or ad-hoc
`--sql`; `--arg` binds `$1..$N` positionally, in order, and is repeatable. `update` merges —
it reads the query first, so omitted fields keep their current value.

`run --json`: `{columns: [{name, type}], rows: [[...]], truncated, elapsed_ms}` — **all rows**,
regardless of `--limit`, which only caps the table view.
`schema --json`: `{schema, columns: [{table, column, type, nullable}]}`.

```bash
fp --json query run --sql "select count(*) from analytics.events"
```

## `alerts`

`list show create update delete test`. Referenced by name, unique per org. An alert is a
trigger (shaped per `--trigger-kind`) + an evaluation cadence + channels (email / Slack /
webhook).

| Subcommand | Flags | Needs | `--json` |
|---|---|---|---|
| `list` | `--show-id` | `alerts:read` | `{"alerts": [{id, name, created_by, trigger_kind, severity, enabled, last_attempted_at, created_at, open_incidents, …}]}` |
| `show <name>` | — | `alerts:read` | the full raw Alert |
| `create <name>` | see below | `alerts:write` | `{id, created_at}` |
| `update <name>` | same + `--name`, `--yes` | `alerts:read` **and** `alerts:write` | `{id, updated_at}` |
| `delete <name>` | `--yes` | `alerts:write` | `{"deleted": true, id, name}` |
| `test <name>` | `--channels`, `--yes` | `alerts:write` | `{ok, synthetic_incident_id}` |

Definition flags, shared by `create` and `update`: `--file` (a complete `AlertInput`, or `-`
for stdin), `--description`, `--severity` (`info`, `warning`, `critical`), `--trigger-kind`
(`metric_threshold`, `custom_sql`, `evaluation_score`, `eval_compound`, `per_event`),
`--trigger-spec` (JSON), `--channels` (JSON array), `--eval-interval-secs` (30–86400),
`--min-breaches`, `--eval-window`. Flags layer **on top of** `--file`.

Two things to say out loud before running one:

- **`update` needs read as well as write.** The server replaces the whole alert, so the CLI
  re-sends the current definition with your change applied.
- **`test` really delivers** to the alert's email/Slack/webhook channels. The server reports
  success as soon as it dispatches — actual delivery is not confirmed.

`delete` previews the alert including its open-incident count, which the delete orphans. New
alerts start enabled. Not-found on `show` is exit 6.

```bash
fp alerts create high-errors --trigger-kind metric_threshold --severity warning \
  --trigger-spec '{"metric":"error_count","op":">","value":50,"window_secs":900}'
```

## `audits`

Eighteen subcommands: `list show create edit delete run runs context-show context-set
context-refresh findings finding ack mute dismiss resolve reopen assign`. Audits are
referenced by **name**, findings by **id**.

An audit runs on a schedule and sweeps a window of activity. What it produces are
**findings** — recurring patterns carried across runs.

### Definitions

| Subcommand | Flags | Needs |
|---|---|---|
| `list` | `--enabled-only`, `--show-id` | `audits:read` |
| `show <name>` | — | `audits:read` |
| `create <name>` | see below | `audits:write` |
| `edit <name>` | same + `--name`, `--yes` | `audits:write` (flag-only edits also need `audits:read`) |
| `delete <name>` | `--yes` | `audits:write` |
| `run <name>` | — | `audits:write` |
| `runs <name>` | `--limit` / `-n`, `--show-id` | `audits:read` |

Definition flags on `create` / `edit`: `--file` (full JSON, or `-`), `--description`,
`--enabled` / `--disabled`, `--schedule-interval-secs` (3600–604800), `--schedule-anchor`
(ISO 8601 UTC; default the next 09:00 UTC), `--window-mode` (`fixed`, `since_last`),
`--lookback-window-secs` (3600–7776000), `--scope` (JSON), `--ignore-error-type` (repeatable
or CSV), `--llm` / `--no-llm`, `--top-k`, `--sensitivity` (`low`, `medium`, `high`),
`--channels` (JSON array). `create` additionally takes `--text`, `--text-file` and `--url`
(repeat up to 5, public `https://` only).

Everything except the name has a server default — a bare `fp audits create nightly` gives a
daily, LLM-backed audit over all activity. New audits start enabled unless `--disabled`.

**Attach reference context in the create call.** `--text`/`--text-file`/`--url` on `create`
go in the same request, which is the only way to be sure the first run has them: a new enabled
audit is due immediately, so context set afterwards can miss it. A URL the guard refuses fails
the whole create — no half-made audit is left behind.

**`run` means queued, not finished.** It makes the audit due; the dispatcher picks it up on
its next tick. Follow with `fp audits runs <name>`. A disabled audit, or one with a run
already in progress, is refused with the server's explanation (exit 1) rather than
double-queued.

`create --json`: `{id, created_at, sources}`. `edit --json`: `{id, updated}`. `runs --json`:
`{"runs": [{id, status, trigger_kind, window_from, window_to, started_at, finished_at, stats,
findings_count, new_findings_count, report, error}]}`.

A name collision on `create`, or a rename onto an existing name on `edit`, is exit 2.

### Reference context

`context-show <name>` (needs `audits:read`) prints the operator brief plus every reference URL
with its fetch state: characters stored, whether the snapshot was truncated, how many
secret-shaped values were masked, and whether the page contains phrases that read as
instructions to an AI. Read that last one before the next run.

`context-set <name>` (needs `audits:write`) takes `--text`, `--text-file`, `--url`
(repeatable, replaces the list) and `--clear-urls`. **Each half is independent and omission
means keep.** Removing is always explicit: `--text ""` clears the brief, `--clear-urls` drops
every URL and its snapshot. URLs are validated immediately — public `https://` only; private,
loopback and cloud-metadata addresses are refused — then fetched in the background.

`context-refresh <name>` re-fetches every reference URL now. Snapshots refresh weekly on their
own. URLs the guard refused are not retried; nothing about them can change until the URL does.

### Triage

`findings` lists across audits, highest priority first: `--audit <name>`, `--run-id`,
`--status` (CSV of `open`, `recurring`, `resolved`, `dismissed`, `muted`; default open +
recurring), `--limit` / `-n` (default 100, server caps at 500), `--offset`, `--show-id`. Needs
`audits:read`.

`finding <id>` shows one in full. Not-found or a malformed id is exit 6.

The five verbs, all needing `audits:write`, differ in what they leave behind — that is the
whole point of having five:

| Verb | Status | Suppression | Confirms |
|---|---|---|---|
| `ack` | **unchanged** | ranks the pattern lower in later runs | no |
| `mute` | `muted` | durable — a re-detection of the same fingerprint stays hidden | yes (`--yes`) |
| `dismiss` | `dismissed` | durable, same as mute; the label says "judged not a problem" | yes (`--yes`) |
| `resolve` | `resolved` | **none, deliberately** — if it comes back, the next run raises it as new | yes (`--yes`) |
| `reopen` | `open` | clears mute/dismiss suppression | no |

`ack`, `mute` and `dismiss` take `--reason`, kept as durable feedback. `assign <id> --to
<email>` sets the owner and leaves the status untouched; **`--to` is required**. All of them
`--json` as `{id, action, ok}`, plus `{"cancelled": true}` on the three that prompt.

## `issues`

`list count show ack assign resolve comment-list comment-add comment-delete subscribers
subscribe unsubscribe open`.

**The CLI still calls them incidents internally** — every positional is `INCIDENT_ID` and the
help says "incident". Same object.

| Subcommand | Flags | Needs |
|---|---|---|
| `list` | `--state` (CSV: `firing`, `acknowledged`, `resolved`), `--alert-id`, `--limit` / `-n`, `--show-id` | `issues:read` |
| `count` | `--state` (CSV) | `issues:read` |
| `show <id>` | — | `issues:read` |
| `ack <id>` | — | `issues:read` — ack rides on read |
| `assign <id>` | `--assignee` (repeatable; omit to clear) | `issues:create` |
| `resolve <id>` | `--yes` | `issues:close` |
| `comment-list <id>` | — | `issues:read` |
| `comment-add <id>` | `--body` or `--file`/`-`, exactly one | `issues:read` |
| `comment-delete <id> <comment_id>` | `--yes` | `issues:read` for your own, `issues:close` to moderate others' |
| `subscribers <id>` | — | `issues:read` |
| `subscribe <id>` / `unsubscribe <id>` | `--email` (default: you) | — |
| `open` | **`--summary` (required)**, `--title`, `--alert-id`, `--severity` | `issues:create` |

`count` with no `--state` counts the open ones (firing + acknowledged) and returns
`{"count": N}`.

`assign` **replaces** the assignee list. The server rejects the whole call if any email is not
an operator.

`open` needs `--title` for a standalone incident — there is no parent alert whose name it
could borrow — and it is optional with `--alert-id`, where it defaults to the alert's name. A
missing `--title` or an invalid `--severity` is exit 2. `--json`: `{id, newly_opened, state}`.

## `settings`

`list schema set`.

| Subcommand | Flags | Needs |
|---|---|---|
| `list` | — | `settings:read` |
| `schema` | — | `settings:read` |
| `set <key>` | `--value`, `--json-value`, `--file`, `--yes` | `settings:write` |

`schema` is the registry — what each key is and what it accepts — derived from each setting's
schema blob; there is no separate schema endpoint. `list` is your org's current values, with
secrets masked in the table (full values in `--json`).

`set` takes the value **exactly one way**: `--value` (scalar; a digit-only value is sent as an
integer), `--json-value` (raw JSON for arrays/objects), or `--file`/stdin (JSON). An unknown
key is exit 6.

```bash
fp settings set session_ttl_secs --value 86400
fp settings set alerts.email_default_recipients --json-value '["you@example.com"]'
```

---

# TOOLS

## `list`

`envs agents event_types score_filters models hooks tools error_types` — the distinct values
behind the dashboard's filter dropdowns. No flags on any subcommand.

**Run this before guessing a filter value.** `--json` is uniformly
`{"kind": "<subcommand>", "values": [...]}`.

Permissions differ slightly: `envs`, `agents` and `event_types` need `events:read` **or**
`evaluations:read`; `score_filters` needs `evaluations:read`; `models`, `hooks`, `tools` and
`error_types` need `events:read`.

```bash
fp --json list event_types | jq '.values'
```

## `agent`

`health models chats ask show rename delete` — the FailproofAI Cloud assistant, scoped to your
org. Every subcommand needs `agent:use` and **every one is refused under an API key**: the
chats belong to a person and there is no API route behind it.

| Subcommand | Flags | `--json` |
|---|---|---|
| `health` | — | `{enabled, llm_configured?, model?, models?, default_model?}` |
| `models` | — | `{"models": [...], "default_model": …}` |
| `chats` | — | `{"chats": [{id, title, updated_at, message_count}]}` |
| `ask [message]` | `--chat`, `--model`, `--page-context` | `{answer, tools, interrupted, error, chat_id}` |
| `show <chat_id>` | — | `{title, messages: [...]}` |
| `rename <chat_id>` | **`--title` (required)** | `{id, title}` |
| `delete <chat_id>` | `--yes` | `{"deleted": true, id, title}` |

Chats are addressed by a **short id** — the first 8 characters, shown by `agent chats`; the
CLI resolves the prefix. No `--chat` starts a new chat and prints its short id; `--chat`
continues one, sending the prior thread for context.

Piped, `ask` writes the raw answer to stdout — a clean payload. A brand-new chat is created
only once an answer lands; if the assistant needs interactive input it aborts (exit 1) and
leaves no empty chat. Not-found on `show`/`rename`/`delete` is exit 6.

Note this is a *different* thing from `policies compose`, which is also assistant-backed but
gated on `policies:write` rather than `agent:use`.

---

## What the legacy binary does not have

`agenteye` 0.1.13 (dist and module `agenteye`/`agenteye_cli`) is a **separate package**, still
installable, still working. It advertises **19 commands** to `fp`'s 23. Absent entirely — the
error is `No such command`, not a permission failure:

| Missing from `agenteye` | |
|---|---|
| `usage` | the metering window |
| `policies` | the whole cloud-managed policy surface |
| `fleet` | deploy, diff, history, rollback, rename |
| `guardrails` | summary, timeline |

Missing one level down: **`agenteye audits` has no `context-show`, `context-set` or
`context-refresh`** — the whole reference-context feature. Every other shared group is
subcommand-for-subcommand identical, `issues` included; verified by diffing `--help` on both
binaries for `orgs`, `keys`, `users`, `query`, `alerts`, `audits`, `issues`, `settings`,
`list` and `agent`. Do not assume a spelling differs just because the binary does.

Missing at the flag level: **`agenteye` has no global `--api-key`** (`No such option`), so
key-mode CI is `fp` only. Its env vars are its own — `AGENTEYE_CLI_TOKEN`, `AGENTEYE_CLI_JSON`,
`AGENTEYE_ORG`, `AGENTEYE_DASHBOARD_URL`, `AGENTEYE_INSECURE`, `AGENTEYE_HOME`,
`AGENTEYE_ANALYTICS_DISABLED`, `AGENTEYE_CLI_DEV` — and it reads no `FP_*`. Its session lives
at `$AGENTEYE_HOME/cli.json`, default `~/.agenteye/cli.json`, not inside `~/.failproofai/`.
Its assistant is branded "the AgentEye assistant".

A command missing under `agenteye` means **wrong binary**, not "not shipped". Re-run
`command -v fp agenteye` and prefer `fp`.

---

# The local `failproofai` binary

The npm package (`npm i -g failproofai`, Node >= 20.9). Nothing here talks to the cloud. This
is the map; `skills/failproofai/references/cli.md` is the authority on every edge, and the
`failproofai` skill owns the symptom tables.

**None of the `fp` conventions transfer.** `fp` is a conventional Typer parser and takes
`--timeout=5` happily. Every `failproofai` parser is hand-rolled.

## Four rules that hold across the whole local surface

- **No `--flag=value`.** Guards compare whole tokens against a `Set`, so `--since=6m`,
  `--scope=user`, `--only=git` all trip "Unexpected argument". Exactly **four** flags take the
  equals form: `--cli=`, `--out=`, `--effect=`, `--email=`. `--only` and `--category` are not
  among them despite sitting beside `--cli` in the same invocation.
- **`failproofai audit` and bare `failproofai` never exit.** Both serve until Ctrl+C. Never
  call either in a foreground agent shell — use `timeout`, or hand it to the user. The audit
  cache is written *before* the server starts, so `timeout 180 failproofai audit` (exit 124)
  still leaves `~/.failproofai/audit/dashboard.json`.
- **Two things need a TTY:** the `config` wizard, and `policies --install` with no policy
  names — off a TTY the latter silently narrows to the 11 default-enabled builtins out of 39.
- **Nothing needs sudo except the daemon**, and only `config` and `update` ask for it.

## Subcommands

| Command | Flags |
|---|---|
| `config` (aliases `configure`, `setup`) | `--connect <url> --token <key>`, `--machine-id`, `--machine-label`, `--no-transcripts`, `--disconnect`, `--status`, `--pause [<dur>] [--session <id>]`, `--resume [--all] [--session <id>]` |
| `policies` (aliases `policy`, `pack`, `p`) | `--install`/`-i`, `--uninstall`/`-u`, `--scope user\|project\|local[\|all]`, `--cli`, `--beta`, `--custom`/`-c` |
| `policies add\|remove <name>` | `--scope`, `--cli`, `--beta` **only** — `--custom` is a hard error here |
| `policies add\|remove <owner>/<repo>` | The **pack** lane, chosen by the slash: `[--policy a,b\|--only a,b] [--category x,y] [--all] [--cli <agent>…]`. `--scope` is ignored — a pack install is machine-level |
| `policies show <owner>/<repo>` | `--releases`. Manifest only; no code is fetched |
| `publish [<entry.mjs>]` | `--repo <owner>/<repo>`, `--id`, `--version`, `--tag`, `--notes`, `--out <dir>`, `--effect enforce\|observe`, `--commit`, `--dry-run`, `--allow-private`, `--init [file]` |
| `harness` | `harness list [<h>]`, `add-path <h> [<label>=]<path>`, `remove-path <h> <path\|label>`. No flags on any |
| `audit` | `--schedule [days]`, `--no-schedule`, `--email <a>`, `--status`. Not composable — each rejects every other argument |
| `backfill` | `--since <30d\|6m\|YYYY-MM-DD>`, `--dry-run` |
| `flush` | `--wait`, `--timeout <secs>` (default 60) |
| `update` | `--no-daemon` |
| `migrate` | `--dry-run` |
| `uninstall` | `--purge`, `--dry-run`, `--yes`/`-y` |
| bare `failproofai` | The local dashboard on `127.0.0.1:8020`. Parks |
| `--hook <event> [--cli <name>]` | The harness entrypoint. Exits before the CLI proper |

Traps that decide whether a command did what you think:

- **`config` validates no flags at all.** `failproofai config --statuss` does not error — it
  falls through every check and launches the interactive wizard. Same for `--disconect` or any
  typo.
- **`--cli` is greedy** and stops at the first token that is not a known CLI name, so a typo'd
  CLI name is silently reinterpreted as a policy name. Twelve names, everywhere the same set:
  `claude codex copilot cursor opencode pi hermes openclaw factory devin antigravity goose`.
- **`config --machine-label` used alone is a rename**, a different code path.
- **`config --disconnect` does not stop a running daemon** — the uploader cached its key at
  construction.
- **`policies --uninstall --scope all` has no confirmation prompt at all**, unlike top-level
  `uninstall`. With `--cli` omitted off a TTY, install/uninstall target **every detected agent
  CLI** with no prompt.
- **`uninstall --yes` does more than skip a prompt** — it also removes the systemd service
  unconditionally. No TTY and no `--yes` is a refusal (exit 1), never an assumed yes.
- **`SUBCOMMANDS` is eleven entries** — `policies audit config uninstall backfill flush harness
  publish update migrate help`. `update` and `migrate` are in it now, so `failproofai update
  --help` reaches its own help screen. `policy` and `pack` are not in it and do not need to be:
  both are rewritten to `policies` before the guard reads `args[0]`.
- **`backfill` and `flush` fail loudly (exit 1) on an unconnected machine** rather than
  no-op'ing. `flush --wait` also exits 1 on timeout, which is not a real failure but will kill
  a `set -e` script. `flush` refuses outright on Windows.
- **Non-zero means everything goes to stderr.** Every `{lines, exitCode}` subcommand routes
  per line. The bare `policies` listing is not one of them — a pack that will not load prints a
  warning row and still exits 0, so read the rows rather than the exit code.

## Local exit codes

| Code | Where | Meaning |
|---|---|---|
| `0` | everywhere | success — and, on the `--hook` path, **allow** |
| `1` | most | failure. Also a newer-home layout gate, an unreachable `--help`, a `flush --wait` timeout |
| `2` | `--hook` | **deny** by exit code plus stderr (Claude, and Factory's non-`Stop` events) |
| `2` | `uninstall` | failed to clear the require-the-daemon flag — stops before touching the service |
| `75` | `audit` | `EX_TEMPFAIL` — another audit holds the lock. Come back later; not a failure |
| `124` | `audit`, bare | your own `timeout`, because neither command ever exits |

On the `--hook` path the eight CLIs that read their verdict from stdout get a deny as JSON on
exit 0; the outer catch writes the union of every CLI's deny shape when the handler module
itself will not load, because writing zero bytes and exiting 2 is a **silent allow** on those
eight.
