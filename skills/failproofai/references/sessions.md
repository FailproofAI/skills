# Sessions, events and traces

SKILL.md gives the four-step investigation order and routes you onward. This file is what
you need to actually run one: the shape of an event on the wire, the event kinds that really
appear, and — the part that wastes the most time — **which parts of this surface are
dashboard-only, which `fp` reaches, and which only the HTTP API reaches.** Those three
sets differ, and none contains the others.

Anchors are into the docs tree (`docs/sessions/*.mdx`, `docs/reference/*.mdx`,
`docs/reference/openapi.json`) and the shipped `fp-cloud-cli` / `agenteye-evaluator` skills.
The rename has landed: this file writes **`fp`** (`uv tool install fp-cloud-cli`), and that is
what to resolve first — `command -v fp agenteye`. `agenteye` is the legacy fallback, a
separate package that is still installable; the read commands below behave the same there, but
`policies`, `fleet`, `guardrails` and `usage` do not exist in it. To actually run queries hand
off to **`fp-cloud-cli`**: it owns flags, pagination and exit codes in depth.

## What a session and an event are on the wire

A **session** is one agent run — model requests and responses, tool calls, hook executions,
human interaction, errors, policy decisions and evaluations joined by one `session_id`. An
**event** is one recorded action inside it. A **trace** is that stream ordered and nested.

Every event carries `timestamp`, `session_id`, `agent_id`, `event_type`, `environment`
(`events-and-configuration.mdx`, grep `Every event carries`). Everything else is in
`payload` — and **`payload` is the entire event JSON flattened, not a nested sub-object.**
Its keys are top-level, `payload["type"]` duplicates `event_type`, and it repeats those five
fields (`session-data.md`, grep `entire event JSON flattened`). Code reaching for
`payload.data.tool_name` finds nothing.

| `event_type` | payload keys worth reading |
|---|---|
| `agent_start` | `goal`, `parent_id` |
| `agent_end` | `outcome`, `summary` |
| `model_request` | `model`, `messages`, `system`, `tools` |
| `model_response` | `model`, `stop_reason`, `input_tokens`, `output_tokens`, `content`, `role` |
| `tool_use` | `tool_name`, `tool_call_id`, `input` |
| `tool_result` | `tool_name`, `tool_call_id`, `output`, `error`, `duration_ms` |
| `hook_triggered` | `hook_name`, `hook_id`, `trigger_event`, `input` |
| `hook_completed` | `hook_name`, `hook_id`, `outcome`, `output`, `error`, `duration_ms` |
| `error` | `error_type`, `message`, `traceback` |
| `human_wait` | `input_id`, `prompt`, `options`, `reason` |
| `human_input` | `input_id`, `response`, `duration_ms` |
| `human_pause` / `human_interrupt` | `reason`, `user_id`, `at_step` |

Agent pause and resume exist as families too; the table is the set with documented scoreable
keys. **There is no `user_message` or `agent_message` event type** — conversation text lives
in `model_request.messages` and `model_response.content`, so do not assume a message event
exists because an example appears to score one (`session-data.md`, grep `user_message`).

**Correlation IDs are what make durations exist.** `tool_use` ↔ `tool_result` pair on
`tool_call_id`, hooks on `hook_id`; the roll-up tries `tool_call_id,request_id,hook_id,id` in
order, and **events carrying none of them pair merely in order within their session** — which
can pair the wrong two events (`openapi.json`, grep `pair_key_paths`). A missing duration is
almost always a correlation-ID mismatch, not missing data; paired durations are computed by
the SDK and cannot be supplied by hand.

## Two feeds: light and full

| | Light (default) | Full |
|---|---|---|
| Endpoint | `GET /v1/events/summary` | `GET /v1/events` |
| CLI | `fp events …` | `fp events --full …` |
| Per row | derived one-line `summary`, `is_error`, `error_type`, `output_tokens`, `context_window`, `context_fill` | the raw `payload` |
| Cost | cheap, tail it | heavy — bound it to one `--session-id` |

- **`--fields payload` silently switches on full mode.** Projecting what looks like one more
  column moves you to the heavy endpoint (`cloud-cli.mdx`, grep `enables full mode`).
