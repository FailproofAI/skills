---
name: agenteye-cli
description: |-
  The way to answer "how are my production AI agents doing?" and to run the team's agent-observability deployment — reach for it even on casual phrasing that names no tool.

  Trigger when the user wants to:
  • inspect agent telemetry — did agents error/fail/go flaky; sessions, events, latency, token usage, slowest models; eval/quality scores and whether quality dropped;
  • operate the deployment — ack/assign/resolve firing alerts and incidents with notes; see who has access and change roles (e.g. make someone read-only); create or scope API keys (e.g. a CI key that only pushes events); change settings; run saved or ad-hoc ClickHouse queries.

  Served by the `agenteye` CLI against an AgentEye platform.

  NOT for writing or designing an evaluator service / scoring logic (that's `agenteye-evaluator`), adding SDK/instrumentation to your app (that's `agenteye-python-sdk`), debugging the collector/daemon, or unrelated dev work (why a build/CI run failed, rotating non-AgentEye secrets).
---

# AgentEye CLI

`agenteye` is a command-line client for an AgentEye deployment. It talks only to
the dashboard `/api/*` over an authenticated session — you never hit the backend
directly. Every command takes `--json`, so it's built to be driven by an agent.

## 1. Find how to invoke it

Resolve this once, then reuse it for every call:

1. If `agenteye` is on `PATH` (`command -v agenteye`) → use **`agenteye`** (it's
   installed via pipx / uv tool / pip). This is the normal case.
2. Else, if you're in (or under) a repo with a `cli/` directory containing the
   `agenteye` package → run it from there with **`uv run agenteye`** (a local dev
   build). The first run after a code change prints `Building…`/`Installed…` on
   stderr — that's `uv`, not CLI output; ignore it.
3. Else the CLI isn't available here → tell the user to install it
   (`pipx install agenteye` or `uv tool install agenteye`) and stop. Don't try to
   reach the dashboard another way.

Don't go spelunking in the CLI source tree for flags — if you're unsure of one,
run `agenteye <group> <cmd> --help`. The source is not the documented contract
and reading it wastes effort.

Throughout this skill, `agenteye` means "whichever form you resolved."

## 2. The contract (the CLI enforces it, work with it, don't fight it)

- **Global options go BEFORE the command:** `agenteye --json events`, never
  `agenteye events --json`. Globals are `--base-url`, `--org`, `--token`,
  `--json`, `--insecure`/`--secure`. After the command they're a usage error.
- **Default to `--json` and parse it.** It prints clean JSON to stdout and
  nothing else. The plain output is a boxed Rich UI meant for human eyes — it
  burns context with box-drawing characters and is awkward to parse. Use the
  rendered output only when the user explicitly wants to *look* at something.
- **Data → stdout, status/errors/prompts → stderr.** So a `--json` stdout
  capture is pure JSON even when a status line is shown.
- **Branch on exit codes — don't scrape error text:**

  | code | meaning | what to do |
  |---|---|---|
  | 0 | ok | parse stdout |
  | 1 | unexpected / server error | report it to the user |
  | 2 | usage error (bad flags/args) | fix the command and retry |
  | 3 | can't reach the dashboard | check base-url / connectivity |
  | 4 | not signed in / session expired | user must run `agenteye login` |
  | 5 | authenticated but missing permission | message names the exact permission |
  | 6 | resource not found | the named resource doesn't exist |

## 3. First call: confirm you're connected

Before real work, run `agenteye --json whoami` and react to the exit code:

