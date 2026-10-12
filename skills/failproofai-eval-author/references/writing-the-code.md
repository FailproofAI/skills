RESULT PRIMITIVES
- Score(value, passed=None, unit="ratio", display_value=None, description=None)  # value MUST be 0..1
- Metric(value, unit="", display_value=None, description=None)                   # any finite number
- Assertion(passed, description=None)                                            # passed is bool: True = the HEALTHY outcome
- EvalResult(score=..., metrics={...}, assertions={...}, reasoning="...", summary="...")

MATCH result_kind TO THE FIELD (this is required — the server validates it):
- "score":     EvalResult(score=Score(<0..1>), reasoning="...")
- "metric":    EvalResult(metrics={"<eval_key>": Metric(<number>)}, reasoning="...")
- "assertion": EvalResult(assertions={"<eval_key>": Assertion(<bool>)}, reasoning="...")
Key metric/assertion dicts by the eval_key you chose.

CHOOSING result_kind WHEN THE OPERATOR DID NOT — infer it from the intent:
- "how many", "how much", "count", "number of", "cost", "spend", "latency",
  "duration", "tokens", "size" -> "metric". A MAGNITUDE with a unit, NOT clamped
  to 0..1. "count of tool calls" is metrics={"tool_calls": Metric(12)} — NEVER a
  Score of 0.01 with display_value "12 tool calls". A count squeezed into a score
  is wrong twice: the number is unreadable, and the dashboard then ranks it
  against ratios it has nothing to do with.
- "did X happen", "does it always", "does it never", "is it ever", "must" ->
  "assertion". One yes/no about the session.
  An assertion PASSES (true) on a HEALTHY session, whichever way the question
  is worded: "did the pii_redactor hook ever fail?" is
  Assertion(<no pii_redactor failure>) keyed "pii_redactor_never_failed" —
  never Assertion(<it failed>), which shows a pass on every broken session.
- "how good", "how well", "quality", "share", "rate", "fraction", "proportion",
  "percentage", "% of" -> "score". A 0..1 magnitude.
A "Desired result_kind:" line in the request is the OPERATOR'S OWN choice and
OVERRIDES every rule here — match it exactly, even where the wording of the
intent points somewhere else.

ALLOWED BUILTINS ONLY: abs all any bool dict float int len list max min range
round set sorted str sum tuple. NOTHING else — no enumerate, no print, no open,
no __import__.

NEVER WRITE A BARE GENERATOR EXPRESSION — the sandbox rejects them and the draft
will fail to deploy. Every "for" clause MUST be wrapped in brackets so it is a
list/set/dict comprehension, never a bare "(... for ...)":
  WRONG:  any(e.payload.get("outcome") == "success" for e in session.events_of_type("agent_end"))
  RIGHT:  any([e.payload.get("outcome") == "success" for e in session.events_of_type("agent_end")])
This applies to every helper that consumes an iterable — any(), all(), sum(),
min(), max(), sorted(), set(), tuple(), list(), dict(). Always hand them a
bracketed comprehension, never a bare parenthesized one. Use range(len(x)) for
indices.

NEVER WRITE A LAMBDA — the sandbox rejects it (a function object's repr leaks a
memory address). sorted()/max()/min() are allowed, but NEVER with a key=lambda.
The transcript is ALREADY time-ordered, so to get the last/first event of a type
you INDEX it, you do not sort it:
  WRONG:  sorted([e for e in session.events_of_type("agent_end")], key=lambda e: e.ts)[-1]
  RIGHT:  session.events_of_type("agent_end")[-1]

STRING/COLLECTION METHODS must be CALLED, never referenced bare. Do not access
any attribute starting with "_". Keep sources well under 5000 AST nodes. Write
each source as ONE line — the drawer reformats it for readability.

GUARD AGAINST EMPTY SESSIONS: divide only when the denominator is > 0, e.g.
  round(session.count("error") / session.event_count, 4) if session.event_count else 0.0

WRITE AN EVALUATION THAT COULD DISCRIMINATE. A score that is a LITERAL CONSTANT
— one that never reads `session` at all — measures nothing: it cannot separate
a good session from a bad one, and no session will ever move it. Prefer a
GUARDED RATIO over a boolean-ish constant: reach for
  round(part / whole, 4) if whole else <default>
before 1.0/0.0, and base the value on a quantity that CAN vary between sessions
(counts of two event types, errors per event, retried calls over calls). If the
intent really is a yes/no, express it as result_kind "assertion" rather than a
score that is always 1.0.
This is about what the CODE can do, not about the numbers it produced. Identical
scores across sessions are NOT evidence of a bad evaluation: "fraction of tool
calls that returned an error" correctly scores 0.0 on every session of a fleet
where nothing failed, and changing a correct evaluation to make its number move
replaces a real measurement with a fabricated one. Never do that.

WHEN TO WRITE A CONDITION
A condition_source answers one question: DOES THIS QUESTION EVEN APPLY TO THIS
SESSION? It is not a convenience filter — it is what keeps the score honest. An
evaluation of tool usage run on a session that used no tools scores 0.0, not
because the agent did badly but because the question was MEANINGLESS there.
Those sessions drag the average down, and when most sessions are like that the
number stops answering the question that was asked, so the evaluation measures
NOTHING useful. A condition makes the platform SKIP those sessions, so the score
reflects only the sessions where the question was real. Beware the opposite
mistake: a condition that excludes EVERY session is the "all_skipped" verdict
below, and it means nothing ran at all.

WRITE a condition when the evaluation is only meaningful for a SUBSET of
sessions: it counts a specific event type, it reads a payload field only some
sessions carry, or it targets one kind of run (one environment, one agent).
LEAVE IT "" when the evaluation genuinely applies to EVERY finished session.
  tool-usage evaluation, e.g. "were tool calls answered?":
    "condition_source": "session.count(\"tool_use\") > 0"
  error rate over all events, e.g. "errors per event":
    "condition_source": ""
A condition obeys every rule above — ONE expression, the documented session
surface, the allowed builtins, and NEVER a bare generator expression. Do not
invent one to look thorough: a wrong condition hides real sessions, which is
worse than no condition at all.
