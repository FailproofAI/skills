# Failproof AI Cloud: the CLI, keys and orgs, the HTTP API, self-hosting

The read-and-administer control plane over telemetry your agents already emitted. This file
is the **concepts and the auth model**; driving a live deployment — flags, filters,
pagination, triage — belongs to `agenteye-cli`. Grep anchors point into the cloud CLI's
Python package `agenteye_cli/` — the installed build under `~/.local/share/uv/tools/agenteye/lib/python*/`, except the key-mode anchors (`resolve_auth`, `deny_in_key_mode`, `_org_header`, `_v1_path`, `_V1_MECHANICAL_FAMILIES`, `_V1_NO_EQUIVALENT`), which 0.1.13 does not ship — grep those in the repo's `cli/agenteye_cli/`.

## The product is Failproof AI Cloud; it was called AgentEye

Use the new name in anything you write. The old one survives wherever a rename is expensive
— every env var is still `AGENTEYE_*`, the OpenAPI title is still "AgentEye API", the tenant
header is still `X-AgentEye-Org`, the self-hosted images are still `ghcr.io/agenteye-enterprise`.
Those are literals: **never "modernise" one in a command or a config**, or it stops working.

## Resolve the binary before writing a single command

The CLI is renaming with the product. Docs document `fp`, installed with
`uv tool install fp-cli`; what is actually on a machine today is usually `agenteye`. The
docs are ahead of the shipped artifact rather than wrong, so expect this to flip. Resolve it
once and use whatever answers:

```bash
command -v fp agenteye
```

Examples in this skill are written as `agenteye`, because that is the binary that exists
today. When `fp` is what resolved, substitute it — the subcommands, flags and behaviour are
identical.

**The docs also describe a newer CLI than the one installed.** Three documented surfaces
are absent from `agenteye` 0.1.13 and exit 2 there — they exist in current source, so it
is a version gap, not a doc error: the `usage` command (and `usage:read`), the `--api-key`
global, and `audits context-show/-set/-refresh` plus `audits create
--text/--text-file/--url`. Probe with `--help`; never infer presence from the docs.

## Two auth modes, and they never mix

| | Session | API key |
|---|---|---|
| Credential | `ae_session` cookie, from `login`'s emailed one-time code | `Authorization: Bearer <key>` |
| Routes hit | the dashboard's `/api/*` | the server's versioned `/v1/*` |
| Stored | `~/.agenteye/cli.json`, mode 0600 | **never written to disk** |
| Selected by | `--token` / `AGENTEYE_CLI_TOKEN` / saved session | `--api-key` / `AGENTEYE_CLI_API_KEY` |

The CLI is written against `/api/*` at ~70 call sites and **rewrites every path to `/v1/*` at
four request chokepoints** when a key is in play (`client.py`, grep `_v1_path`) — mechanical
per first path segment (grep `_V1_MECHANICAL_FAMILIES`), with one exact rename:
`/api/evaluations/score-keys` → `/v1/evaluations/score_keys`. Two families have no `/v1`
equivalent (grep `_V1_NO_EQUIVALENT`): `auth` takes a browser session, and `agent` is
implemented by the dashboard. That is *why* those commands refuse.

**Commands that refuse before any HTTP call** (`_context.py`, grep `deny_in_key_mode`; exit
2): `login`, `logout`, `orgs list|current|perms|switch`, `keys update`, the whole `agent`
group. `keys update` is unreachable *by construction* — it needs `keys:update`, which no key
can hold.

`whoami` is the one command that still works under a key, reporting an honest different
shape — `{"logged_in": false, "auth_mode": "api_key", "active_org": "<slug|null>"}`, **exit
0**. It never exits 4; a `null` `active_org` is the warning sign, see *Orgs*.

Precedence, highest first (`_context.py`, grep `resolve_auth`): `--api-key` **and** `--token`
together is a usage error, never guessed; then `--api-key`, `--token`, `AGENTEYE_CLI_API_KEY`
(a key env var beats a token env var), `AGENTEYE_CLI_TOKEN`, the saved session, then exit 4.
`--api-key ""` — an unset CI variable spelled out — keeps key mode with an empty credential
and fails rather than silently acting as whoever is logged in there. That variable is
deliberately neither `AGENTEYE_KEY` (the collector's `events:add` ingest key — every read
would 403 for no visible reason) nor `AGENTEYE_API_KEY` (the dashboard's own admin key).

## The ten global options

They MUST precede the command. `agenteye --json events` ✓, `agenteye events --json` ✗ — a
usage error, not a slightly-off invocation (`app.py`, grep `_GLOBAL_FLAGS`).

| Flag | Env | Note |
|---|---|---|
| `--json` | `AGENTEYE_CLI_JSON` | also **skips every confirmation prompt** |
| `--base-url <url>` | `AGENTEYE_DASHBOARD_URL` | default `https://app.befailproof.ai`; saved at login |
| `--org <slug>` | `AGENTEYE_ORG` | per-invocation tenant |
| `--token <tok>` | `AGENTEYE_CLI_TOKEN` | session override |
| `--api-key <key>` | `AGENTEYE_CLI_API_KEY` | automation; never saved |
| `--timeout <secs>` | — | default 30; `<= 0` is a usage error |
| `--quiet`, `-q` | — | suppress stderr status |
| `--no-color` | `NO_COLOR` | — |
| `--insecure` / `--secure` | `AGENTEYE_INSECURE` | disables TLS verification; **persisted at login** |
| `--help`, `-h` (`--version`) | — | — |

Flags > env > saved config; `AGENTEYE_HOME` relocates the config directory.

**`--json` is not just a formatter.** Destructive confirmations auto-skip on `--json`, on
`--yes`, *and* whenever stdin is not a TTY (`commands/_write.py`, grep `def confirm`) — so the
docs' claim that deleting, revoking and resolving "prompt by default" is false for every
agent-driven invocation. Confirm destructive intent with the human yourself.

Exit codes are a contract (`errors.py`, grep `exit_code`): 1 generic/API · 2 usage, bad
permission token, or key-mode-unsupported · 3 network · 4 not logged in · 5 authenticated but
missing permission · 6 not found, including an unknown settings key.

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
is deliberately absent from `/v1`; do not hunt for a deploy endpoint. And large parts of `/v1`
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
`--aggregate`, the saved-SQL runner, alerts, issue triage — hand off to **`agenteye-cli`**.
