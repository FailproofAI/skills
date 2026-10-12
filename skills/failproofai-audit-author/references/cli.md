# Setting up an audit from a machine with `fp`

For a coding agent on the user's machine, with the `fp` CLI pointed at their
organisation. Reading needs `events:read` and `audits:read`; creating needs
`audits:write`.

`fp` has no command that drafts or previews an audit. The procedure's checks — does the
scope have traffic, how often does each signal fire — are SQL you run with
`fp query run`; the audit itself is made on the dashboard's form or with
`fp audits create`. Globals go before the command: `fp --json query run …`.

## Step 3 — scope: real ids, and traffic in them

```bash
fp --json list agents ; fp --json list envs ; fp --json list error_types

# sessions per day for the scope — zero means the scope is wrong
fp --json query run --sql \
  "SELECT agent_id, environment, uniqExact(session_id) / 7 AS sessions_per_day
   FROM events WHERE ts >= now() - INTERVAL 7 DAY
   GROUP BY agent_id, environment ORDER BY sessions_per_day DESC"
```

## Step 4 — how often a signal fires here

Count sessions matching the signal's shape over the last 7 days, out of all sessions in
scope. These patterns approximate the catalog's (`signals`); the server's own are what
the audit runs, so treat the count as an estimate and say so.

```bash
fp --json query run --sql \
  "SELECT uniqExactIf(session_id,
            match(payload, '(^|[^A-Za-z0-9])sk-[A-Za-z0-9][A-Za-z0-9_-]{18,}')) AS api_key_sessions,
          uniqExactIf(session_id,
            match(lower(payload), 'authorization[^a-z0-9]{1,4}bearer ')) AS bearer_sessions,
          uniqExact(session_id) AS all_sessions
   FROM events
   WHERE ts >= now() - INTERVAL 7 DAY AND agent_id IN ('support-bot')"
```

Zero is fine for a "make sure it never happens" sweep — say the audit is a standing guard
for something not currently seen. A signal matching a large share of sessions is noise:
narrow the scope or lower the sensitivity. For the lenses (`task_completion`,
`sequence_pathologies`, …) there is no single pattern to count; a proxy is enough —
sessions with no `agent_end`, or the same `tool_name` 10+ times in one session.

## Step 7 — cost

`fp --json audits runs <name>` on an existing audit shows past runs; the per-run figures
are in `--json` (`stats`). Multiply by runs per day. With no past runs, say the cost is
unknown rather than guessing one.

## Create it

**On the form (preferred):** `https://app.befailproof.ai/<org>/audits/new`, fields as in
`form`. It accepts `?intent=` (the request in the user's words), `?description=`,
`?name=`, `?environment=` and `?agent_id=` to prefill; the dashboard assistant there can
draft the audit and show its preview (sessions read per run, what the catalog would flag,
estimated cost) on the form.

**With `fp`:** the form's fields map to flags —

| form | `fp audits create` |
|---|---|
| `cadence` hourly / 6h / daily / weekly | `--schedule-interval-secs 3600 / 21600 / 86400 / 604800` |
| `window` since_last | `--window-mode since_last` |
| `window` 24h / 3d / 7d / 30d | `--window-mode fixed --lookback-window-secs 86400 / 259200 / 604800 / 2592000` |
| `agents`, `environments` | `--scope '{"agent_ids": ["support-bot"], "environments": ["prod"]}'` (omit a list for every) |
| `sensitivity` | `--sensitivity low\|medium\|high` |
| `top_k` | `--top-k 5` |
| `ignore_errors` | `--ignore-error-type a,b` |
| `model` none | `--no-llm` (built-in checks only, $0 per run) |
| `notes` | `--text "…"` or `--text-file notes.md` — sent with the create, so the first run has it |
| `notify` | `--channels '<json>'` |

```bash
fp audits create "support bots: leaked keys" \
  --description "Sweep the support bots for API keys or bearer tokens in tool calls." \
  --schedule-interval-secs 604800 --window-mode since_last \
  --scope '{"agent_ids": ["support-bot"]}' --sensitivity high --top-k 5 \
  --text-file notes.md
```

Creating an audit is a change to the org, and a new enabled audit runs immediately:
state the command and get the user's OK first. Afterwards `fp audits run <name>` only
queues a run — poll `fp audits runs <name>` until it reads `succeeded`, then
`fp audits findings --audit <name>`.
