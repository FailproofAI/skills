# Writing an alert from a machine with `fp`

For a coding agent on the user's machine, with the `fp` CLI pointed at their
organisation. Reading needs `events:read`; creating an alert needs alert write access.

`fp` has no command that drafts or replays an alert. You compute the baseline and the
replay yourself with `fp query run`, then create the alert on the dashboard's form or with
`fp alerts create`. Globals go before the command: `fp --json query run …`.

## Real names first

```bash
fp --json list envs ; fp --json list agents ; fp --json list event_types
fp --json list error_types ; fp --json list score_filters
```

Use these spellings exactly. An environment or agent the org does not have matches
nothing, and the alert is silent forever.

## Step 2 — the baseline: the alert's own number, per check

Compute the number the alert will compare, at its own window, once per check interval,
over 7 days (then 30), and read the distribution — not the average. For a count over a
15-minute window, checked every 5 minutes:

```bash
fp --json query run --sql \
  "WITH per_check AS (
     SELECT toStartOfInterval(ts, INTERVAL 5 MINUTE) AS slot, count() AS n
     FROM events
     WHERE ts >= now() - INTERVAL 7 DAY
       AND agent_id = 'agent-billing' AND event_type = 'error'
     GROUP BY slot)
   SELECT quantiles(0.5, 0.95, 0.99)(w) AS p50_p95_p99, max(w) AS mx
   FROM (SELECT slot, sum(n) OVER (ORDER BY slot ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS w
         FROM per_check)"
```

The `ROWS BETWEEN 2 PRECEDING` is the window expressed in checks (15m / 5m = 3 slots).
Empty slots do not appear, so this over-states the quiet periods' values a little; the
tail (p95, p99, max) is what the threshold is set against, and it is reliable. For a
latency alert use `quantile(0.95)(duration_ms)` per slot instead of `count()`; for a rate,
count errors and all events per slot and divide only where the slot holds ≥ 20 events.

Run `fp --json query schema events` before writing new SQL. `payload` is a JSON string:
`JSONExtractString(payload, 'outcome')`, never `payload->>'outcome'`.

## Step 3 — replay it

With the threshold chosen, count the checks that would have breached, and collapse runs
to one page per hour (an open issue absorbs later breaches):

```bash
fp --json query run --sql \
  "SELECT count() AS fires_7d, max(hour) AS last_fire FROM (
     SELECT toStartOfHour(slot) AS hour FROM (
       SELECT slot, sum(n) OVER (ORDER BY slot ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS w
       FROM (SELECT toStartOfInterval(ts, INTERVAL 5 MINUTE) AS slot, count() AS n FROM events
             WHERE ts >= now() - INTERVAL 7 DAY AND agent_id = 'agent-billing'
               AND event_type = 'error' GROUP BY slot))
     WHERE w > 320 GROUP BY hour)"
```

This ignores "m of n" (it is "1 of 1"); with `sure` = "2 of 3" it over-counts, so say
it is an upper bound. Then judge it with `noise`: more than about one fire a day is noisy;
zero in 30 days on a condition that really occurs is silent. Report the numbers and how
you got them ("by SQL over the last 7 days, upper bound").

## Create it

**On the form (preferred):** `https://app.befailproof.ai/<org>/alerts/new`. The fields
are the ones `triggers` lists per kind, and below them the form draws its own estimate for
the rule as it stands — "last 24h · would have fired N times", hour by hour (not for a
query alert). The dashboard assistant on that page can also draft the alert from the
request, with the 7- and 30-day replay shown on the form. A query alert needs its SQL
saved first: `fp query create "<name>" --sql "…"`, then pick it by name.

**With `fp`:** `fp alerts create <name> --trigger-kind <kind> --trigger-spec '<json>'
--severity warning --eval-interval-secs 300 --min-breaches 1 --eval-window 1`. The kinds
are the server names in SKILL.md's table (`per_event`, `metric_threshold`,
`evaluation_score`, `custom_sql`); `--min-breaches` / `--eval-window` are `sure`'s m and n.
The spec is per kind, for example:

```json
{"metric": "error_count", "filter": {}, "window_secs": 900, "op": ">", "value": 320}
{"score_key": "helpfulness", "op": "<", "value": 0.7, "window_secs": 3600, "min_count": 3}
{"event_type": "error", "agent_id": "agent-billing", "lookback_secs": 300}
```

Read an existing alert of the same kind (`fp --json alerts show <name>`) to confirm the
shape before sending one. Creating an alert is a change to the org: state the exact
command and get the user's OK first. `fp alerts test <name>` sends a test notification
through its channels — it checks delivery, not the rule.