- **`--search` scans payloads but never returns them** — you can find an event by its text
  and still not see the text, and a broad search is expensive despite the light response
  (`fp-cloud-cli`'s `references/commands.md`, grep `responses remain payload-free`).
- **An empty payload can mean capture is off, not that nothing happened.** Request and
  response bodies, tool input and output are visible only when transcript capture is enabled
  *and* your permissions allow it (`read-a-trace.mdx`, grep `Sensitive content`); a machine
  connected with `--no-transcripts` ships decisions only.
- **`context_fill` is absent when the model's context window is unknown.** The resolver
  reports `override`, `default` or `unknown`, and on `unknown` no fill percentage is computed
  (`openapi.json`, grep `no context-fill percentage`). A blank column is not zero use.

## Read a trace: what to run at each step

| Step | Run | Watch for |
|---|---|---|
| Goal and environment | `fp --json sessions --session-id <id>`, plus `agent_start`'s `goal` | labels are set by the emitting SDK/daemon and are **not retroactive** — a relabel splits history across two filter values |
| **First divergence, not last error** | `fp events --session-id <id> --order asc --all --limit 1000` | the light feed's per-event summaries are enough; never omit the explicit limit |
| Model context and tool input just before it | `fp --json events --full --session-id <id> --all --limit 1000`, or `query run --sql "SELECT id, event_type, payload FROM events WHERE session_id='<id>' ORDER BY ts"` | an empty payload may be capture being off, not silence |
| Retries, latency, human input, policy decisions | the same feed, filtered by `--event-type` | `human_wait` / `human_input` spans can dominate. **Long duration does not mean model latency** (`read-a-trace.mdx`, grep `Long duration does not always`) |

Never reconstruct a session's shape from `fp sessions`. That feed is anchored on
`agent_start`: a session that never emitted one returns **zero rows** though the pipeline
evaluated it, `started_at` is the min over `agent_start` rows only, `--since` silently
re-scopes `started_at` to the window, and there is **no `ended_at` field at all** —
`last_event_at` is not `ended_at` (`session-data.md`, grep `never from`). Build from events.

## Dashboard-only vs CLI vs HTTP API

The most useful table here. "CLI" is `fp`; "API" is the public `/v1` surface on your
dashboard origin. Note the UI labels: everything in the `/sessions/*` doc route lives under
**Observe →**, except queries and dashboards, which are under **Analyze →**.

| Capability | Dashboard | CLI | `/v1` API |
|---|---|---|---|
| List sessions | Observe → Sessions | `sessions` | `GET /sessions` — needs **`evaluations:read`**, not `events:read` |
| Score / metric **range** filter on sessions | yes | **no `--score` on `sessions`** | via `/evaluations` `score_filters` / `metric_filters` |
| Trace view, timeline, minimap, deep-link URL | yes | events feed only | events feed only |
| Session export (evaluator JSON) | export control | **no export command** | `GET /sessions/{id}/export` |
| Re-evaluate a session | button | **no** | `POST /sessions/{id}/re-evaluate` (`evaluations:trigger`) |
| Stuck / queued evaluations | — | **no** | `GET /evaluation-jobs` |
| Live event stream | Observe → Events | `events` | `GET /events`, `/events/summary` |
| Free-text payload search | yes | `--search` | **absent** — `/events` has no `search` param |
| Error rollup | Observe → Errors | `errors --aggregate` | `GET /events/error_summary` |
| Alert from a representative error | bell control | **no** (generic `alerts` only) | `POST /alerts` |
| Model / tool / hook latency percentiles | Observe → Models, Tools, Hooks | **no** | `GET /events/latency_aggregate` |
| Filter-value facets | filter dropdowns | `list` (8 kinds) | `GET /events/{event_types,agent_ids,…}` |
| Magnitude-metric key catalogue | Observe → Metrics | **no** | `GET /evaluations/metric_keys` |
| Metric-range filtering | yes | **no** | `metric_filters` on `/evaluations` |
| Saved query CRUD + run | Analyze → Queries | `query …` | `/queries`, `/queries/run`, `/queries/schema` |
| Dashboard and tile CRUD, incl. layout | Analyze → Dashboards | **no** | **full CRUD** on `/dashboards*` |
| Block rate, Cloud decisions, unguarded actions, machine filter, policy mapping | Observe → policy | `guardrails summary` / `timeline`, plus `policies` and `fleet` for the deploy side | **no** — deployment is deliberately outside `/v1` |
| Failproof Assistant | Open agent chat | `agent …` | **no endpoint of any kind** |

Three rows invert the usual assumption. **Dashboards are not UI-only:** `dashboards.mdx` says
"Dashboard CRUD is not exposed by the current Cloud CLI" and stops there, but `openapi.json`
carries all five routes (`/dashboards`, `/dashboards/{id}`, `/dashboards/{id}/tiles`,
`.../tiles/layout`, `.../tiles/{tile_id}`) — an agent that reads only the docs page will
refuse an automatable task. **The Assistant is the opposite:** it exists in the UI and the
CLI and has **no `/v1` route at all** — no `/agent`, `/chat` or `/assistant` among the 77
routes — and its commands need a *user session*, so `--api-key` automation cannot reach it.
**And the policy row is newly CLI-reachable:** `fp policies`, `fp fleet` and `fp guardrails`
ship the whole compose → test → publish → deploy → watch lane, so any text calling deployment
"dashboard work" predates them and will stop you looking. Same session constraint as the
Assistant, though — every subcommand there except `policies test` exits 2 under an API key.
`failproofai-policy-deploy` owns that lane.

The CLI is also not a thin wrapper over `/v1`: it talks to the dashboard's `/api/*` routes,
which is why `--search`, `--errored` and `--status` have no `/v1` equivalent. Pick the
surface by capability, never by assuming parity.

## The engine behind Models, Tools and Hooks

Those three pages are one endpoint, `GET /v1/events/latency_aggregate`, which pairs a start
event with an end event and returns `bins`, `heatmap`, `summary` (count + p50/p95/p99/max),
`events` totals and an optional `distribution` (`openapi.json`, grep `This is how the tools,
models and hooks pages are drawn`). The CLI does not wrap it; the docs' own advice is a saved
query for model-level aggregates (`models.mdx`, grep `not exposed as a dedicated CLI`).

```
?start_event_type=tool_use&end_event_type=tool_result&distribution_key_paths=tool_name,tool
?start_event_type=model_request&end_event_type=model_response
?start_event_type=hook_triggered&end_event_type=hook_completed
```

- `start_event_type` and `end_event_type` are **required and must differ** — else 400.
- **Omitting `ts_from` spans back to the oldest matching event**, not a default window. Read
  `bounds` in the response for what was actually covered.
- `payload_sum_paths` can only sum `duration_ms`, `input_tokens`, `output_tokens`. Any other
  path is **ignored silently** and its `sums` entry stays `0` — a zero that reads as "no use".
- `bin_count` defaults to 24, clamped 1–168; the distribution names the top 10 keys and rolls
  the rest into `(other)`.

**Hooks and policy decisions are separate views and must not be conflated.** Hooks measures
when lifecycle hooks ran and how long they took; policy decisions explains what enforcement
allowed, instructed or blocked (`hooks.mdx`, grep `Policy decisions are a separate view`).
Hooks has no dedicated CLI command. **Policy decisions now does:** `fp guardrails summary`
(coverage, blocks and the per-policy table for a window) and `fp guardrails timeline` (one row
per bucket). Prefer those to the old documented approximation, `fp events --search "deny"
--since 24h`, which matches any payload containing that string — brittle, and say so if you
fall back to it. `guardrails` needs a user session (exit 2 under an API key) and is absent
from `agenteye` entirely. For the machine's own enforcement state use `failproofai config
--status`, not the cloud CLI.

## Scores versus metrics, and evaluations

Two scales that must never share an axis. **Scores** are top-level numeric keys under
`scores` (0–1 rates) and drive Observe → Evaluations. **Metrics** are unit-bearing
magnitudes nested at `scores.metrics.<key>` (ms, USD, tokens) and drive Observe → Metrics
(`metrics.mdx`, grep `Metrics is for values with units`). The API filters them separately;
the CLI filters only the first, with `--score KEY:MIN..MAX` (repeatable, either bound
omittable — `helpfulness:0.8..`, `cost:..0.3`). There is no metric flag: **metric-range
filtering is API-only.**

- **`metrics.mdx` sends you to the wrong key list.** It says run `fp list score_filters`
  to "discover available keys" — but that lists only **numeric top-level score keys**. Metric
  names come from `GET /v1/evaluations/metric_keys`, which the CLI does not expose.
- **Malformed `score_filters` entries are dropped silently.** A typo'd key yields an
  unfiltered-looking result set you may read as "nothing is wrong". Over 20 entries is a 400.
- **Without `latest_per_session=true`, `/evaluations` returns the full history**, so a
  re-evaluated session appears more than once and naive averages double-count it.
- **A session stuck behind a failing evaluator is invisible in `/evaluations`** — merely
  absent. It shows only in `GET /v1/evaluation-jobs` (`pending`/`polling`, with attempt
  count, next retry, last error), which the CLI does not expose.
- **Online evaluation is deployment-wide and silently disabled when the server has no
  `EVALUATOR_ENDPOINT`.** Hosted Cloud has no dashboard control for it; the operator must
  configure it (`troubleshooting.mdx`, grep `no evaluator endpoint control`). "No scores"
  usually means "no evaluator", not "the evaluator returned nothing".
- **Renaming a score key creates a new chart series**, silently breaking every dashboard,
  alert threshold and `--score` filter on the old key. Return stable keys.

## Queries and dashboards

Read-only ClickHouse SQL over `events`, `evaluations`, `agent_sessions` (analytics) plus
`dashboards`, `saved_queries`, `api_keys`, `users` (operational). Run `fp query
schema` before writing against unfamiliar fields. The runner accepts exactly **one**
statement (`openapi.json`, grep `One read-only statement`): it must start with `SELECT` or
`WITH`; a `;` outside a string literal is rejected; 8000 characters maximum; and a single
statement may **not** join the analytics tables to the operational ones — split it in two.

- **Saving does not validate.** `POST /queries` stores `sql_text` verbatim; restrictions
  apply at execution time. SQL that saves cleanly can be refused when it runs — and a
  dashboard tile built on it fails at *render*, not at save.
- **A `NUMERIC` column comes back as `null`.** Cast it: `avg(x)::float8`. Silent nulls in an
  aggregate read as "no data".
- **10 000 rows max with `truncated: true` when there were more; a run is cut off at 10
  seconds.** Page with your own `LIMIT`/`OFFSET`; check `truncated` before quoting a total.
- **Every run — rejected or failed included — is recorded in the query audit log** with its
  SQL, parameters, duration and outcome. Exploratory SQL is not private.
- **Saved-query and dashboard lists are cached up to 30 seconds.** Something you just
  created may not appear on the very next call. Do not retry-create it.
- Two docs conflicts, both read off the pages and **not tested against a running build**:
  `params` is array-or-object per the schema but "a JSON array" per the prose, while the CLI
  takes `--param k=v` / `--arg`; and the sessions docs address saved queries by `<query-id>`
  while the CLI reference defines every subcommand as taking a **name**. Confirm with
  `fp query run --help`, use `query list --show-id`, and prefer the name.

A tile is exactly one saved query plus `chart_type` (`line`, `area`, `bar`, `stacked_bar`,
`pie`, `kpi`, `table`) and `pos_x`/`pos_y`/`pos_w`/`pos_h`. **`GET /v1/dashboards/{id}/tiles`
returns an empty `tiles` array for a dashboard id that does not exist in your org, rather than
404** — "no tiles" and "no dashboard" are indistinguishable from that call alone.

A query identifies a suspicious pattern; it does not establish a failure mode. Open
representative traces or run an audit before turning a result into a policy (`queries.mdx`,
grep `does not establish the failure mode`).

## The Failproof Assistant

`fp agent health` → `agent models` → `agent ask "…"` (prints a short chat id) → `agent
ask "…" --chat <id>` → `agent show <id>`, plus `agent rename` / `agent delete`. Chat ids are
the first 8 hex and prefix-resolved; on a non-TTY, `ask` prints the raw answer to stdout.

It reads **only what the current user can access**, and the docs forbid the obvious
workaround: do not broaden permissions to make a question work — ask an authorized operator to
run the investigation (`assistant.mdx`, grep `Do not broaden permissions`). Treat its SQL and
summaries as an investigation aid, not final evidence, and open the cited session first.

## Traps that cost a turn

| Trap | What actually happens |
|---|---|
| `fp events --since 24h --all` | `--all` is bounded by `--limit`, default **50**. You get 50 rows and `next_cursor: null` — it looks complete. Pass `--all --limit 1000`, and cross-check with `--aggregate`, which covers the whole window regardless of row caps |
| `fp events --json` | Global flags go **before** the command; after it they are a usage error, exit 2. Write `fp --json events` |
| `--since 30d`, `--since 2h` | Closed enum: `all`, `15m`, `1h`, `6h`, `24h`, `7d`. Anything else is exit 2, not a clamped window. Use `--from`/`--to` with full RFC 3339 including `T` and a timezone |
| `fp evals --env prod --env staging` | `evals` and `errors` filters are **single-valued** — last wins, so this queries only staging. `sessions` and `events` filters do accumulate |
| Asking for `--limit 500` on evals | Capped at 200, **silently**. `/events` caps at 1000, `/sessions` at 200, `/evaluation-jobs` at 500. The caps are inconsistent |
| A legitimate `event_type` filter returning nothing | `list event_types` is the **observed** set, cached up to 5 min. Absent can mean "never sent", not "nothing happened" |
| Grouping failures by error type | `list error_types` counts only events with a **classified** type. A failed tool result carrying a message but no type is in `errored` filters and not in this list — the grouping under-counts real failures |
| Treating any facet list as authoritative | Capped at 500 values; caches run ~1 min (models, envs, agents), ~2 min (hooks, tools, error types), up to 5 min (event types). `/events/trigger_events` scans **only the last 90 days** |
| `POST /v1/events` returned 200 | Body is newline-delimited JSON, one object per line, **not** an array. Malformed lines are **skipped, not rejected** — 200 even when every line was bad. Read `accepted` and `skipped` |
| Filtering the live view to verify a new integration | An incorrect filter is indistinguishable from failed ingestion. Stay broad until the first event appears, then filter (`live-events.mdx`, grep `an incorrect filter`) |
| Seeing the session on `localhost:8020` | The local dashboard is a separate surface; it works with no account and **does not prove events reached your org**. It also renders prompts, file content and terminal output from local histories — bind it only to trusted interfaces |
| Counting denied rows on the local dashboard | A denied-looking row can be purely observational where the harness/event pair does not consume blocking verdicts. Only the detail view calls out verified enforcement capability |
| `fp whoami` to test login | It **never exits 4**; it returns `{"logged_in": false, …}` and exit 0. Branch on the field, not the code |
| A confirm prompt protecting a mutation | Confirms auto-skip on a non-TTY and under `--json` — exactly how an agent runs. Ask the human before `query delete`/`update` or `agent delete`/`rename` |
| Reconstructing an evaluator fixture from events | It can never reproduce one real case: a payload the server cannot parse is sent as `payload: null` (which 422s an evaluator) but the CLI coerces it to `{}`. Use `GET /sessions/{id}/export` — which has **no pagination and no size cap**, so never run it blind against an unbounded session |
| API-key mode targeting the wrong tenant | Saved human-session org state is **intentionally ignored** for API-key requests. Pass `--org <slug>`, **`FP_ORG`**, or the `X-AgentEye-Org` header. The flag and the header are exactly as written; the env var follows the *binary*, so under `fp` it is `FP_ORG` — `fp` reads no `AGENTEYE_*` variable at all, while the header literal stays `X-AgentEye-Org` and must never be modernised |

Branch on exit codes, do not scrape error text: `0` ok, `1` server error, `2` usage, `3`
cannot reach dashboard, `4` not signed in, `5` missing permission (the message names it), `6`
not found. `4` never comes from `whoami` — only from commands that actually need the session.

Finally, keep three nouns apart — they drive different response workflows. An **error** is
an observed event, a failed **evaluation** is a quality judgment, and an audit **finding**
is an investigated failure pattern (`errors.mdx`, grep `An error is an observed event`).
