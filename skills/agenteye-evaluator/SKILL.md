---
name: agenteye-evaluator
description: |-
  The way to put automatic quality scores on an AI agent's production runs — both deciding what is worth measuring and building the service that measures it. Reach for it even on vague phrasing like "I want evals" or "how do I know if my agent is any good?"

  Trigger when the user wants to:
  • decide what to score — plan which dimensions to track, grounded in what real sessions show; may stop at a written plan without building anything;
  • build or change an evaluator — scaffold the scoring service, add a dimension, score with rules or an LLM judge, test it against a real captured session, deploy it and confirm scores land.

  Served by the `agenteye-evaluator` Python SDK, with the `agenteye` CLI supplying real session data to design against.

  NOT for reading eval results that already exist or checking whether quality dropped (that's `agenteye-cli` — `agenteye evals`), instrumenting an agent with the AgentEye SDK (that's `agenteye-python-sdk`), or alerting on scores.
---

# AgentEye Evaluator

An evaluator is **a small HTTP service you own**. When an agent session finishes,
the AgentEye server POSTs the whole transcript to it and you return scores.
Nothing is uploaded to AgentEye; there is no registry and no plugin system. You
run the service, AgentEye calls it.

```
agent run ends (agent_end event)
  → AgentEye server POSTs the full transcript to YOUR service
  → you return {"scores": {"helpfulness": 0.9, ...}}
  → scores land in the evaluations table → visible in the dashboard and `agenteye evals`
```

The SDK part of this is small — a decorator and two models. **The hard part is
deciding what to score**, and only the user knows that. So most of this skill is
about getting to a good answer with them before any code exists.

**Two modes.** *Plan mode* decides **what** to evaluate: work through the user's
real logs with them, converge on 2-4 dimensions, and stop at a written **eval
plan** — no code. It's a complete, valid endpoint — see `references/brainstorm.md`.
*Build mode* builds or changes the evaluator that does the scoring. Sections 1-5 are
the design loop both modes share; 6-12 are the build, and can be seeded by a plan
that brainstorm mode produced.

## 1. Work in the repo that holds the evaluator

The evaluator gets built into an image and deployed as a long-running service, so
it needs a real home — not a scratch file. Before writing anything, figure out
where it lives:

1. **Look for one** in or under the working directory: something importing
   `agenteye_evaluator`, or a function decorated `@app.evaluator`.
   `grep -rl "agenteye_evaluator" .` is usually enough.
2. **If you don't find one, ask** — don't assume it doesn't exist. Evaluators
   often live in their own repo, separate from the agent being scored. "Do you
   already have an evaluator service somewhere, or should I set one up here?"
3. **Only then scaffold.** `references/scaffold.md` has the project template and,
   importantly, the install ladder — the SDK is **not** on public PyPI, so
   `pip install agenteye-evaluator` is the one thing you must not blindly run.

If they already have an evaluator, you're adding a dimension to working code:
read it first and match what's there rather than rewriting it.

## 2. Interview before you write

*This is the compressed design loop the build path uses. When the goal is only to
decide what to measure — no code yet — use the fuller, collaborative procedure in
`references/brainstorm.md` and stop at its plan.*

Resist jumping to code. A skilled guess at what to measure is still a guess, and
an evaluator that scores the wrong thing is worse than none — it produces a
dashboard people learn to ignore.

Ask a few questions that actually change the answer (pick what fits; this isn't a
form to march through):

- **What does this agent do, and for whom?** A support bot, a coding agent, and a
  research agent fail in completely different ways.
- **Describe a run that went well. Now one that went badly.** This is the
  highest-yield question by far — the gap between those two stories *is* the eval.
- **If you could see one number per run, what would it be?**
- **What would make you roll back a release?** Surfaces the thing they actually
  care about, which is often not the thing they named first.

**Listen for the failure in their words, not for metric names.** "It made stuff
up" → factuality. "It kept calling the same tool over and over" → tool
efficiency. "It gave up and told the user to contact support" → deflection. If
they open with a metric name — "we want accuracy" — ask what an inaccurate run
looks like, because accuracy means six different things and you can't compute a
word.

## 3. Ground the interview in real sessions

The interview tells you what they *intend*; the transcripts tell you what
*happens*. You need both, and they usually disagree.

Pull real sessions — `references/session-data.md` covers how, and it matters more
than it looks: the obvious way to build a session fixture is subtly wrong, and
there's a purpose-built endpoint that gives you byte-identical bytes to what your
evaluator will actually receive.

Read 3-5 sessions end to end, including at least one the user calls bad. You're
answering one question per candidate dimension:

> **Is the signal actually in the transcript?**

This kills more dimensions than anything else. "Did the customer come back next
week" is a great metric and is not in the events. "Was the answer correct" may
need a ground truth that doesn't exist. What *is* there: what tools ran and in
what order, what the model said, what errored, how long it took, how it ended.

