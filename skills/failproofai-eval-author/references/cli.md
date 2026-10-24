# Authoring and deploying evaluators with `fp`

For a coding agent on the user's machine, with `fp` pointed at their organisation.
Use `fp evaluators` for definitions and authoring; `fp evals` reads results, not
definitions. Put global options first: `fp --json evaluators list --all`.

## Preflight and permissions

Run `fp --json whoami` and check `logged_in`, `auth_mode`, the selected organisation
and permissions — a signed-out `whoami` still exits successfully. Reads of sessions
and results need `evaluations:read`. Authoring, deployment, toggles and compile-only
dry runs need `evaluations:trigger`; schema profiling and session dry runs also
need `events:read`. SQL needs `queries:run`.

If not authenticated, run `fp login`; a person supplies the emailed one-time code.
For API-key authoring, ask an authorised operator for the **standard** key preset,
which includes `evaluations:trigger`, `events:read` and `evaluations:read`.
The read-only and machine presets are not authoring keys. If a signed-in member
lacks `evaluations:trigger`, an org admin must grant it; logging in again does not
add permissions.

Only if authentication is unavailable or `evaluations:trigger` is missing, hand
over the source/spec to paste into the dashboard's evaluation-authoring form,
along with the login or permission fix. Do not treat API-key mode as a reason to
stop authoring: only AI drafting requires a signed-in session.

Every new command supports `--json`. On an older Cloud, a 404 prints
`not available on this FailproofAI Cloud yet` and exits 6. Report that compatibility
limit and stop that operation; do not pretend a definition was created.

## Ground it, write it, test it, then create it

1. `fp --json evaluators list --all` — include disabled versions before proposing
   a duplicate. `fp --json evaluators show <eval_key>@<version>` includes its source.
2. `fp --json evaluators schema` — read the sampled event types, payload keys,
   presence rates and values. Confirm low-frequency fields on real sessions:
   `fp --json events --full --session-id <id> --all --limit 1000`.
3. Write restricted Python or a judge/Jev spec. Code is **one expression**
   returning `EvalResult`, not a function or a Python module. Follow the Python
   surface, grounding and result-contract references.
4. For code/Jev, `fp evaluators dry-run` with no `--session` checks compilation;
   add repeated `--session <id>` for execution on **at most 10 sessions**. Choose
   clearly bad and clearly good cohorts independently of the draft, and repair
   using the verdicts in `references/repair.md`. A Jev run spends model budget:
   obtain consent before running it.
5. Show the exact definition and get the user's OK before
   `fp evaluators create`. Creation enables it by default; `--disabled` stages a
   definition without enabling it. Deployment is a separate decision from drafting.
6. Read `fp --json evals --score <key>:..0.5 --since 24h`, then
   `fp --json sessions history <session_id>` for individual results. Read actual
   sessions before trusting an aggregate.

Use `fp query compose "<question>"` to draft grounding SQL in session mode;
without `--run` it only prints SQL. With a key, use `fp query schema` and
`fp query run --sql "…"` instead. For JSON-string payloads use
`JSONExtractString(payload, 'outcome')`, not Postgres JSON operators.

## Complete examples

These examples need `fp` and `jq`, an authenticated organisation with the
permissions above, and real sessions. Each chooses one recent session as a
starting sample: check that it is finished and meets the condition, then repeat
the dry run on your independently chosen good and bad cohorts. An empty sample
is an error, not a successful test. Run creation only after the user approves;
the example keys/versions must not already exist.

Model-backed dry runs and `fp sessions re-evaluate` when it invokes judge/Jev
evaluators **spend the organisation's model budget**. A coding agent must ask the
user before running them; approval to create a definition is not approval for
these additional model calls.

All flag-based examples use **inline `--condition EXPR`**, passing the expression
as one quoted shell argument via `"$FP_CONDITION"`. The CLI also permits
`--condition @file`, but these examples consistently use the inline form.
With `--file spec.json`, `condition_source` contains the expression itself,
not an `@file` reference.

### Code — fraction of events without an error

This uses only the event vocabulary and session counts, with no invented payload
keys. A healthy session scores higher. The guard covers an empty session and
the condition skips it.

```bash
fp --json evaluators schema
FP_SESSION_ID=$(fp --json sessions --since 7d --limit 1 | jq -er '.sessions[0].session_id')
: "${FP_SESSION_ID:?Choose a finished session before testing}"
FP_CONDITION='session.event_count > 0'
cat > error_free_events.py <<'PY'
EvalResult(score=Score(round(1 - session.count("error") / session.event_count, 4) if session.event_count else 0.0), reasoning="Fraction of recorded events without an error.")
PY
fp evaluators dry-run --code error_free_events.py --result-kind score \
  --condition "$FP_CONDITION" --session "$FP_SESSION_ID"
fp evaluators create --key error_free_events --name "Error-free events" \
  --version 1 --label reliability --condition "$FP_CONDITION" \
  --code error_free_events.py --result-kind score --timeout 30
fp --json evals --score error_free_events:..0.5 --since 24h
```

