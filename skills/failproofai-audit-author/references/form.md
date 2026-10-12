# The audit form, field by field

The fields of the dashboard's new-audit form (`/<org>/audits/new`). All values are
strings; lists are comma-separated.

| field | values | maps to (the audit's API fields) |
|---|---|---|
| `description` | ≤ 2000 chars — what it looks for | `description` |
| `name` | ≤ 200 chars | `name` |
| `environments` | env names, comma-separated, or `all` | `scope.environments` (empty = every) |
| `agents` | agent ids, comma-separated, or `all` | `scope.agent_ids` (empty = every) |
| `cadence` | `hourly` `6h` `daily` `weekly` | `schedule_interval_secs` 3600 / 21600 / 86400 / 604800 |
| `window` | `since_last` `24h` `3d` `7d` `30d` | `window_mode` since_last, or fixed + `lookback_window_secs` |
| `sensitivity` | `low` `medium` `high` | `sensitivity` (how picky the investigation is) |
| `top_k` | 1–15 | `top_k` (failures filed per run; policy findings bypass it) |
| `ignore_errors` | error types, comma-separated; `none` clears | `ignore_error_types` |
| `notify` | `inbox_only` `email` `slack` `email_and_slack` | `channels` |
| `notes` | ≤ 4000 chars | the audit's reference context (`context.text`) |
| `model` | `configured` (the deployment's model), `none`, or a model id the form lists | `llm_enabled` + `llm_budget.model`; `none` = built-in checks only, $0/run |

Not on the form (server defaults apply): `signals` (the legacy per-signal toggles),
`llm_spec`, `min_count` (3), `min_rate` (0), `control_sample_rate`, the run anchor (next
09:00 UTC). `model: none` runs the deterministic floor only and costs nothing; the
preview says when it would flag the same sessions as the model-backed audit.

`since_last`: the first run reads the last 7 days, every later run reads from the end of
the previous successful run, so nothing is read twice and nothing is skipped.
