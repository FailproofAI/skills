# Trigger kinds — what the server runs, and the form fields that set it

All four read the org's events (or scores) every `every` (30 s – 24 h, default 5m) over the
last `window`. `sure` = "m of n": an issue opens when m of the last n checks breached
(default 1 of 1). Issues never auto-resolve; a breach while one is open only updates it.

## error → per_event

Counts events matching ALL filters in the lookback; breaches on ≥ 1. No threshold.
- `event_type` (required by the server; the form defaults to `error`). Policy denials are
  `hook_completed` events with error_type `failproofai_deny`.
- `error_type`, `agent`, `env` — exact matches; `any` clears one.
- `window` is the lookback; the server raises it to at least one check interval.
- Noise lever: `sure` ("3 of 3" = it kept happening for three checks) and a longer `every`.
  On a signal that is busy most hours, an error alert cannot be made quiet — use a count
  with a threshold (`query`).
Form: trigger, event_type, error_type, agent, env, window, every, sure, severity, name, meaning.

## metric → metric_threshold

One aggregate over the window, compared to the threshold (an empty window is 0).
- metric: `event_count` | `error_count` | `error_rate` | `p95_latency` | `p99_latency` | `tokens`.
- `env` narrows every metric; `event_type` narrows `event_count` only; there is NO agent
  filter.
- p95/p99 latency is over EVERY event with a duration — tool results, model responses,
  hooks AND whole agent runs (`agent_end`, minutes long) — so "tool calls got slow" is a
  `query` on `event_type = 'tool_result'`, not this metric.
- threshold grammar: `above 50`, `below 10`, `at least 3`. error_rate is written as a
  PERCENT (`above 5%`; a bare `0.05` reads as 0.05 %). Latency in ms or s (`above 2400ms`,
  `above 4s`). Tokens/counts as plain numbers (`above 130000000`).
Form: trigger, metric, threshold, window, env, event_type, every, sure, severity, name, meaning.

## score → evaluation_score

The AVERAGE of one score key over evaluations finished in the window; needs ≥ 3 scores in
the window (the form's default) to judge, else no breach.
- `score` = a score key the org actually has. threshold `below 0.7` (scores are 0–1 unless
  the eval says otherwise). `env` narrows.
- Default window 1h; a longer window (6h) smooths a noisy score.
Form: trigger, score, threshold, window, env, every, sure, severity, name, meaning.

## query → custom_sql

Runs a SAVED query (picked by name in the form) as the org's read-only ClickHouse user. With
a threshold, the first row's `metric_value` column is compared; with none, any returned row
breaches. Use it for what the other kinds cannot filter: one agent with a threshold, payload
fields, outcomes, denials.
- The window lives in the SQL. The shape a drafted query alert uses (count, or a duration
  quantile / token sum in place of `count()`):
  `SELECT count() AS metric_value FROM analytics.events WHERE ts >= now() - INTERVAL 3600 SECOND AND (<predicate>)`
- Columns: event_type, agent_id, environment, error_type, tool_name, hook_name, model,
  duration_ms, input_tokens, output_tokens, is_error, session_id, payload (a JSON string:
  `JSONExtractString(payload, 'outcome')`).
- The form can only pick an EXISTING saved query: save the SQL first (the queries page, or
  `fp query create` — with the user's ok either way), then pick it by name.
Form: trigger, query, threshold, every, sure, severity, name, meaning (no window field).