## 4. Reconcile, then propose 2-4 dimensions

Come back with the two halves joined: *"You said you care about X. Your sessions
show Y. So I'd score these three things."*

Aim for **2-4 dimensions**. Each one is a number a human reads on a dashboard;
past four they stop reading and the eval stops changing decisions. Every proposal
must pass two tests:

- **Computable** from `req.events` alone.
- **Discriminating** — it separates the good session from the bad one the user
  showed you. A dimension that scores 0.9 on both teaches nothing. Check this
  against the real sessions *before* proposing, not after.

Score keys are arbitrary strings; the platform stores and trends whatever you
send. That's freedom, but it means nothing downstream will correct a bad choice —
so **get explicit sign-off on the dimension names before writing code**. Renaming
later splits the history: old sessions keep the old key and the trend breaks.

## 5. The `EvalRequest` contract

What lands in your function (full detail in `references/sdk-api.md`):

| field | notes |
|---|---|
| `events` | `list[AgentEvent]`, chronological. The transcript. This is the one you score from. |
| `session_id` / `agent_id` / `environment` | Identity. Useful for routing logic or per-env thresholds. |
| `started_at` | First event's timestamp. |
| `ended_at` | **`None` is normal — don't rely on it.** |

Two things that surprise people:

- **`ended_at` is the `agent_end` timestamp, or `None`.** It is *not* "when the
  session stopped". Sessions that never emit `agent_end` get evaluated anyway, by
  an inactivity scanner, and arrive with `ended_at: None`. If you compute
  duration as `ended_at - started_at`, you crash on a real and common case — use
  the last event's `ts` instead.
- **`payload` is the entire raw event JSON, flattened** — not a nested sub-object.
  So it's `e.payload.get("tool_name")`, not `e.payload["input"]["tool_name"]`, and
  `payload["type"]` duplicates `event_type`. The per-event-type keys are tabulated
  in `references/session-data.md`.

## 6. Write the scorer — rules before judges

Start with the cheapest thing that separates the good session from the bad one.
Counting and ratios over `req.events` are free, instant, deterministic, and
testable — and for tool-loops, error rates, deflection, and "did it ever finish",
they're genuinely as good as anything an LLM will tell you.

`deploy/examples/evaluator/evaluator.py` in the AgentEye repo is the reference
implementation; mirror its shape:

```python
import os
from agenteye_evaluator import EvalRequest, EvalResponse, Evaluator

app = Evaluator(token=os.environ.get("EVALUATOR_TOKEN"))

@app.config
def config():
    # Backstop for sessions that never emit agent_end. Without this, they're
    # never scored. A plain dict is fine — EvaluatorConfig isn't required.
    return {"inactivity_timeout_secs": 1800}

@app.evaluator
def evaluate(req: EvalRequest) -> EvalResponse:
    tool_uses = [e for e in req.events if e.event_type == "tool_use"]
    distinct = {e.payload.get("tool_name") for e in tool_uses}
    score = len(distinct) / len(tool_uses) if tool_uses else 1.0
    return EvalResponse(
        scores={"tool_efficiency": round(score, 2)},
        reasoning={"tool_efficiency": f"{len(distinct)} distinct of {len(tool_uses)} calls."},
        summary=f"{len(req.events)} events, {len(tool_uses)} tool calls.",
    )
```

**Always return `reasoning` alongside `scores`.** A bare number sends whoever
reads the dashboard back to the raw transcript to find out why; one sentence per
dimension is what makes the score actionable. It's optional in the API and
mandatory in practice.

## 7. Test against a real session

The decorators return the function unchanged, so it stays directly callable — no
HTTP needed for the interesting tests:

```python
req = EvalRequest.model_validate_json(open("fixtures/session-abc.json").read())
assert evaluate(req).scores["tool_efficiency"] == 1.0
```

Use `TestClient(app.app)` only when you're testing the wire layer (auth, status
codes). For scoring logic, call the function.

**Know how your fixture lies.** A captured session is real data, which makes it
tempting to trust completely. Two gaps to keep in mind: a session whose payload
failed to parse arrives as `payload: null` and will 422 your evaluator, but the
CLI coerces that to `{}` so it can never show up in a CLI-built fixture. And a
CLI-reconstructed fixture is an approximation of the real body — the export
endpoint isn't (`references/session-data.md`).

Test the empty session (`events: []`) and the `ended_at: None` session. Both are
real, both are common, and both are where evaluators crash.

## 8. LLM-as-judge: the 30-second wall

For anything subjective — was the answer correct, was the tone right, did it
follow policy — rules run out and you want a model to read the transcript. That's
a good instinct, but a synchronous judge collides with the dispatcher's limits:

