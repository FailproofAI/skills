# AgentEye CLI — full command reference

Flag-level detail for every group. Read the section you need; the SKILL.md body
already has the workflow and the contract. Remember: **globals before the
command**, **`--json` to parse**, **branch on exit codes**.

## Contents
- [Global options](#global-options)
- [Shared input conventions](#shared-input-conventions)
- [Identity: login / logout / whoami / orgs](#identity)
- [Observe: events / sessions / evals / errors / list](#observe)
- [keys](#keys)
- [users](#users)
- [settings](#settings)
- [alerts](#alerts)
- [incidents](#incidents)
- [query](#query)
- [agent](#agent)

## Global options
Set on the CLI, **before** the subcommand. Precedence: flag > env var > config file (`~/.agenteye/cli.json`, mode 0600).

| Flag | Env var | Meaning |
|---|---|---|
| `--base-url <url>` | `AGENTEYE_DASHBOARD_URL` | Dashboard URL. **Required** (no default); must start with `http://`/`https://`. |
| `--org <slug>` | `AGENTEYE_ORG` | Active org for this command (multi-tenant override). |
| `--token <t>` | `AGENTEYE_CLI_TOKEN` | Session token (normally from config after `login`). |
| `--json` | `AGENTEYE_CLI_JSON` | Machine-readable JSON to stdout, nothing else. |
| `--insecure` / `--secure` | `AGENTEYE_INSECURE` | Skip / require TLS verification (for self-signed dev certs; saved at login). |
| `--version` | | Print version (also `agenteye version`). |

Config dir honours `AGENTEYE_HOME`. Telemetry is on by default; disable with `AGENTEYE_ANALYTICS_DISABLED=1` or `DO_NOT_TRACK=1`.

## Shared input conventions
- **`--json`** on any command → pure JSON on stdout (no Rich chrome). Mutations under `--json` auto-skip their confirm prompt.
- **`--yes` / `-y`** explicitly skips a confirm prompt. (Confirms are also auto-skipped on a non-TTY — i.e. whenever Claude runs it — so always confirm with the user yourself first.)
- **`--all` + `--limit`**: `--limit` (`-n`) defaults to **50**; `--all` auto-paginates (client chunks of 200) **up to `--limit`**, NOT without bound. So a bare `--all` still stops at 50 rows. For a full sweep on `events/sessions/evals/errors`, pass a high explicit cap: **`--all --limit 1000`** (or higher). To just get window totals, use `--aggregate` (covers the whole window regardless of row caps).
- **`--fields a,b,c`** projects only those keys (where supported: sessions/evals, keys, query list).
- **`--since <window>`** relative window: `24h`, `7d`, `30d`, etc. `--from`/`--to` take ISO timestamps **with `T` and a timezone** (e.g. `2026-06-01T00:00:00Z`) — space-separated or tz-less is a usage error (exit 2).
- **`--file payload.json`** (or `--file -` for stdin) supplies a full JSON request body on `alerts`, `settings set`, and `users create/update` — mutually exclusive with the discrete flags. Saved-query SQL uses `--sql @file.sql`.
- **Multi-value filters** are CSV → `IN (...)` (union within a filter, AND across filters): `--event-type tool_use,tool_result`. `--search` is repeated/OR (matches ANY term), payload-only.

## Identity

### login / logout / whoami
- `agenteye login [--email you@x.com] [--org <slug>]` — emails a one-time code; on a real TTY it's a single interactive box, else a plain prompt. Saves the session to `~/.agenteye/cli.json`. **You cannot complete this for the user** (it needs the emailed code). `--org` picks the tenant at login.
- `agenteye logout` — clears the saved session.
- `agenteye whoami` — active org + your permissions. Run this first; exit 4 = login needed.

### orgs
- `orgs list` — your orgs + role in each (active marked).
- `orgs switch [<slug>]` — change the saved active org; omit slug to pick from a list (TTY only). **State change** (mild) — affects later commands.
- `orgs current` — identity card for the active org.
- `orgs perms` — your permissions in the active org, grouped by resource.

## Observe
All read-only; never need confirmation.

### events
`agenteye events [filters] [--all]` — raw event log, newest first.
Filters: `--session-id <id>` `--agent-id <id>` `--event-type <csv>` `--env <csv>` `--since <window>` / `--from`/`--to` `--search <term>` (repeatable, payload OR-match).

### sessions
`agenteye sessions [filters] [--all]` — agent runs: time/env/agent/session/status (no scores). Filters: `--session-id --agent-id --env --status <error|...> --since`. JSON rows still carry `scores`.

### evals
`agenteye evals [filters] [--score key:min..max] [--scores-full] [--all]` — evaluation results + scores.
`agenteye evals --aggregate [--since 7d]` — rollup: `{total, status_counts, score_stats, timeline}` (status mix + per-metric score stats). `--score helpfulness:..0.5` = max 0.5; `helpfulness:0.8..` = min 0.8; `helpfulness:0.5..0.9` = range.

### errors
`agenteye errors [filters] [--all]` — errored events (time/event/env/agent/session/summary). Filters incl. `--error-type <csv>`.
`agenteye errors --aggregate [--since 7d]` — `{total, sessions, agents, last_ts, bins}`.

### list
`agenteye list <kind>` — discover valid filter values. Kinds: `envs agents event_types score_filters models hooks triggers tools error_types`. JSON `{kind, values}`. Run this before filtering by a value you're unsure of.

## keys
API keys; the secret is shown **once** on create/regenerate (capture it then). Referenced by **name**.
- `keys list [--show-id] [--fields ...]` — active keys first, then revoked.
- `keys show <name>`
- `keys create <name> [--permission-set <set>] [--add <tok>] [--remove <tok>]` — permissions work **exactly like `users create`**: optionally seed from a role with `--permission-set` (`read-only`/`standard`/`admin` or a custom org set), then fine-tune with `--add`/`--remove`. Effective grants = `(set ∪ added) − removed`. For a narrowly-scoped key (the common case) just use `--add` with no set: `keys create ci-pipeline --add events:add`. Secret → stdout when piped. (There is **no** positional `PERMISSIONS` arg and **no** `-p` flag — those forms error.)
- `keys update <name> [--permission-set <set>] [--add <tok>] [--remove <tok>]` — incremental on the key's CURRENT grants (merges --add/--remove), unless `--permission-set` is given (which reseeds, then applies --add/--remove). `--yes`/`-y` to skip confirm.
- `keys disable <name>` — revoke.
- `keys regenerate <name>` — rotate secret (old one dies).

Permission token format (for `--add`/`--remove`): `slug:action` flat, or `slug:action.action` to expand several actions on one resource (e.g. `events:read.add` → `events:read`, `events:add`). Several via comma, repeated flag, or a quoted group: `--add events:read,keys:read` · `--add a --add b` · `--add "a b"`. Human-only perms (`keys:update`) can't be granted to a key. Unknown/malformed → exit 2.

## users
Referenced by **email** (UUID id also accepted).
- `users list [--show-id] [--active-only]` — `[lock] email · access · perms · joined · status`.
- `users show <email>` — identity + all grants.
- `users create [EMAIL] [--permission-set <set>] [--add tok] [--remove tok]` — `--permission-set` one of the builtin sets (`admin`/`standard`/`read-only`) or a custom set name (client-validated; unknown → exit 2). `--add`/`--remove` take compact permission tokens.
- `users update <email>` — assign a set, or incrementally `--add`/`--remove`. Predicts the resulting grants and confirms.
- `users disable <email>` / `users enable <email>` — disable has protected/self guards.

**Multi-token `--add`:** Click options aren't variadic — `--add a b` breaks. Use `--add a,b` (comma), `--add a --add b` (repeat), or `--add "a b"` (quoted).

## settings
A fixed registry — you read/inspect/change existing keys, you cannot create new ones.
- `settings list` — `key · value · type · updated` (secrets masked).
- `settings schema` — `key · type · accepts · description` (what each key accepts).
- `settings set <key> (--value V | --json-value JSON | --file f)` — exactly one value source. Unknown key → exit 6. No-op if unchanged. Server validation errors surface as `✗ <message>` (e.g. range bounds). Some keys are sensitive (signing secrets, sign-in allowlist) — confirm carefully.

## incidents
Alert incidents; referenced by id (short ids accepted, `--show-id` shows them).
- `incidents list [--state firing|acknowledged|resolved] [--severity ...] [--alert-id <id>] [--limit N]`
- `incidents count`
- `incidents show <id>` — identity + comments + subscribers + **activity log** (read this before acting).
- `incidents ack <id>` · `incidents assign <id> <member>` (member must be an operator) · `incidents resolve <id>` (calm confirm) · `incidents open --alert-id <id> [--severity ...]`
- `incidents comment-add <id> <text>` · `comment-list <id>` · `comment-delete <id> <comment-id>`
- `incidents subscribe <id>` · `unsubscribe <id>` · `subscribers <id>`

Malformed (non-UUID) id → calm `✗ no incident …` exit 6. Assign to a non-operator → clean 422 message.

## query
Saved ClickHouse SQL + ad-hoc runner. Saved queries referenced by **name**.
- `query list [--fields ...] [--show-id]` — `name · description · created by · created`.
- `query show <name>` — metadata + syntax-highlighted SQL.
- `query create <name> --sql "…"|@file.sql [--description ...] [--param k=v]` — name-collision pre-checked (exit 2).
- `query update <name> [--name ...] [--sql ...] [--description ...] [--param ...]` — partial update (≥1 field).
- `query delete <name>` — amber preview + confirm.
- `query run <name> | --sql "…" [--limit N] [--all] [--param k=v]` — adaptive render: scalar / record / table. JSON = full QueryResult (never capped). Exec/permission errors → clean `✗ query failed` + exit code.
- `query schema [TABLE]` — column layout; JSON `{schema, columns:[{table,column,type,nullable}]}`.

## agent
Built-in assistant. Chats referenced by a **short chat-id** (first 8 hex; prefix-resolved).
- `agent health` · `agent models` (available models for `--model`, default marked).
- `agent chats` — `chat-id · title · messages · updated`.
- `agent ask "MESSAGE" [--chat <short-id>] [--model <m>]` — starts a new chat (prints its short id) or continues `--chat`. On a TTY the answer renders as Markdown; piped/non-TTY prints the raw answer to stdout.
- `agent show <short-id>` — transcript. `agent rename <short-id> --title "…"` · `agent delete <short-id>`.
- Ambiguous prefix → exit 2; unknown chat → exit 6.