### LLM judge — answer grounded in the conversation

A judge **cannot be dry-run**, including compile-only. Do not supply
`--dry-run-on` for it. Instead create with a narrow, grounded condition and inspect
the first results. `fp sessions re-evaluate` runs the session's applicable
evaluators, including the judge, and spends the org's model budget. Ask the user
before running it, separately from approval to create the definition.
Steps describe continuous scoring, never "score zero/one" or numeric grades.

```bash
fp --json evaluators schema
FP_SESSION_ID=$(fp --json sessions --since 7d --limit 1 | jq -er '.sessions[0].session_id')
: "${FP_SESSION_ID:?Choose a finished conversational session}"
FP_CONDITION=$(jq -nr --arg session "$FP_SESSION_ID" '"session.session_id == \($session|tojson)"')
fp evaluators create --key answer_grounding --name "Answer grounding" \
  --version 1 --label correctness --condition "$FP_CONDITION" \
  --judge --criteria "The answer must be supported by the visible conversation and tool results, and state uncertainty when evidence is missing." \
  --step "Identify factual claims in the final answer and the evidence available in the conversation." \
  --step "Check whether each claim is supported by that evidence." \
  --step "Award a high score for supported claims and explicit uncertainty where evidence is missing." \
  --step "Award a low score for unsupported claims presented as facts." \
  --threshold 0.7
# Ask the user before running this: the judge call spends the org's model budget.
fp sessions re-evaluate "$FP_SESSION_ID"
fp --json evaluators jobs
fp --json evals --score answer_grounding:..0.5 --since 24h
```

This condition restricts the judge to the chosen session; confirm it has a
visible conversation first. After validating the result, deploy a new version
with a condition for the intended conversational agent/environment.
Re-evaluation queues work; wait for completion before expecting new results.

### Jev noul — polite answer

`noul` returns the probability of **true**. Make true the healthy outcome so a
high score passes. Both Jev kinds always produce `result_kind: score`, not an
assertion or metric; the CLI supplies this for `--jev` and `--judge`.
The Jev session dry run below spends the organisation's model budget. As a
coding agent, ask the user before running it, even though nothing is deployed yet.

```bash
fp --json evaluators schema
FP_SESSION_ID=$(fp --json sessions --since 7d --limit 1 | jq -er '.sessions[0].session_id')
: "${FP_SESSION_ID:?Choose a finished conversational session before testing}"
FP_CONDITION="session.count('model_response') > 0"
cat > polite_answer.json <<'JSON'
{
  "eval_key": "polite_answer",
  "display_name": "Polite answer",
  "eval_version": "1",
  "result_kind": "score",
  "labels": ["quality"],
  "condition_source": "session.count('model_response') > 0",
  "evaluator_source": "{\"kind\":\"jev\",\"type\":\"noul\",\"instructions\":\"Did the assistant remain polite in its replies?\",\"criteria\":{\"true\":\"The assistant remained respectful, including when declining a request.\",\"false\":\"The assistant insulted, mocked or belittled the user.\"},\"threshold\":0.7}",
  "timeout_seconds": null
}
JSON
# Ask the user before running this model-backed dry run.
fp evaluators dry-run --jev noul \
  --instructions "Did the assistant remain polite in its replies?" \
  --true "The assistant remained respectful, including when declining a request." \
  --false "The assistant insulted, mocked or belittled the user." \
  --threshold 0.7 --condition "$FP_CONDITION" \
  --session "$FP_SESSION_ID"
fp evaluators create --file polite_answer.json
fp --json evals --score polite_answer:..0.5 --since 24h
```

### Jev score — degree of answer grounding

The rubric is **3–5 distinct levels, worst to best**; reversing it inverts the
score. Distinctness is checked after trimming and case-folding. The levels below
describe observable states, not just "bad / OK / good".
This Jev session dry run also spends the organisation's model budget; ask the
user before running it.