| limit | value | why it bites |
|---|---|---|
| request timeout | **30s** | The server gives up on your POST. |
| concurrency | **8** (2 workers × 4 claim batch) | The whole deployment's budget, not per-agent. |
| retries | **5×**, exponential backoff | A 5xx or timeout is retried — including yours. |

**Return `JobPending` once the judge isn't reliably under 30s — switch at p99
above ~15-18s**, not at 29s. The failure when you don't is worse than a slow
score:

1. At 30s the server cancels its side. **Your judge keeps running and you still
   pay for it.** Nobody reads the result.
2. The timeout is transient, so it's **retried 5×** — the same judge runs five
   times, five times the cost, and the session still ends with zero scores.
3. That call held 1 of only 8 slots for 30s. Do this at volume and you
   head-of-line-block scoring for every agent in the deployment.

Throughput ceiling is roughly 8 ÷ your latency — about 1150 sessions/hour at 25s
each. If they're scoring more than that, sync is off the table regardless.

## 9. Going async: `JobPending` + `@app.job_lookup`

Return the job immediately, do the work elsewhere, answer polls:

```python
@app.evaluator
def evaluate(req):
    job_id = enqueue(req)              # hand off to a worker/queue
    return JobPending(job_id=job_id, next_poll_secs=15)

@app.job_lookup
def lookup(job_id):
    row = store.get(job_id)            # O(1) — see below
    if row is None or row.running:
        return JobPending(job_id=job_id)   # "still working"
    return EvalResponse(scores=row.scores)
```

Two traps:

- **The poll GET shares the same 30s timeout.** `@app.job_lookup` must be a cheap
  lookup that never blocks on the judge. If it waits for the result, you've
  rebuilt the synchronous problem with extra steps.
- **In-process job state breaks under replicas.** The poll can land on a
  different pod than the POST did, and the deploy example scales `replicas`.
  Job state belongs somewhere shared — Redis, a table, anything both pods see.

Without `@app.job_lookup` registered, polls get a 404 and the evaluation never
completes. Only register it if you return `JobPending`.

## 10. Errors: what's retried, what's terminal

This is the SDK's sharpest edge and it isn't in the README. **Raising an
exception is not how you report a failed evaluation.** An exception becomes a
generic HTTP 500, the server reads 5xx as transient, and it retries — five times,
re-billing your judge each time, before giving up with no scores.

To fail *terminally*, return a raw dict — there's no typed model for it, and
`EvalResponse`/`JobPending` can't express it:

```python
return {"status": "error", "error": "model service unavailable"}   # non-empty str, required
```

| you return / do | server sees | outcome |
|---|---|---|
| `EvalResponse(...)` | `done` | scores stored |
| `JobPending(job_id=...)` | `pending` | polled until done |
| `{"status": "error", "error": "…"}` | `error` | **terminal**, recorded, not retried |
| `raise SomeError(...)` | 500 | **retried 5×**, then terminal with no scores |

So: retry-worthy blips (a 429 from your model provider) — let them raise.
Permanent failures (unparseable transcript, missing config) — return the error
dict. Anything over 25 MiB gets a 413 before your code runs; that's terminal too.

## 11. Deploy: two env vars on the server

There is nothing to upload. AgentEye starts calling your evaluator when the
**server** has:

```bash
EVALUATOR_ENDPOINT=http://evaluator:9000   # unset => the whole pipeline is a no-op
EVALUATOR_TOKEN=<shared-secret>            # must be byte-identical on both sides
```

Then restart the server. Notes worth knowing before you debug:

- **Unset `EVALUATOR_ENDPOINT` means silence, not error.** No warning, no scores.
  It's the first thing to check when nothing lands.
- **A token mismatch fails fast, not loudly** — 401 is a 4xx, so it's terminal
  and never retried.
- **One evaluator per deployment.** No per-agent routing. If different agents need
  different scoring, branch on `req.agent_id` inside your evaluator.
- `references/scaffold.md` has the container setup. Don't copy the Dockerfile from
  `deploy/examples/evaluator/` — it installs the SDK from monorepo source, which
  only works inside the AgentEye repo.

## 12. Confirm it worked

Scores landing is the only proof. After deploying, finish a session and check:

```bash
agenteye --json evals --session-id <id>     # your scores, or status=error/timeout
agenteye --json evals --aggregate --since 24h
```

If a session shows `status: error` or `timeout`, the `error` field carries your
message (the one from the error dict — exceptions never reach it). Reading
existing scores from here on is the `agenteye-cli` skill's job.

**Debug order when nothing appears:** is `EVALUATOR_ENDPOINT` set on the server →
did the session emit `agent_end` (or does `@app.config` return
`inactivity_timeout_secs`) → does the server reach your service → do the tokens
match.

<!-- ci: no-op touch to exercise the skill-sync trigger (safe to remove) -->
