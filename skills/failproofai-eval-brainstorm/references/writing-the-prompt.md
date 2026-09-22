# Writing the prompt

The prompt is the deliverable. Everything before it was research; this is the thing the
user actually carries away, and its quality decides whether their first attempt at
authoring works or wastes a round trip.

**Write it to stand alone.** The authoring page sees your prompt and a profile of the
organisation's event payloads. It does not see this conversation, the sessions you read,
or the reasoning that got you here. Anything load-bearing has to be *in the prompt*.

## Four properties of a prompt that composes first try

**1. One measurement, phrased so the kind is obvious.** "Fraction of…" gets a score,
"How many…" a metric, "Did the agent…?" an assertion. A prompt asking for two things at
once gets a muddle of both.

**2. Name the fields outright.** Say which event types and payload keys to read, in the
exact spelling the profile showed. This is the single highest-value sentence in the
prompt — without it every field access is a guess, and a guessed key reads nothing,
scores every session the same, and looks like it works.

**3. Anchor the ends.** Say what the lowest value means and what the highest means.
"0 when every call is distinct, 1 when every call after the first is a repeat" removes
the ambiguity that otherwise gets resolved by coin flip — and it is what makes the
number readable on a dashboard six weeks later.

**4. Carry the scope in the prose.** There is no separate scope field. If the
measurement is only meaningful for one agent, one environment, or one stage, write that
into the sentence — "only for sessions from the `checkout-bot` agent" — and it becomes
the evaluation's condition.

**5. State the key you agreed.** There is no separate key field either, and the link
carries nothing but this prose. Leave the key out and the page names the evaluation
itself — reasonably, but not what the user just signed off on in step 7, and keys are
permanent in practice. One clause fixes it:

> Use the evaluation key `tool_retry_rate`.

The same goes for the result kind, but by omission rather than statement: the page
infers score / metric / assertion from property 1's phrasing, so get the phrasing right
and do not try to declare the kind outright.

## Specific beats broad

Broad prompts make the model waffle, produce vague code, and can time out outright.
"Cost and general efficiency stuff" is not a measurement. "Total model requests in the
session" is.

If a proposal genuinely covers two things, it is two proposals — and if that pushes you
past four, one of them was not worth it.

## Before and after

| Weak | Why | Strong |
|---|---|---|
| "Measure tool efficiency" | names no quantity, no direction, no field | "Fraction of a session's tool calls that repeat the previous call's tool name and input exactly. Read `tool_use.tool_name` and `tool_use.input`. 0 when every call is distinct, 1 when every call after the first is a repeat." |
| "Is the agent doing a good job?" | not measurable; no source | "Did the session reach an `agent_end` event with a successful outcome?" |
| "Track retrieval quality" | plausible, but is the field even there? | "Average of `retrieval.score` across the session's `retrieval` events, only for sessions that have at least one. 0 is no match, 1 is an exact match." |
| "Count errors and latency" | two measurements | split: "Number of `error` events in the session" · "Total wall-clock seconds from first to last event" |

## What happens next, and what it tells you

The authoring page composes the prompt into an evaluation, then backtests it against
real sessions before anything is deployed. What it reports back is feedback on the
*prompt*, and each outcome points at a specific fix:

| The page says | What it means about the prompt | Fix |
|---|---|---|
| it ran clean, scores vary | the prompt worked | nothing — review and deploy |
| it reads keys no session has | you named a field that is not in their data | back to the payload profile; you skipped gate A |
| its result cannot depend on the session | you described a constant, not a property of the run | rephrase around something that varies per session |
| the condition skipped every session | your scope sentence excluded everything | widen the scope, or check the condition's own fields exist |
| it raised an error | usually ambiguity that produced bad code | cut it to one measurement, name the fields, try again |
| every session scored the same | **usually fine** | leave it — see below |

That last row is the one people get wrong. An evaluation asked for "fraction of tool
calls that returned an error" scoring 0.00 on healthy sessions is returning the correct
answer. Low variance is not a defect, and rewriting a working measurement until the
number moves is how a good evaluation gets turned into a bad one.

## Names are permanent

The key is what every trend, filter and dashboard is built on, and renaming it splits
the history. Get the user to say the exact string out loud before they author it.

Short, lowercase, underscore-separated, and naming the thing measured rather than the
verdict: `tool_retry_loop`, `completion_rate`, `retrieval_score`. Not `quality`, not
`eval_1`, not anything carrying this week's number in it.
