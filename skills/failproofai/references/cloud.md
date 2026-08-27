# FailproofAI Cloud: the CLI, keys and orgs, the HTTP API, self-hosting

The read-and-administer control plane over telemetry your agents already emitted — and, as of
`fp-cloud-cli` 0.0.1b1, the place cloud-managed policy is written, tested and rolled out.
This file is the **concepts and the auth model**; driving a live deployment — flags, filters,
pagination, triage — belongs to `fp-cloud-cli`, and getting a policy onto machines belongs to
`failproofai-policy-deploy`. Grep anchors point into the cloud CLI's Python package `fp_cli/`
— the installed build under `~/.local/share/uv/tools/fp-cloud-cli/lib/python*/`. Every anchor
below resolves there in 0.0.1b1; the one exception is `INTROSPECT_PATH`, which lives in the
local npm CLI's `cloud-introspect.ts`.

## The product is FailproofAI Cloud; it was called AgentEye

Use the new name in anything you write, spelled the way the binary spells it — **FailproofAI
Cloud**, no space inside "FailproofAI". The old name survives wherever a rename would break
something on the wire or on disk. Those are literals: **never "modernise" one in a command or
a config**, or it stops working.

| Still `AgentEye`, permanently | Who still reads it |
|---|---|
| `X-AgentEye-Org`, `X-AgentEye-Client`, `X-AgentEye-Signature`, cookie `ae_session` | the wire and the session — `fp` still sends every one |
| OpenAPI title "AgentEye API" | generated clients key off it |
| `AGENTEYE_HOME`, `~/.agenteye/events` | the local daemon's event spool. It is a contract with the collector, not a preference, so it did not move |
| `AGENTEYE_KEY` (collector ingest), `AGENTEYE_API_KEY` (dashboard admin) | two *different* credentials, neither of them the CLI's. `FP_API_KEY` was named deliberately not to collide — never tell anyone to reuse either one for it |
| `agenteye-evaluator` / `agenteye_evaluator`, UA `agenteye-server/<version>` | the evaluator was not renamed at all |
| `ghcr.io/agenteye-enterprise/*`, namespace `agenteye`, `agenteye.events` / `agenteye.agent_sessions` | self-hosted infrastructure |

**Environment variables are the exception, and the rule is: the prefix follows the binary.**
`fp` reads **zero** `AGENTEYE_*` variables. Legacy `agenteye` 0.1.13 still reads its own
`AGENTEYE_HOME` / `AGENTEYE_CLI_TOKEN` / `AGENTEYE_CLI_JSON` and reads no `FP_*`. Exporting
the wrong family is silent: the CLI simply behaves as if nothing were set.

Everything `fp` reads, in full:

| Var | Effect |
|---|---|
| `FP_TOKEN` | session token — same as `--token` |
| `FP_API_KEY` | API key — same as `--api-key` |
| `FP_JSON` | same as `--json` |
| `FP_ORG` | tenant slug — same as `--org` |
| `FP_DASHBOARD_URL` | same as `--base-url` |
| `FP_INSECURE` | same as `--insecure` |
| `FP_HOME` | the CLI's own config **directory**, used as-is |
| `FAILPROOFAI_HOME` | the failproofai home root; `fpcli/` is appended to it |
| `FP_ANALYTICS_DISABLED` | opt out of telemetry (`DO_NOT_TRACK` works too) |
| `FP_CLI_DEV` | internal dev/test switch |

**The infix is dropped.** A mechanical `AGENTEYE_` → `FP_` substitution invents names nothing
reads: it is **`FP_TOKEN` and `FP_JSON`**, never `FP_CLI_TOKEN` or `FP_CLI_JSON`. `FP_CLI_DEV`
is the sole survivor of the `CLI` infix and is a test switch, not an auth or output selector —
do not generalise from it.

## Resolve the binary before writing a single command

Three binaries carry this product's name and they are not interchangeable. Resolve once, `fp`
first, and write against whatever answers:

```bash
command -v fp agenteye
```

