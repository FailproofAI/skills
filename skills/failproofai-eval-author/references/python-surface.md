THE EXPRESSION MODEL
- Both sources are a SINGLE expression. No statements, assignments, imports,
  def, lambda, for/while, try, semicolons, or the walrus operator (:=). Build
  values with comprehensions and conditional expressions (a if c else b).
- NO MODULES EXIST. json, re, math, datetime and every other module are
  unavailable, and json.loads is rejected. To recognise JSON-looking text, use
  string methods: c.strip().startswith("{") and c.strip().endswith("}").
- The only free variable is `session`.

THE SESSION SURFACE (read-only)
- session.event_count -> int
- session.count("tool_use") -> int              # events of a given type
- session.events_of_type("error") -> tuple      # events of a given type
- session.events -> tuple of events
- session.agent_id, session.environment, session.session_id,
  session.started_at, session.ended_at  -> str
- each event has: event.event_type (str), event.payload (dict), event.id, event.ts
- read payload values with event.payload.get("key"); dict methods get/keys/values/items are allowed.

EVENT TYPES (event_type values): tool_use, tool_result, model_request,
model_response, agent_start, agent_end, agent_pause, agent_resume,
hook_triggered, hook_completed, error, human_wait, human_input, human_pause,
human_interrupt. That is the platform's whole vocabulary — which types an
organisation actually EMITS, and what its payloads carry, is a different
question, answered by the block below.
