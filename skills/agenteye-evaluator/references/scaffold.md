# Scaffolding an evaluator project

Templates for standing up a new evaluator service. Adapt them — they're a
starting point, not a spec. If the user already has an evaluator, don't scaffold:
read their code and match it.

## Contents

- [Installing the SDK — the ladder](#installing-the-sdk--the-ladder)
- [Project layout](#project-layout)
- [`evaluator.py`](#evaluatorpy)
- [`tests/test_evaluator.py`](#teststest_evaluatorpy)
- [`pyproject.toml`](#pyprojecttoml)
- [`Dockerfile`](#dockerfile)
- [Running it](#running-it)
- [Wiring it to AgentEye](#wiring-it-to-agenteye)

## Installing the SDK — the ladder

**`pip install agenteye-evaluator` from public PyPI is not the install path.**
The package is published only as a private release artifact — there is no PyPI
publish step. Worse, the name is unclaimed on public PyPI, so an unqualified
install could pull a stranger's package. Work down this ladder and stop at the
first rung that applies:

1. **Inside the AgentEye monorepo** (there's an `evaluator-sdk/` directory):
   ```bash
   pip install ./evaluator-sdk
   ```
   Tracks the SDK on the current branch. This is what the in-repo examples do.

2. **From the private release** — wheels are attached to GitHub Releases on
   `agenteye-enterprise/releases`, tagged `evaluator-sdk/v<version>`:
   ```bash
   gh release download evaluator-sdk/v<version> \
     --repo agenteye-enterprise/releases --pattern '*.whl'
   pip install ./agenteye_evaluator-*.whl
   ```
   Needs `gh auth login` and access to that private repo.

3. **Neither works** → stop and tell the user to ask their Failproof AI contact
   for the wheel. Don't improvise an install; a wrong package here is a supply-chain
   problem, not a typo.

`uvicorn` is not an SDK dependency — install it alongside: `pip install 'uvicorn[standard]'`.

## Project layout

```
my-evaluator/
├── evaluator.py           # the service
├── tests/
│   └── test_evaluator.py
├── fixtures/              # real sessions pulled from AgentEye (see session-data.md)
│   └── run-001.json
├── pyproject.toml
├── Dockerfile
└── .env.example           # EVALUATOR_TOKEN=...  (never commit the real one)
```

Fixtures are real production transcripts. Before committing them, check with the
user whether that's OK — they can contain customer data. If in doubt, keep
`fixtures/` out of git and have each developer pull their own.

## `evaluator.py`

Starter with one deterministic dimension. Replace it with the dimensions the user
actually signed off on — this is scaffolding, not a recommendation of what to score.

```python
"""Evaluator service for <agent>. Scores each finished session."""
from __future__ import annotations

import os

from agenteye_evaluator import EvalRequest, EvalResponse, Evaluator

app = Evaluator(token=os.environ.get("EVALUATOR_TOKEN"))


@app.config
def config():
    # Sessions that never emit `agent_end` are only ever scored if we advertise
    # this: it tells the server how long to wait before evaluating an idle
    # session. Without it, a crashed run is silently never scored.
    return {"inactivity_timeout_secs": 1800}


@app.evaluator
def evaluate(req: EvalRequest) -> EvalResponse:
    events = req.events
    tool_uses = [e for e in events if e.event_type == "tool_use"]
    errors = sum(1 for e in events if e.event_type == "error")

    # Repeating an identical call is the signature of a stuck agent: score the
    # ratio of distinct calls to total.
    if tool_uses:
        distinct = {(e.payload.get("tool_name"), str(e.payload.get("input"))) for e in tool_uses}
        efficiency = round(len(distinct) / len(tool_uses), 2)
        why = f"{len(distinct)} distinct of {len(tool_uses)} tool call(s)."
    else:
        efficiency = 1.0
        why = "no tool calls — nothing to repeat."

    return EvalResponse(
        scores={"tool_efficiency": efficiency},
        reasoning={"tool_efficiency": why},
        summary=f"{len(events)} event(s), {len(tool_uses)} tool call(s), {errors} error(s).",
    )
```

## `tests/test_evaluator.py`

The decorators return the function unchanged, so test the scoring logic by
calling it directly — no HTTP, no client.

```python
import pytest
from agenteye_evaluator import EvalRequest

from evaluator import evaluate


def make_req(events, ended_at=None):
    return EvalRequest.model_validate({
        "schema_version": "1",
        "session_id": "t", "agent_id": "a", "environment": "test",
        "started_at": "2026-01-01T00:00:00Z", "ended_at": ended_at,
        "events": events,
    })


def event(i, event_type, **payload):
    return {"id": i, "ts": f"2026-01-01T00:00:{i:02d}Z",
            "event_type": event_type, "payload": {"type": event_type, **payload}}


def test_repeated_tool_calls_score_low():
    events = [event(i, "tool_use", tool_name="search", input={"q": "x"}) for i in range(4)]
    assert evaluate(make_req(events)).scores["tool_efficiency"] == 0.25


def test_distinct_tool_calls_score_high():
    events = [event(i, "tool_use", tool_name=f"t{i}", input={"q": i}) for i in range(4)]
    assert evaluate(make_req(events)).scores["tool_efficiency"] == 1.0


def test_empty_session_does_not_crash():
    assert evaluate(make_req([])).scores["tool_efficiency"] == 1.0


def test_session_without_agent_end():
    # ended_at is None for every session the inactivity scanner picks up —
    # the common case, not an edge case.
    assert evaluate(make_req([event(1, "tool_use", tool_name="s")], ended_at=None)).scores


@pytest.mark.skipif(not __import__("pathlib").Path("fixtures/run-001.json").exists(),
                    reason="no fixture pulled yet")
def test_real_session():
    req = EvalRequest.model_validate_json(open("fixtures/run-001.json").read())
    scores = evaluate(req).scores
    assert 0.0 <= scores["tool_efficiency"] <= 1.0
```

Use `TestClient(app.app)` only for wire-level concerns (auth, status codes):

```python
from fastapi.testclient import TestClient
from evaluator import app

def test_health_is_open():
    assert TestClient(app.app).get("/health").status_code == 200
```

`TestClient` needs starlette's HTTP client, which the SDK doesn't pull in and
which **changed name across versions** — older starlette wants `httpx`, current
starlette wants `httpx2`, and importing `TestClient` without the right one raises
a `RuntimeError` naming the package it wants. Install whichever it asks for. This
is a good reason to keep wire-level tests to a minimum: the scoring tests above
need neither.

## `pyproject.toml`

```toml
[project]
name = "my-evaluator"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "agenteye-evaluator",      # installed via the ladder above, not from public PyPI
    "uvicorn[standard]>=0.30",
]

[project.optional-dependencies]
# Testing the scoring function needs nothing but pytest. TestClient additionally
# needs starlette's HTTP client — see the note under the TestClient snippet above.
dev = ["pytest>=8"]

# evaluator.py sits at the project root, so pytest needs the root on sys.path to
# import it from tests/. Without this, `from evaluator import evaluate` fails
# with ModuleNotFoundError.
[tool.pytest.ini_options]
pythonpath = ["."]
```

Pin `agenteye-evaluator` however your install path dictates — a wheel path, a
private index, or a vendored copy. Leaving it as a bare public dependency is the
one thing to avoid.

## `Dockerfile`

**Don't copy the one from `deploy/examples/evaluator/`** — it does
`COPY evaluator-sdk /app/evaluator-sdk`, which only works inside the AgentEye
monorepo. Bring the wheel in instead:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Ship the wheel alongside the build context (rung 2 of the install ladder).
COPY wheels/ /tmp/wheels/
RUN pip install --no-cache-dir /tmp/wheels/agenteye_evaluator-*.whl \
    && pip install --no-cache-dir 'uvicorn[standard]>=0.30' \
    && rm -rf /tmp/wheels

COPY evaluator.py /app/

# Non-root so the image satisfies a Kubernetes runAsNonRoot policy.
RUN useradd -u 10001 -m app
USER 10001

EXPOSE 9000
CMD ["uvicorn", "evaluator:app", "--host", "0.0.0.0", "--port", "9000"]
```

## Running it

```bash
EVALUATOR_TOKEN=dev-secret uvicorn evaluator:app --host 0.0.0.0 --port 9000

curl -s localhost:9000/health                                    # open, no auth
curl -s -H "Authorization: Bearer dev-secret" localhost:9000/config
curl -s -H "Authorization: Bearer dev-secret" -H 'Content-Type: application/json' \
     --data @fixtures/run-001.json localhost:9000/evaluate        # replay a real session
```

That last call is the highest-value check you can run: a real transcript through
the real wire path, before anything is deployed.

## Wiring it to AgentEye

Nothing is uploaded. The **AgentEye server** needs two env vars and a restart:

```bash
EVALUATOR_ENDPOINT=http://evaluator:9000
EVALUATOR_TOKEN=dev-secret          # byte-identical to the evaluator's
```

Then finish a session and confirm the scores landed:

```bash
agenteye --json evals --session-id <id>
```

If nothing appears, work down: is `EVALUATOR_ENDPOINT` set on the server (unset is
a silent no-op) → did the session emit `agent_end`, or does `@app.config` return
`inactivity_timeout_secs` → can the server reach your host/port → do the tokens
match (a mismatch is a 401, which is terminal and never retried).