| Binary | What it is | Install |
|---|---|---|
| `fp` | **the cloud CLI** — dist `fp-cloud-cli` 0.0.1b1, module `fp_cli`. This is what everything here is written against | `uv tool install fp-cloud-cli` |
| `agenteye` | the **legacy** cloud CLI, 0.1.13. A separate distribution, still installable, still authenticates. It has no `policies`, `fleet`, `guardrails` or `usage` | `uv tool install agenteye` |
| `failproofai` | the **local enforcement** CLI (npm, Node >= 20.9). A different tool entirely — it decides on this machine and never touches `/v1` | `npm install -g failproofai` |

**`uv tool install fp-cli` installs nothing you want.** `fp_cli` is the *module*;
`fp-cloud-cli` is the *distribution*. The module name never appears in an install command.

Examples in this file are written as `fp`. On a machine that only has `agenteye`, most of the
observe and manage commands carry over under the same names, but not all of them and not the
same environment — `usage` and `audits context-*` are absent, the enforce group does not exist
at all, and the env prefix goes back to `AGENTEYE_*`. Re-check each one with `--help` rather
than assuming a rename was the only difference.

**Probe with `--help`; never infer a surface from prose.** That habit used to be needed
because the docs ran ahead of the shipped artifact — `usage`, the `--api-key` global, and
`audits context-show/-set/-refresh` plus `audits create --text/--text-file/--url` were all
documented while `agenteye` 0.1.13 exited 2 on them. All four ship in `fp` 0.0.1b1 (verified
against `fp usage --help`, `fp audits --help`, and `fp --api-key` parsing as a global). The
gap closed; the habit still pays, in the other direction — `fp --help` lists 23 commands, and
the ENFORCE group is newer than most writing about this product.

## Two auth modes, and they never mix

| | Session | API key |
|---|---|---|
| Credential | `ae_session` cookie, from `login`'s emailed one-time code | `Authorization: Bearer <key>` |
| Routes hit | the dashboard's `/api/*` | the server's versioned `/v1/*` |
| Stored | `~/.failproofai/fpcli/cli-auth.json`, mode 0600 | **never written to disk** |
| Selected by | `--token` / `FP_TOKEN` / saved session | `--api-key` / `FP_API_KEY` |

The session file moved **inside** the local home (`config.py`, grep `FPCLI_SUBDIR`) — there is
no longer a separate cloud config tree. `~/.agenteye` stayed put because it is the collector's
event spool, not a preference. Two pre-move paths are still read once and adopted, never
written: `$FP_HOME/cli.json` (checked first — an operator who relocated the config is the one
an unexplained logout hits hardest) and `~/.fp/cli.json`. The old file is **copied**, not
moved, so a downgrade still finds its session.

The CLI is written against `/api/*` at ~70 call sites and **rewrites every path to `/v1/*` at
four request chokepoints** when a key is in play (`client.py`, grep `_v1_path`) — mechanical
per first path segment (grep `_V1_MECHANICAL_FAMILIES`), with one exact rename:
`/api/evaluations/score-keys` → `/v1/evaluations/score_keys`. Two families have no `/v1`
equivalent (grep `_V1_NO_EQUIVALENT`): `auth` takes a browser session, and `agent` is
implemented by the dashboard. That is *why* those commands refuse.

**Commands that refuse before any HTTP call** (`_context.py`, grep `deny_in_key_mode`; exit
2): `login`, `logout`, `orgs list|current|perms|switch`, `keys update`, the whole `agent`
group, and **every `policies`, `fleet` and `guardrails` subcommand except `policies test`**.
`keys update` is unreachable *by construction* — it needs `keys:update`, which no key can
hold. The enforce group is the consequential one; see *The ENFORCE group* below.

`whoami` is the one command that still works under a key, reporting an honest different
shape — `{"logged_in": false, "auth_mode": "api_key", "active_org": "<slug|null>"}`, **exit
0**. A `null` `active_org` is the warning sign, see *Orgs*.

**`whoami` never signals with its exit code.** Signed out it prints
`{"logged_in": false, "auth_mode": "none"}` and still **exits 0** — confirmed live. Branch on
the `.logged_in` / `.auth_mode` *field*, never on the exit status; any script reading "exit 4
means not signed in" off this command is testing something that does not happen:

```bash
fp --json whoami | jq -e '.logged_in' >/dev/null || echo "not signed in"
```