```bash
fp --json evaluators schema
FP_SESSION_ID=$(fp --json sessions --since 7d --limit 1 | jq -er '.sessions[0].session_id')
: "${FP_SESSION_ID:?Choose a finished conversational session before testing}"
cat > grounding_quality.json <<'JSON'
{
  "eval_key": "grounding_quality",
  "display_name": "Grounding quality",
  "eval_version": "1",
  "result_kind": "score",
  "labels": ["correctness"],
  "condition_source": "session.count('model_response') > 0",
  "evaluator_source": "{\"kind\":\"jev\",\"type\":\"score\",\"instructions\":\"How well is the assistant's answer grounded in the visible conversation and tool results?\",\"criteria\":[\"The answer contradicts the available evidence or invents its central claims.\",\"The answer mixes supported claims with substantial unsupported claims.\",\"The central claims are supported, with minor unsupported details.\",\"All factual claims are supported, and missing evidence is explicitly acknowledged.\"],\"threshold\":0.7}",
  "timeout_seconds": null
}
JSON
# Ask the user before running this model-backed dry run.
fp evaluators dry-run --file grounding_quality.json --session "$FP_SESSION_ID"
fp evaluators create --file grounding_quality.json
fp --json evals --score grounding_quality:..0.5 --since 24h
```

For direct Jev flags, the equivalents are `--jev noul --instructions TEXT
--true TEXT --false TEXT --threshold 0.7` and `--jev score --instructions TEXT
--level TEXT --level TEXT --level TEXT --threshold 0.7`.
All judge/Jev thresholds must be **0–1**.

## AI drafting and spec files

With a signed-in session:

```bash
fp evaluators draft "Fraction of recorded events without an error; key error_free_events, score, label reliability." \
  --kind code --out error_free_events.json
fp evaluators dry-run --file error_free_events.json
# Inspect the spec, then test good and bad sessions before approving creation.
fp evaluators create --file error_free_events.json
```

`draft` composes a spec, not a deployment. In API-key mode it exits 2 with
`fp evaluators draft` needs a signed-in session: run `fp login`.
You can still write a spec yourself and use `create`/`deploy --file` with the key.

The spec is the API body, not the dashboard drafter's form object:
`eval_key`, `display_name`, `eval_version`, `result_kind`, `labels`,
`condition_source`, `evaluator_source`, `timeout_seconds`. Omit an unused condition
or use `null`, not an empty string. Judge/Jev `evaluator_source` is a **JSON
envelope string**, not a nested object; the examples above show the encoding.
Judge envelopes carry `kind`, `criteria`, `steps`, `threshold`; Jev envelopes
carry `kind`, `type`, `instructions`, `criteria`, `threshold`.

## New versions, controls and backfill

Versions are immutable. To revise a key, publish a new version, not an in-place
source edit:

```bash
FP_CONDITION='session.event_count > 0'
fp evaluators deploy error_free_events --version 2 --code error_free_events.py \
  --result-kind score --condition "$FP_CONDITION" --backfill 7d
fp --json evaluators show error_free_events@2
fp --json evaluators list --key error_free_events --all
```

`deploy` creates the new version first, then disables older enabled versions of
the same key. Verify both steps: a partial failure is not a completed replacement.
`create` alone does not disable older versions. For a drafted replacement use
`fp evaluators deploy <eval_key> --file spec.json` with a new `eval_version`.

`fp evaluators enable <eval_key>@<version>` and
`fp evaluators disable <eval_key>@<version>` toggle a definition;
`fp evaluators label <eval_key>@<version> --add reliability --remove quality`
changes labels without rewriting source. `fp evaluators instances` and
`fp evaluators jobs` expose managed-instance and job status.

Historical backfill supports **code, Jev and judge** evaluations, over a window of
at most **90 days**. Count first, then score, as separate steps:

```bash
fp --json evaluators backfill --from 2026-10-18T00:00:00Z --to 2026-10-25T00:00:00Z \
  --key error_free_events --dry-run     # free: how many (session, evaluator) pairs are missing
fp evaluators backfill --from 2026-10-18T00:00:00Z --to 2026-10-25T00:00:00Z \
  --key error_free_events               # queues them; confirms first on a terminal
```

Without `--key` it covers every enabled evaluator. `deploy … --backfill 7d` (1d–90d)
does the same for the new version right after publishing. **Judge and Jev backfills
spend the org's model budget** (the CLI warns), so run the `--dry-run` count, show it
to the user and get a separate OK; approval to deploy is not approval to score
history. Publishing alone never starts paid history. The dashboard's **score past
sessions** panel does the same.

Backfill fills missing session/key pairs and preserves existing results and
terminal assignments, even after a new version is published. Conditions run in
the worker and may skip candidates. Repeat the count to continue a range with
more than 5,000 missing sessions or retry sessions that could not be queued;
`fp --json evaluators jobs` shows the queued work.

For an explicit re-run of an individual historical session, use
`fp sessions re-evaluate <session_id>` with consent for model spend, then read
its history. That re-runs the session's applicable evaluators, not just the key
you are authoring, and appends results rather than filling only missing pairs.
