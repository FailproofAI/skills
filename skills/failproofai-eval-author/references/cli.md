# Writing an evaluation from a machine with `fp`

For a coding agent on the user's machine, with the `fp` CLI pointed at their
organisation. Reads need `events:read`; `fp evals` also needs `evaluations:read`.

**`fp` cannot create, dry-run or deploy an evaluation.** Those happen on the dashboard's
eval authoring page, `https://app.befailproof.ai/<org>/eval-authoring/new`. What `fp`
gives you is the half that decides whether the draft measures anything: the org's real
event types, payload keys and values, and the sessions to test it on.

Globals go before the command (`fp --json events …`, never `fp events --json`), and a
bare `--all` stops at 50 rows — always pass `--all --limit 1000`.

## Step 2 — ground it: which keys and values exist

The references speak of an "ORGANISATION EVENT SHAPES block". There is no command that
prints one; build the same facts with SQL. Check columns first with
`fp --json query schema events`. `payload` is a `String` holding JSON, so read it with
ClickHouse JSON functions, not Postgres operators (`payload->>'k'` is a syntax error).

```bash
# which event types occur, and how often (an evaluation over an absent type never fires)
fp --json query run --sql \
  "SELECT event_type, count() c FROM events
   WHERE ts >= now() - INTERVAL 7 DAY GROUP BY event_type ORDER BY c DESC"

# the top-level payload keys of one event type, with the share of events carrying each
fp --json query run --sql \
  "SELECT k, count() c FROM events ARRAY JOIN JSONExtractKeys(payload) AS k
   WHERE event_type = 'agent_end' AND ts >= now() - INTERVAL 7 DAY
   GROUP BY k ORDER BY c DESC"

# the real values of one string key, with counts — compare only against one of these
fp --json query run --sql \
  "SELECT JSONExtractString(payload, 'outcome') v, count() c FROM events
   WHERE event_type = 'agent_end' AND ts >= now() - INTERVAL 7 DAY
   GROUP BY v ORDER BY c DESC LIMIT 30"
```

A key carried by only some events of its type is optional: read it with `.get()` and
guard the `None`. If the SQL runner refuses a function, derive the key list from real
payloads instead, one session at a time:

```bash
fp --json events --full --session-id <id> --all --limit 1000 \
  | jq '[.events[] | select(.event_type=="agent_end") | .payload | keys[]] | unique'
```

Sample several sessions and say the presence rate you observed ("in 6 of 8 sessions I
checked"), not "present". `fp list hooks`, `fp list tools` and `fp list models` give the
exact spellings of hook, tool and model names.

## Step 4 — pick the bad and good sessions

Choose both cohorts by a rule over their events, written down before you look at what the
draft scores, so the test cannot be bent toward the draft:

```bash
# sessions where the thing the evaluation is about went wrong
fp --json query run --sql \
  "SELECT session_id, countIf(event_type = 'error') errs FROM events
   WHERE ts >= now() - INTERVAL 7 DAY GROUP BY session_id
   HAVING errs > 0 ORDER BY errs DESC LIMIT 10"

# and clean ones of the same agent
fp --json query run --sql \
  "SELECT session_id FROM events WHERE ts >= now() - INTERVAL 7 DAY
   GROUP BY session_id HAVING countIf(event_type = 'error') = 0
     AND countIf(event_type = 'agent_end') > 0 ORDER BY max(ts) DESC LIMIT 10"
```

Read a session's shape with `fp --json events --session-id <id> --order asc --all --limit 1000`
(add `--full` for payloads, one session at a time).

## Then: the form does the dry run

Open the eval authoring page and paste the draft into its fields — kind, name, key,
condition, evaluator code or the jev/judge fields, labels. Its dry-run panel runs the code
on sessions you pick by id or by filter and reports what the `repair` reference calls the
backtest verdict (`broken`, `all_skipped`, `unfounded`, `constant`, `uniform`, `healthy`).
Run it on both cohorts: a draft that scores the bad and the good sessions the same has
not shown it measures anything. A jev dry run spends the org's model budget, so it waits
for you to press run; a judge cannot be dry-run before deploy at all — deploy it with a
narrow condition and read the first scores.

You can also hand the page the request instead of the draft: `?intent=<url-encoded text>`
seeds the description and starts the dashboard's own drafter, which grounds, tests and
repairs on the same rules and shows its evidence on the form. Build the link only when
`fp --json whoami` reports an `active_org`; otherwise give the user the text.

After deploy, `fp --json evals --score <key>:..0.5 --since 24h` lists the sessions it
scored low — read two or three before trusting the number.
