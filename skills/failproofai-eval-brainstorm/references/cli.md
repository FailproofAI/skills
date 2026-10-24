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
| what is already defined, even without results | `fp --json evaluators list --all` · `fp --json evaluators show <key>@<version>` |
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

## Gate A — schema profile and payload checks

Read `fp --json evaluators schema` for the organisation's sampled event and payload
profile. It needs `evaluations:trigger` and `events:read`. A sampled profile is not
proof of universal presence, so confirm the candidate fields on real sessions;
skipping this is how you propose a measurement over a key nobody emits.

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
- **`evals --score` is repeatable and AND-combined.** Each range is
  `KEY:MIN..MAX`, with either bound optional. `errors` filters are single-valued;
  `sessions` and `events` take CSV and repeats.
- **Keep `--full` bound to one `--session-id`.** It is slow at scale, and you do not need
  payloads to read a session's shape.

## From a proposal to a deployed evaluator

Each proposal carries its intent plus an exact terminal authoring action, not just
a prompt to paste. This skill still stops at proposals: perform drafting and
deployment only when the user asks to proceed, following `failproofai-eval-author`
and its `references/cli.md`.

```bash
fp evaluators draft "Fraction of recorded events without an error. Use key error_free_events, result kind score and label reliability." \
  --kind code --out error_free_events.json
fp evaluators dry-run --file error_free_events.json
# After inspecting the spec, test both independently selected cohorts (up to 10 sessions).
fp evaluators dry-run --file error_free_events.json --session <bad-session> --session <good-session>
# Get approval of the exact definition before enabling it.
fp evaluators create --file error_free_events.json
fp --json evals --score error_free_events:..0.5 --since 24h
```

Replace the session placeholders with real finished session ids. For a judge,
skip both dry-run commands: judges cannot be dry-run. Inspect its condition and
steps, create with approval, and read the first results. Jev dry runs spend model
budget; obtain consent. Judge/Jev always produce scores, thresholds are 0–1, and
Jev score rubrics have 3–5 distinct levels ordered worst to best.
Use `fp evaluators deploy <key> --file spec.json` with a new version for a
replacement; it disables older enabled versions. Code, Jev and judges can score
historical sessions (up to 90 days): `fp evaluators backfill --from T --to T --key <key>
--dry-run` counts the missing pairs for free, the same command without `--dry-run`
queues them (or `deploy … --backfill 7d`, or **score past sessions** in the dashboard).
Jev/judge scoring spends the org's model budget, so get a separate OK first. Backfill preserves results and terminal assignments
for each session/key, so publishing a new version does not re-grade old pairs.

AI drafting needs a **signed-in session**. In key mode, `fp evaluators draft`
exits 2 with "`fp evaluators draft` needs a signed-in session: run `fp login`".
Either log in, or author the code/envelope spec by hand with
`failproofai-eval-author` and use `create --file` with the key. The **standard**
key preset includes `evaluations:trigger`, needed for authoring.
Only if authentication is unavailable or that permission is missing, offer the
dashboard form as a paste fallback and explain `fp login` or the permission fix.
Never guess an org slug for a fallback link; check the selected organisation first.

`fp query compose "<question>"` drafts SQL for investigating a candidate; add
`--run` only when you intend to execute it. It too needs session login. With a key,
keep using `fp query run --sql`. New commands on an older Cloud may exit 6 with
`not available on this FailproofAI Cloud yet`; report this rather than claiming
that authoring or querying succeeded.

## The local deliverable

Same slate, written down. Offer to save it as `eval-plan.md` — **ask first, and ask
where**: the file can carry paraphrased customer data, and this may be running before any
repo for it exists. Cite session ids and paraphrase what you saw; never paste raw
transcript into a file.

Each proposal ends in the intent and its `fp evaluators draft` command with a
distinct output filename. Once the user chooses to proceed, the authoring skill
turns that draft into a tested, deployed definition with `create` or `deploy`.
Report the created key/version and evidence from results, not just the existence
of a local spec file.