Precedence, highest first (`_context.py`, grep `resolve_auth`): `--api-key` **and** `--token`
together is a usage error, never guessed; then `--api-key`, `--token`, `FP_API_KEY` (a key env
var beats a token env var), `FP_TOKEN`, the saved session, then exit 4. `--api-key ""` — an
unset CI variable spelled out — keeps key mode with an empty credential and fails rather than
silently acting as whoever is logged in there. `FP_API_KEY` is deliberately neither
`AGENTEYE_KEY` (the collector's `events:add` ingest key — every read would 403 for no visible
reason) nor `AGENTEYE_API_KEY` (the dashboard's own admin key). Three names, three
credentials; the collision the naming avoids is the one that costs an afternoon.

## The ten global options

They MUST precede the command. `fp --json events` ✓, `fp events --json` ✗ — a usage error,
not a slightly-off invocation (`app.py`, grep `_GLOBAL_FLAGS`). A command's *own* options come
after it, so a full invocation reads global → command → subcommand → command options:
`fp --json keys create ci-bot --permission-set read-only`.

| Flag | Env | Note |
|---|---|---|
| `--json` | `FP_JSON` | also **skips every confirmation prompt** |
| `--base-url <url>` | `FP_DASHBOARD_URL` | default `https://app.befailproof.ai`; saved at login |
| `--org <slug>` | `FP_ORG` | per-invocation tenant |
| `--token <tok>` | `FP_TOKEN` | session override |
| `--api-key <key>` | `FP_API_KEY` | automation; never saved |
| `--timeout <secs>` | — | default 30; `<= 0` is a usage error |
| `--quiet`, `-q` | — | suppress stderr status |
| `--no-color` | `NO_COLOR` | — |
| `--insecure` / `--secure` | `FP_INSECURE` | disables TLS verification; **persisted at login** |
| `--help`, `-h` (`--version`) | — | — |

Flags > env > saved config. `FP_HOME` relocates the config directory and is used verbatim;
`FAILPROOFAI_HOME` names the home *root* and gets `fpcli/` appended. `AGENTEYE_HOME` does
nothing here — it is the daemon's spool, and `fp` does not read it.

**`--json` is not just a formatter.** Destructive confirmations auto-skip on `--json`, on
`--yes`, *and* whenever stdin is not a TTY (`commands/_write.py`, grep `def confirm`) — so the
docs' claim that deleting, revoking and resolving "prompt by default" is false for every
agent-driven invocation. Confirm destructive intent with the human yourself.

Exit codes are a contract (`errors.py`, grep `exit_code`): 1 generic/API · 2 usage, bad
permission token, or key-mode-unsupported · 3 network · 4 not logged in · 5 authenticated but
missing permission · 6 not found, including an unknown settings key.

## The ENFORCE group: the cloud writes policy now, not just reads telemetry

`fp --help` groups its 23 commands, and one group is new enough that most writing about this
product predates it. **Deployment is CLI-drivable.** Any text — including older parts of these
skills — saying that assignment, promotion or rollback is "not exposed by the cloud CLI" or is
"dashboard work" is wrong, and worse than wrong: it tells an agent to stop looking for a
command that ships.

| Command | Subcommands | What it is |
|---|---|---|
| `policies` | `list show publish enable disable delete test compose` | the versioned source of a cloud-managed policy |
| `fleet` | `list show deploy diff history rename rollback` | which version is running on which machine, and in which effect |
| `guardrails` | `summary timeline` | what enforcement actually blocked, after the fact |

The lifecycle is compose → test → publish → `fleet deploy` → guardrails, and every step of it
has traps worth more than a table row: **publishing deploys nothing**, a bare `--add` on a new
policy lands it in `enforce`, `disable` stops enforcement while `delete` does not, and
`policies compose` needs `policies:write` rather than the `agent:use` its name suggests. All
of that belongs to **`failproofai-policy-deploy`**; go there before you run any of it. What
belongs *here* is the one constraint that is an auth fact:

**Every `policies`, `fleet` and `guardrails` subcommand except `policies test` exits 2 under
an API key** (grep `deny_in_key_mode` in `policies_cmds.py`, `fleet_cmds.py`,
`guardrails_cmds.py`). These are session-only commands, and `fp --help` says so in its own CI
line. **CI cannot deploy policy.** A pipeline that mints a scoped key and expects to promote a
version from `observe` to `enforce` fails at the first call, before any request, with a usage
error rather than a permission error — so widening the key never helps. Rollout is a signed-in
human action; what CI *can* do is the one command that never authenticates at all:

```bash
fp --json policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",…}]}
```

That runs locally — no server, no fleet, no auth, `node` on `PATH` its only requirement — and
resolves `import { deny } from "failproofai"` with nothing installed in the working directory,
because the CLI shims the module itself. The `--json` body is `{ok, decision, policies, syntax,
expected, met}`, and `decision` is the **strictest** decision any registered policy returned,
not the first. Adding `--expect deny` turns it into a test-suite assertion: exit 0 when it
matches, **exit 1** when it does not.

State its limit honestly: it proves the policy parses, registers and decides for the input you
gave it. It cannot prove the daemon feeds it the same context.

## Permissions

Grants are a **flat list of `resource:action` tokens** — no hierarchy on disk. The catalog
is 35 tokens in the server's declared order (`permissions.py`, grep `ALL_PERMISSIONS`).

**Dotted expansion is an input form only**: `events:read.add` → `events:read` +
`events:add` (grep `parse_permission_tokens`). Tokens split on whitespace *or* commas
within one value and repeated flags compose, so `--add a,b`, `--add a --add b` and `--add
"a b"` are equivalent. **`--add a b` is not** — Click takes `b` as a positional.

### How each preset is derived

| Preset | Derivation | Consequence |
|---|---|---|
| `read-only` | `[p for p in ALL_PERMISSIONS if p.endswith(":read")]` — computed, not hand-listed | contains no `events:add` and no `policies:pull`, so **a read-only key cannot ingest and cannot pull policy**. It also cannot run a saved query, trigger an eval, use the assistant, or resolve an issue |
| `standard` | read-only + `evaluations:trigger`, `queries:run`, `issues:create`, `issues:close`, `agent:use` | must match the server's `BUILTIN_PERMISSION_SETS["standard"]`; `issues:close` is there because the retired `incidents:ack` it replaced already granted resolve |
| `admin` | `ALL_PERMISSIONS` minus `orgs:admin` | on a **key** it is reduced further — below |
| `clear` | `[]` | a real fourth preset (grep `PRESETS`) the admin docs never mention |

The three builtin names are immutable — `PUT /v1/permission-sets/{name}` refuses with 409.
Orgs may define custom sets, addressable by the same `--permission-set` flag.

### `key_assignable`: what an API key may never hold

`KEY_NON_ASSIGNABLE = {"orgs:admin", "keys:update"}` (grep `KEY_NON_ASSIGNABLE`). Same
intent, two different outcomes, deliberately:

- **Seeding from a set silently strips them** (grep `key_assignable_only`), mirroring the
  dashboard. An "admin" *key* is strictly weaker than an "admin" *human*, with no warning.
- **An explicit `--add keys:update` is a hard client-side error** — exit 2, before any
  request (grep `parse_key_permission_tokens`), a clean message instead of a server 422.

`PATCH /v1/keys/{id}` returns 403 to any bearer token permanently, by design: automation
can never widen its own key. `orgs:admin` is instance-level, absent from `/v1` entirely,
and is granted out of band with `agenteye-orgctl`.

### Stored ≠ effective

The server **widens** a grant at authentication time (`expand_implied`) and authorizes
against the widened set — `alerts:read` also carries `issues:read`. The dashboard key page
and the CLI both display the **stored** list, so both understate what a credential can do
(`cloud-introspect.ts` in the local CLI, grep `INTROSPECT_PATH`).
`GET /v1/auth/introspect` is the only place the effective set is visible; build any local
permission check against that response, never the displayed list. It needs no permission of
its own — any key may describe itself, and only itself. **Do not poll it**: `/v1` has no rate
limiting, failed auth is not negatively cached, and revocation/expiry are cached server-side,
so a "valid" answer can be up to a minute stale.

### Retired aliases still parse, and expand wider than they read

`incidents:read` → `issues:read`; `incidents:write` → `issues:create`; **`incidents:ack` and
`alerts:ack` each expand to all three of `issues:read`, `issues:create`, `issues:close`**
(grep `RETIRED_PERMISSION_ALIASES`). The server parses the old spellings forever so pre-rename
keys keep working. A script still passing `--add alerts:ack` grants issue-closing authority.

`policies:read`, `policies:write`, `policies:pull` and `agent:use` are in the admin catalog
but appear **nowhere in the `/v1` OpenAPI spec** — enforcement lives on `/enforcement/v1/*`,
deliberately off the public surface. `usage:read` *is* in the spec.

## Orgs are the tenant boundary

An organization isolates sessions, evaluations, audits, issues, alerts, queries, dashboards,
users and keys. Membership is per org; the underlying user **account** is global — which is
why `users disable` is offboarding from every org, not removal from one team. (It is
reversible with `users enable` and needs `users:delete`, not `users:create`. **Key disable is
not reversible at all** — mint a replacement.)

`--org <slug>` scopes one invocation; `orgs switch` rewrites persistent saved state and
silently retargets every later command. In **key mode only an explicit `--org` is ever sent**
(`_context.py`, grep `_org_header`) — the saved org belongs to whichever human logged in on
that machine, not to whichever org a CI key was minted for.

**The instance-scoped key trap.** A key not bound to one org selects a tenant per request
with `X-AgentEye-Org: <slug>`. Omitting it does not error — it resolves to the *default*
organization, **silently**, so reads answer with some org's data and writes can land in the
wrong tenant; `whoami` printing `"active_org": null` is the pre-flight for exactly this.
Worse for client generators, `X-AgentEye-Org` appears only in `info.description` prose and
is **not declared as a parameter on any operation**.

## Keys and the one-time secret

The secret is revealed exactly once, at create or regenerate — generated client-side
(`keys_cmds.py`, grep `token_hex`), stored server-side only as a hash, never read back. Three
edges:

- **Output routing is sensitivity-blind.** Interactive gets a decorated box; **piped or
  redirected, the bare secret goes to stdout**, and `--json` puts it under `key`.
- **Every name-referenced key command also needs `keys:read`** — the CLI resolves the name by
  listing all keys first (grep `list_keys`; the uniqueness pre-check runs before create), so
  a `keys:create`-only credential exits 5 having created nothing.
- **`keys update --permission-set` reseeds, it does not add.** At the API layer it is
  blunter: `PATCH /v1/keys/{id}` takes the *complete* new list, so a hand-written delta
  silently drops everything omitted.

A raw `POST /v1/keys` that omits `permissions` **defaults to `["events:add"]`** — a silently
ingest-capable key, not an error. Resolving a **custom** `--permission-set` name needs
`users:read`; if that read is forbidden the CLI swallows the error, falls back to the
builtins, then rejects your set name as "unknown permission set" (grep
`_expand_key_set_or_exit`) — a permissions problem wearing a typo's error message.

## The HTTP API

`/v1` on the **dashboard origin** — `https://app.befailproof.ai/v1` hosted. 77 paths / 108
operations, bearer auth with a scoped key, `info.version` `0.0.1-beta.77` — pre-1.0, so treat
endpoint and field stability accordingly.

Branch on the status, do not scrape the message: 401 missing/invalid auth · 403 valid
identity **without** the permission (body names `required_permission`) · 404 missing **or
organization-inaccessible**, so a cross-tenant read reads as "not found" · 409 state
conflict (editing a *disabled* member is 409, never 403 — more permission will never help)
· 422 invalid field or permission value. Use `Content-Type: application/json` for writes.

**Ingest is `POST /v1/events`, newline-delimited JSON — one object per line, not a JSON
array. Malformed lines are SKIPPED, not rejected: the status is 200 even when every line was
bad.** Read the `accepted` / `skipped` counts or you cannot tell an ingest from a no-op. A 5xx
means "retry the whole batch"; duplicates are collapsed server-side, so retrying is safe.

`GET /v1/sessions/{id}/export` returns session metadata plus every event with its full payload
in one response — **no pagination and no size cap**, so a long session can exhaust memory or a
timeout. Those are the exact bytes an evaluator receives, so an export replays unchanged. No
CLI equivalent.

Two permission surprises: `GET /v1/sessions` requires **`evaluations:read`, not
`events:read`** (the row it returns is the session's evaluation summary), and
`GET /v1/access-granters` requires none at all — the caller who needs it is by definition the
one who lacks access; it names up to 50 members holding `users:update`.

Some response bodies are **intentionally untyped** because the server builds them as dynamic
JSON — inspect a real response before generating a typed client. Policy-enforcement deployment
is deliberately absent from `/v1` — it lives on `/enforcement/v1/*`, off the public surface, so
there is no bearer-auth deploy endpoint to find. **That is a statement about `/v1`, not about
the product**: `fp fleet deploy` ships and drives a rollout end to end over the dashboard's
`/api/*` with a signed-in session. And large parts of `/v1`
have **no CLI equivalent**, invisible to anyone mapping the product from `--help`: dashboards
and tiles, agent contracts (`/audits/contracts`), permission sets, `/evaluation-jobs`,
`/sessions/{id}/re-evaluate`, `/usage/windows`, and ingest itself.

## Self-hosting (Enterprise Kubernetes)

Customer-managed K8s 1.27+, private `ghcr.io/agenteye-enterprise` images, Kustomize overlays
for EKS **or** GKE — never combined; GKE brings its own DNS-01, GCS and autoscaling. Namespace
is `agenteye` in every example. Full sequence: `docs/reference/self-hosting.mdx`.

**Two DNS names, one for the dashboard and one for ingest.** `/v1` is documented as living on
the dashboard origin, but bootstrap pushes its test session "through the public ingest
endpoint" and the readiness checklist requires the two to resolve to different ingress paths
(`INGEST_DOMAIN` / `DASHBOARD_DOMAIN`). Do not assume ingest and API share a host.

| Service | Requirement |
|---|---|
| ClickHouse | **Required — the server refuses to start without its canonical event store.** Fatal, not degraded |
| PostgreSQL | required for users, orgs, saved objects, control-plane state |
| Redis | optional — degrades to database-backed behavior |
| SMTP | optional in development, required for production OTP and notifications |
| Evaluator | optional — automatic evaluation **stays disabled** without `EVALUATOR_ENDPOINT` |
| Assistant / audit LLM | optional — those features **remain inert** until an LLM connection is configured |

The last two rows are the silent ones: an instance with no evaluator and no LLM connection
looks healthy while producing no evals and no audit findings.

SMTP breaks startup rather than degrading. `SMTP_HOST` alone is not enough — username,
password and sender are required **as a group** or the server refuses to start. Only STARTTLS
(normally 587) is supported; implicit SMTPS on 465 does not work whatever `SMTP_TLS` says.
With SMTP absent, development deployments **log OTP codes to server output** — a real
credential path, and `kubectl logs deploy/server` is how anyone with log access signs in.

Before creating a second organization, configure a strong, **stable** organization ClickHouse
derivation secret, identical across all replicas; rotating it later without a coordinated
migration can orphan organization-specific ClickHouse users. Keep the instance-admin listener
internal — the operator console is built for `kubectl port-forward`, not public ingress.

`agenteye-orgctl` ships inside the server image, talks straight to PostgreSQL and ClickHouse,
and works when the public server or operator console is unhealthy (`kubectl -n agenteye exec
deploy/server -- agenteye-orgctl org list`). Soft-delete before purge: `org purge` is
irreversible and refuses unless the org is already deleted. **Protected** members and
config-seeded keys refuse ordinary admin operations until an operator unprotects them — an
"audit and revoke everything" sweep hits both and fails.

Audit capacity fails quietly too: when every audit-agent slot is busy a run waits up to a
quarter of its cadence (capped at six hours), then **completes with no findings** while
sending a failure email. A clean audit is not evidence of a clean system — and that failure
email needs an enabled email channel plus SMTP, falling back to
`alerts.email_default_recipients`. Miss both and the capacity failure is invisible.

For anything you would type against a live deployment — filters, pagination limits,
`--aggregate`, the saved-SQL runner, alerts, issue triage — hand off to **`fp-cloud-cli`**.
For getting a policy onto machines — publish, deploy in observe, promote to enforce, prove it
fired, roll back — hand off to **`failproofai-policy-deploy`**.
