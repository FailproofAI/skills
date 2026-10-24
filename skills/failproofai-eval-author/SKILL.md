---
name: failproofai-eval-author
description: |-
  How to WRITE a hosted FailproofAI Cloud evaluation once you know what to measure: pick the mechanism (python "code", a "jev" classifier, or an LLM "judge"), emit the exact JSON draft the evaluation form takes, write the one-expression Python against the session surface, ground every payload key in the org's own event shapes, and repair a draft from a dry-run error or a backtest verdict.

  Trigger when the user wants to:
  • write an evaluation — "score tool error rate", "check it never refunds without checking policy";
  • fix one — a dry-run raised, every session scored the same, the condition skipped everything;
  • choose between code, jev and judge for a question.

  NOT for deciding WHAT to measure (`failproofai-eval-brainstorm`), nor policies that block tool calls (`failproofai-policy-author`).
---

# Writing a hosted evaluation

A hosted evaluation is ONE Python expression (or a jev/judge envelope) that reads a
finished agent session and returns an `EvalResult`. The operator reviews the draft and
deploys it; the author never deploys anything.

These reference files are the method. They are also, verbatim and in this order, the
instructions FailproofAI Cloud's own evaluation drafter runs on — which is why they talk to
a model ("you draft…", "return ONLY a JSON object", blocks fenced in `<<<…>>>`). Working by
hand, read "the request carries an ORGANISATION EVENT SHAPES block" as "you have checked
which event types and payload keys this org emits", and the JSON keys as the fields of the
dashboard's new-evaluation form.

| part | what it settles |
|---|---|
| `references/choosing-the-mechanism.md` | code vs jev vs judge — the three-question dividing line, with examples |
| `references/output-contract.md` | the JSON keys per kind, jev rubrics (worst first, 3-5 levels), judge steps (no digits), what a jev/judge can actually read, labels |
| `references/python-surface.md` | the one-expression model, the `session` surface, the event-type vocabulary |
| `references/grounding.md` | read a payload key ONLY where the org's event shapes list it |
| `references/writing-the-code.md` | result primitives, choosing `result_kind`, allowed builtins, no bare generators, no lambdas, guards, discriminating scores, when to write a condition |
| `references/worked-examples.md` | known-good expressions for the common shapes |
| `references/repair.md` | fixing from a dry-run error, a backtest verdict (broken / all_skipped / unfounded / constant / uniform / healthy), and the self-check |

## Using it by hand

1. Read `choosing-the-mechanism` and decide the kind before writing anything.
2. Check which event types and payload keys this org actually emits — `grounding` is the
   rule that makes the draft measure something. For a string key with many values (hook
   names, tool names, models) look up the real values and their counts before comparing
   against one.
3. Write the draft to `output-contract` + `writing-the-code`; start from a
   `worked-examples` shape when one fits.
4. Dry-run it on real sessions — several clearly bad AND several clearly good ones,
   picked by a rule over their events, not by the draft — and repair from what it
   returned with `repair`. A score that comes out identical on a good and a bad session
   has not been shown to measure anything yet.

The mechanics of steps 2 and 4 differ by where you are running — see
`references/dashboard.md` (the dashboard assistant) or `references/cli.md` (a coding
agent with `fp`). You will have one of the two, not both.
