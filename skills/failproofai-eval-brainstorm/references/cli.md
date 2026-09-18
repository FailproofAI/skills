# Running this locally with `fp`

For a coding agent on the user's machine, with the `fp` CLI pointed at their
organisation. Needs `events:read`; the `evals` command also needs `evaluations:read`.

## The palette

| To learn… | Run |
|---|---|
| what exists | `fp --json list agents` · `list envs` · `list error_types` · `list score_filters` |
| where it hurts | `fp --json errors --aggregate --since 7d` |
| which runs failed | `fp --json sessions --status error,timeout --since 7d --all --limit 1000` |
| what is already scored | `fp --json evals --aggregate --since 7d` → `score_stats` |
| which scores are low | `fp --json evals --score <key>:..0.5 --since 7d --all --limit 200` |
| a session's shape | `fp --json events --session-id <id> --order asc --all --limit 1000` |
| a session's content | the same, plus `--full` |
| anything the flags cannot express | `fp --json query run --sql "…"` — check `fp --json query schema` for columns first |

SQL runs over `events`, `evaluations` and `agent_sessions`. Two queries carry most of
the method:

```bash
# event-type histogram across the population
fp --json query run --sql \
  "SELECT event_type, count() c FROM events GROUP BY event_type ORDER BY c DESC"

# the candidate per session, so the good and bad cohorts can be compared
fp --json query run --sql \
  "SELECT session_id, count() c, countIf(event_type='error') errs
   FROM events GROUP BY session_id ORDER BY errs DESC LIMIT 50"
```

## Gate A without a payload profile

The dashboard assistant has a profile of the organisation's payload keys. **The CLI has
no equivalent command**, so confirming a field exists is on you — and skipping it is how
you propose a measurement over a key nobody emits.

Derive it from the data instead. Over one session:

```bash
fp --json events --full --session-id <id> --all --limit 1000 \
  | jq '[.events[] | select(.event_type=="tool_use") | .payload | keys[]] | unique'
```

Across the population, sample several sessions and intersect — a key present in one run
and absent from the next five is not a foundation. Say the presence rate you actually
observed, and say how you observed it; "seen in 6 of 8 sessions I checked" is an honest
claim, "present" is not.

## The gotchas that make a command lie

- **Globals go before the command.** `fp --json events …`, never `fp events --json` —
  the latter exits 2.
- **`--all` is capped by `--limit`, which defaults to 50.** A bare `--all` returns 50
  rows and looks complete. Always `--all --limit 1000`; past that, page with `--cursor`.
- **`--since` is a closed set** — `all`, `15m`, `1h`, `6h`, `24h`, `7d`. Anything else is
  a usage error; use `--from` / `--to` with RFC3339 for a custom range.
- **`evals` and `errors` filters are single-valued** — a repeated flag means last-wins.
  `sessions` and `events` take CSV and repeats.
- **Keep `--full` bound to one `--session-id`.** It is slow at scale, and you do not need
  payloads to read a session's shape.

## The local deliverable

Same slate, written down. Offer to save it as `eval-plan.md` — **ask first, and ask
where**: the file can carry paraphrased customer data, and this may be running before any
repo for it exists. Cite session ids and paraphrase what you saw; never paste raw
transcript into a file.

Each proposal still ends in the prompt, which the user takes to the dashboard's eval
authoring page to compose, backtest and deploy.
