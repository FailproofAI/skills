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

**Reading a payload key in SQL.** The store is ClickHouse and `payload` is a `String`
holding JSON, so Postgres spellings are syntax errors, not empty results:
`payload->>'key'` and `::float` both fail outright. Use the JSON functions, and note
that the column is `event_type` (not `type`) and the timestamp is `ts`:

```bash
fp --json query run --sql \
  "SELECT agent_id,
          count() ends,
          round(avg(JSONExtractBool(payload,'resolved')), 3) pct_resolved,
          round(avg(JSONHas(payload,'sentiment_score')), 3) sentiment_present
   FROM events WHERE event_type='agent_end' GROUP BY agent_id ORDER BY ends DESC"
```

`JSONExtractString` / `Float` / `Bool` read a value; `JSONHas` reads presence. That last
column is the useful trick: it answers Gate A and Gate B in one query, putting the rate a
key is present at next to the number it produces.

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

## Building the authoring link

There is no `build_eval_authoring_link` here — that tool belongs to the dashboard
assistant. Build the link yourself; it is three pieces, and `fp` has two of them:

```bash
ORG=$(fp --json whoami | jq -r '.active_org // empty')
BASE=${FP_DASHBOARD_URL:-https://app.befailproof.ai}
PROMPT='Fraction of tool calls … Use the evaluation key `tool_retry_rate`.'

[ -n "$ORG" ] && echo "$BASE/$ORG/eval-authoring/new?intent=$(jq -rn --arg p "$PROMPT" '$p|@uri')"
```

**If `active_org` comes back empty, do not build the link.** Under an API key with no
`--org`, `whoami` reports `null` — and an instance-scoped key then resolves server-side
to the *default* org, so a link built from a guess would open authoring against the wrong
tenant. Hand over the prompt instead and say why: *"pass `--org <slug>` and I will build
the link."*

`@uri` matters: the prompt carries backticks, quotes and dashes, and the page decodes
exactly what you encode. One link per proposal, same rules as the method — build it, do
not offer to.

## The local deliverable

Same slate, written down. Offer to save it as `eval-plan.md` — **ask first, and ask
where**: the file can carry paraphrased customer data, and this may be running before any
repo for it exists. Cite session ids and paraphrase what you saw; never paste raw
transcript into a file.

Each proposal still ends in the prompt and the link built above, which opens the
dashboard's eval authoring page to compose, backtest and deploy. The link is the handoff;
the prompt beside it is what the user can read before they click, and what they paste
if the link could not be built.