- **exit 4** → not signed in. Tell the user to run `agenteye login` (it emails a
  one-time code and prompts interactively — you can't complete it for them, and
  don't fabricate a token).
- **base-url error / exit 2 or 3 about base-url** → the deployment URL isn't
  set. Ask the user for their dashboard URL and pass `--base-url <url>` (or they
  set `AGENTEYE_DASHBOARD_URL`). For a local dev stack it's usually
  `http://localhost:3000`.
- **exit 0** → `whoami` returns the active org slug and your permissions; trust
  that for the org name and to know what you're allowed to do before attempting a
  gated command (don't assume a particular org slug — read it from `whoami`).

**Multi-tenant:** a user can belong to several orgs; the active one is chosen at
login. Override for a single command with the global `--org <slug>`
(`agenteye --org acme sessions`); change the saved default with
`agenteye orgs switch <slug>`.

## 4. Mutations: confirm with the user FIRST

The CLI normally prompts "are you sure?" before a destructive action — **but it
auto-skips that prompt whenever it isn't attached to a terminal, which is
exactly how you run it. `--json` skips it too.** So the safety prompt will not
fire for you.

Therefore: **before running any command that changes state, tell the user
plainly what will change (which resource, what value) and get an explicit OK.**
Then run it. (When the user's request *is* the instruction to act — "create a
key called X" — state the exact command you'll run and proceed; when it's vague
or wide-blast — delete, disable a user, rotate a key, resolve an incident —
stop and confirm.)

If a create fails because the name already exists (exit 2), **report that and
ask** — don't rename-and-retry or rotate/regenerate the existing one. A
`keys regenerate` you didn't intend breaks whatever already uses that key.

State-changing commands: `keys create/update/disable/regenerate`,
`users create/update/disable/enable`, `settings set`,
`alerts create/update/delete/test`, the writing `incidents` subcommands
(`ack/assign/resolve/comment-add/comment-delete/subscribe/unsubscribe/open`),
`query create/update/delete`, `agent rename/delete`, and `orgs switch`.
Read-only commands (§5 "Observe") never need this.

## 5. Command map

Pick the right group; full flags are in `references/commands.md` — read it when
you need a flag you don't already know.

**Observe (read-only):**
- `events` — event log (light/payload-free responses by default; `--search` still scans payload server-side; `--full` or `--fields payload` returns the raw payload — keep bounded to a `--session-id`). `--session-id --event-type --env --agent-id --since --search --full --all`
- `sessions` — agent runs (time/env/agent/session/status), no scores.
- `evals` — evaluation results + scores; `--aggregate` for a health rollup; `--score key:min..max`.
- `errors` — errored events; `--aggregate` for count / sessions / agents / last-seen.
- `list <kind>` — **discover valid filter values first**: `envs agents event_types score_filters models hooks tools error_types`.

**Manage (permission-gated, mutations):**
- `keys list|show|create|update|disable|regenerate` — API keys; secret shown once.
- `users list|show|create|update|disable|enable` — referenced by **email**.
- `settings list|schema|set` — fixed registry; `schema` shows what each key accepts.
- `alerts list|show|create|update|delete|test` — referenced by **name**.
- `incidents list|count|show|ack|assign|resolve|comment-add|comment-list|comment-delete|subscribe|subscribers|unsubscribe|open` — by id (short ids accepted).

**Analytics & assistant:**
- `query list|show|create|update|delete|run|schema` — saved ClickHouse SQL + ad-hoc runner (`query run <name>` or `query run --sql "…"`); `query schema [table]` for table layout.
- `agent health|models|chats|ask|show|rename|delete` — built-in assistant; `agent ask "…"` starts a chat, `--chat <short-id>` continues one.

**Identity:** `login`, `logout`, `whoami`, `orgs {list,switch,current,perms}`, `version`, `help`.

## 6. Translating plain-English requests

Users speak in outcomes, not commands ("is anything broken?", "give CI a key",
"who has access?"). Map intent → command; when a value is fuzzy, run a discovery
command (`list <kind>`, `whoami`, a `list` subcommand) before committing.

| The user says… | Reach for |
|---|---|
| "is anything broken / failing today?", "any errors?" | `errors --since 24h --aggregate`, then `errors --since 24h --all --limit 1000` to break down |
| "why did that run fail?", "what happened in session X?" | `events --session-id X --all --limit 1000` (and `errors --session-id X`) |
| "how are my agents doing?", "show recent runs" | `sessions --since 24h` (add `--status error` for just failures) |
| "are the evals / quality scores ok?", "did quality drop?" | `evals --aggregate`; drill with `evals --score <key>:..0.5` |
| "how many events / how much traffic last week?" | `query schema` then `query run --sql "SELECT count() FROM events WHERE ts >= now() - INTERVAL 7 DAY"` |
| "is anything on fire?", "any alerts firing / open incidents?" | `alerts list` + `incidents list` (and `incidents count`) |
| "ack / look at / resolve that incident" | `incidents list` → `incidents show <id>` → **confirm** → `incidents ack`/`resolve <id>` |
| "give CI / this service an API key" | `keys create <name> --add events:add` (scope to what they describe) — **state it, then create**; capture the one-time secret |
| "who has access?", "add / remove a teammate", "make them read-only" | `users list` / `users show <email>` / `users create`/`update`/`disable` |
| "change a setting", "what can I configure?" | `settings schema` (what's tunable) then `settings set <key> --value …` — **confirm first** |
| "what models can the assistant use?", "ask the assistant …" | `agent models`; `agent ask "…"` |
| "what can I query?", "run this SQL" | `query schema` / `query run --sql "…"` (or a saved `query run <name>`) |
| "what am I allowed to do?", "which org am I in?" | `whoami`, `orgs current`, `orgs perms` |

If the ask is ambiguous about scope (which org, which agent, read vs. change),
resolve it with a discovery command or a quick clarifying question rather than
guessing.

## 7. How to actually use it (recipes)

Discover → filter → read JSON → answer in prose:

```bash
agenteye --json list agents                                       # find valid agent ids
agenteye --json errors --since 24h --aggregate                    # how bad is it right now? (full-window totals)
agenteye --json errors --since 24h --all --limit 1000 | jq '.errors[] | {session_id, error_type}'
agenteye --json sessions --status error --since 7d --all --limit 1000   # which runs failed
agenteye --json events --session-id run-001 --all --limit 1000    # a run's timeline (light: summaries, no payload)
agenteye --json events --full --session-id run-001 --all | jq '.events[].payload'   # that run's RAW payloads (--full, bounded)
```

- **Raw `payload` is opt-in** — `events`/`errors` responses are payload-free by default; add
  `--full` (or `--fields payload`) to get it, and **always bound it to a `--session-id`**
  (the full feed is slow/OOM-prone at scale). For one event or a precise slice, read the
  column directly: `agenteye --json query run --sql "SELECT payload FROM events WHERE id = <id>"`
  (or `WHERE session_id = '<id>'`). See `references/commands.md` → "Getting the raw payload".

- **`list <kind>` before filtering** — don't guess an env or agent id; the
  discovery command tells you exactly what exists.
- **`--since`** takes `24h` / `7d` / etc.
- **`--all` is bounded by `--limit`, which defaults to 50.** So a bare
  `errors --since 24h --all` silently returns only the first 50 rows (with
  `next_cursor: null`, looking complete). For a real sweep pass a high explicit
  limit: **`--all --limit 1000`** (or higher). When you only need the totals, use
  `--aggregate` — it covers the whole window regardless of row caps, so it's the
  reliable cross-check that you pulled everything.
- **Triage flow:** `incidents list` → `incidents show <id>` (read the activity
  log) → confirm with the user → `incidents ack <id>` or `resolve <id>`.
- **Investigate a regression:** `evals --aggregate` to see which score dropped →
  `evals --score helpfulness:..0.5` to list the bad runs → `events --session-id <id>`
  to see what happened inside one.

When you've pulled what you need, answer the user in prose or a small table —
don't paste raw JSON back unless they asked for it.

<!-- ci: no-op touch to exercise the skill-sync trigger (safe to remove) -->
