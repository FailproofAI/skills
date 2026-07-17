# `agenteye-evaluator` API reference

The SKILL.md body has the workflow and the design loop; this is the flag-level
contract. Read it when you need an exact signature, field, or status shape.

## Contents

- [Exports](#exports)
- [`Evaluator`](#evaluator)
- [The three decorators](#the-three-decorators)
- [Models](#models)
- [Return shapes and coercion](#return-shapes-and-coercion)
- [HTTP routes](#http-routes)
- [Wire format](#wire-format)
- [Server-side dispatch: what calls you, and how](#server-side-dispatch-what-calls-you-and-how)
- [Server env vars](#server-env-vars)
- [Logging](#logging)

## Exports

Everything public comes from the top-level package. Anything under
`agenteye_evaluator._models` / `._server` is private and may move.

```python
from agenteye_evaluator import (
    AgentEvent, EvalRequest, EvalResponse, EvaluatorConfig, Evaluator, JobPending, __version__,
)
```

Package name `agenteye-evaluator`, import name `agenteye_evaluator`. Requires
Python ≥ 3.10. Depends on `fastapi`, `pydantic>=2`, `structlog`. **`uvicorn` is
not a dependency** — install it yourself to serve the app.

## `Evaluator`

```python
Evaluator(token: str | None = None, *, title: str = "AgentEye Evaluator")
```

- `token` — the shared secret. Compared with `hmac.compare_digest`. **`token=None`
  disables auth entirely**, which is fine locally and a hole in production.
- `title` — keyword-only; FastAPI app title, cosmetic.

Attributes: `.app` is the underlying `FastAPI` instance (use it for
`TestClient(app.app)`). The `Evaluator` itself is an ASGI callable, so
`uvicorn evaluator:app` works directly.

## The three decorators

Each returns the function **unchanged**, so decorated functions stay directly
callable — that's what makes unit tests cheap. Each accepts a **sync or async**
function. Each raises `ValueError` if registered twice.

| decorator | serves | required? |
|---|---|---|
| `@app.evaluator` | `POST /evaluate` | Yes — this is the evaluator. |
| `@app.job_lookup` | `GET /evaluate/{job_id}` | Only if you ever return `JobPending`. Absent → polls get **404**. |
| `@app.config` | `GET /config` | No, but see `inactivity_timeout_secs` below. |

```python
EvalReturn  = Union[EvalResponse, JobPending, dict]
EvaluatorFn = Callable[[EvalRequest], Union[EvalReturn, Awaitable[EvalReturn]]]
JobLookupFn = Callable[[str], Union[EvalReturn, Awaitable[EvalReturn]]]
ConfigFn    = Callable[[], Union[EvaluatorConfig, dict, Awaitable[...]]]
```

## Models

All models set `extra="ignore"`, so unknown keys are dropped rather than
rejected. That's why a CLI event dict validates straight into `AgentEvent`.

```python
class AgentEvent(BaseModel):
    id: int
    ts: datetime
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)

class EvalRequest(BaseModel):
    schema_version: str
    session_id: str
    agent_id: str
    environment: str
    started_at: datetime
    ended_at: datetime | None = None
    events: list[AgentEvent] = Field(default_factory=list)

class EvalResponse(BaseModel):
    scores: dict[str, float] | None = None
    reasoning: dict[str, str] | None = None
    summary: str | None = None

class JobPending(BaseModel):
    job_id: str
    next_poll_secs: int | None = None

class EvaluatorConfig(BaseModel):
    inactivity_timeout_secs: int | None = None
    default_poll_interval_secs: int = 10
```

Field notes that bite:

- **`ended_at` is the `agent_end` event's timestamp, or `None`.** Not "when the
  session stopped". Sessions evaluated by the inactivity scanner never had an
  `agent_end`, so they arrive `None`. Deriving duration from it crashes on real data.
- **`payload` is the whole event JSON flattened** — event-specific fields sit at
  the top level, and `payload["type"]` duplicates `event_type`. Keys per event
  type are in `session-data.md`.
- **`payload` typed as `dict` rejects an explicit `null`.** The default only
  applies to a *missing* key. A server-side unparseable payload serializes as
  `null` → 422 → terminal. Rare, and not something your code can prevent.
- `scores` keys are arbitrary; the platform trends whatever you send.
- **`summary` is truncated at 8192 bytes** server-side (`last_error` at 2048).
- Serialization uses `exclude_none`, so unset fields are omitted, not `null`.

## Return shapes and coercion

Your function may return one of exactly three things. Anything else is a
`TypeError` → HTTP 500.

| return | wire `status` | terminal? |
|---|---|---|
| `EvalResponse(...)` | `done` | yes — scores stored |
| `JobPending(job_id=...)` | `pending` | no — server polls |
| `dict` with `status` ∈ `{done, pending, error}` | as given | `error` is terminal |

**The `error` status has no typed model.** To fail terminally you must return a
raw dict, and `error` must be a **non-empty `str`**:

```python
return {"status": "error", "error": "model service unavailable"}
```

Coercion edges, all pinned by tests:

- `dict` without `status` → 500.
- `{"status": "pending"}` without `job_id` → 500 (at the SDK, before the wire).
- `{"status": "error"}` with no message, or a non-str message → 500.
- `done`/`pending` dicts drop unknown keys (`extra="ignore"`); the `error` path
  **preserves** extras (`{"status": "error", **data}`). Asymmetric on purpose.

**Raising is not reporting.** An exception becomes a generic 500 with the body
`"evaluator raised an internal error"` — your exception text never reaches the
server (`from None`), and the server treats 5xx as *transient* and retries.

## HTTP routes

| route | auth | purpose |
|---|---|---|
| `GET /health` | **open even when a token is set** | liveness |
| `POST /evaluate` | bearer | the evaluation |
| `GET /evaluate/{job_id}` | bearer | poll an async job |
| `GET /config` | bearer | advertise timeouts/cadence |

- Bearer scheme match is case-insensitive (`bearer xyz` is accepted, per RFC 6750).
- **Request body cap `MAX_BODY_BYTES` = 25 MiB** — checked against `Content-Length`
  *before* the body is read. Over → 413 → 4xx → terminal, not retried.
- `GET /config` with no `@app.config` registered still returns
  `{"default_poll_interval_secs": 10}` — the SDK always advertises a cadence.
- Validation failures return 422 and **deliberately do not echo the payload**
  (a transcript would leak into logs); likewise 500s never echo exception text,
  and the token never appears in any log field. Tests assert all three.

## Wire format

Request (`POST /evaluate`):

```json
{
  "schema_version": "1",
  "session_id": "run-001",
  "agent_id": "support-bot",
  "environment": "prod",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": null,
  "events": [
    {"id": 1, "ts": "2026-01-01T00:00:00Z", "event_type": "agent_start",
     "payload": {"type": "agent_start", "goal": "help the user", "session_id": "run-001"}}
  ]
}
```

Response, done / pending / error:

```json
{"status": "done", "scores": {"helpfulness": 0.9}, "reasoning": {"helpfulness": "..."}, "summary": "..."}
{"status": "pending", "job_id": "abc-123", "next_poll_secs": 15}
{"status": "error", "error": "model service unavailable"}
```

## Server-side dispatch: what calls you, and how

Worth knowing because it explains every timeout and duplicate you'll see.

1. **Enqueue.** An `agent_end` event enqueues one job, `ON CONFLICT (org_id,
   session_id) DO NOTHING` — **one in-flight job per session**, so concurrent
   `agent_end`s don't double-score.
2. **Fallback enqueue.** A scanner (every 60s) enqueues idle sessions — **only if
   your `GET /config` returns `inactivity_timeout_secs`**. Values ≤ 0 are dropped.
   Config is re-fetched every `EVALUATOR_CONFIG_REFRESH_SECS` (default 300).
3. **Claim.** `EVALUATOR_WORKERS` (2) × `EVALUATOR_CLAIM_BATCH` (4) →
   **8 concurrent calls** against your endpoint, deployment-wide.
4. **Dispatch.** `POST /evaluate`, `Authorization: Bearer`, `User-Agent:
   agenteye-server/<version>`, timeout `EVALUATOR_REQUEST_TIMEOUT_MS` (**30s**).
5. **Classify.** `done` → terminal. `pending` + `job_id` → poll (`job_id` may be
   omitted on a *poll* response, but not on the POST — that's a protocol
   violation and terminal). `error` → terminal. Unknown/missing `status` →
   terminal error. **5xx / 429 / transport → transient, retried** with backoff
   (base 2s, cap 1800s) up to `EVALUATOR_MAX_ATTEMPTS` (5). **4xx → terminal**, so
   a token mismatch fails immediately rather than retrying.
6. **Poll.** `GET /evaluate/{job_id}`, **same 30s timeout**. Cadence precedence,
   each clamped to [1s, 3600s]: response `next_poll_secs` → `/config`'s
   `default_poll_interval_secs` → `EVALUATOR_POLLING_INTERVAL_SECS` (10). Wallclock
   cap `EVALUATOR_MAX_POLL_DURATION_SECS` (3600) → recorded as `timeout`.
7. **Land.** Terminal results are written to ClickHouse `agenteye.evaluations`
   with `status` ∈ `done | error | timeout`. Multiple evaluations accumulate per
   session as a timeline.

## Server env vars

Set on the **AgentEye server**, not on your evaluator.

| var | default | notes |
|---|---|---|
| `EVALUATOR_ENDPOINT` | — | **Unset → the whole pipeline is a silent no-op.** |
| `EVALUATOR_TOKEN` | — | Must match your `Evaluator(token=...)` byte for byte. |
| `EVALUATOR_REQUEST_TIMEOUT_MS` | 30000 | Applies to POST **and** poll GET. |
| `EVALUATOR_WORKERS` | 2 | × claim batch = concurrency. |
| `EVALUATOR_CLAIM_BATCH` | 4 | |
| `EVALUATOR_MAX_ATTEMPTS` | 5 | Retries on transient failures. |
| `EVALUATOR_POLLING_INTERVAL_SECS` | 10 | Lowest-precedence cadence. |
| `EVALUATOR_MAX_POLL_DURATION_SECS` | 3600 | Then `timeout`. |
| `EVALUATOR_CONFIG_REFRESH_SECS` | 300 | How often `/config` is re-read. |

## Logging

The SDK logs via `structlog`. Notable events: `/config` responses tag
`source="user"` vs `source="default"` so you can tell whether your `@app.config`
was actually picked up. The bearer token is never logged.
