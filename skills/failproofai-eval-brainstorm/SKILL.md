---
name: failproofai-eval-brainstorm
description: |-
  Works out WHAT is worth measuring about an AI agent's production runs: reads the user's real sessions and returns 2-4 specific, writable evaluation proposals, each with the prompt that authors it. Reach for it on vague phrasing — "I want evals", "what should I be measuring?", "how do I know if my agent is any good?"

  Trigger when the user wants to:
  • decide what to score — which dimensions are worth tracking, grounded in their own sessions;
  • find blind spots — what keeps going wrong that nothing measures;
  • sanity-check an idea — is it worth writing, can it be written against their data, do they have it already.

  Stops at the proposal; never writes evaluator code.

  NOT for authoring or deploying the evaluation itself (the eval authoring page does that, from this prompt), reading scores that already exist or spotting a regression (`fp-cloud-cli`), making an agent emit events at all (`failproofai-sdk`), or turning a recurring behaviour into enforcement (`failproofai-policy-author`).
---

# Finding what to evaluate

An evaluation runs over a finished session and returns one of three things: a score
(a 0–1 fraction), a metric (a quantity with a unit), or an assertion (pass/fail).
You describe it in plain English and the authoring page writes it, tests it against
real sessions, and deploys it.

So the code is not the scarce thing. **Knowing which number is worth having is.**
That is this skill's entire job:

    scan the population → confirm the signal exists → diff good against bad
      → 2-4 candidates → the prompt that authors each one

## Where this stops

You produce **proposals**, not evaluations. Each proposal ends in a prompt the user
can paste into eval authoring, which handles composing, backtesting and deploying.
Say this out loud at the start:

> "We'll read your real sessions and come out with a short list of what's worth
> measuring. I won't write the evaluator — when the list is right, you decide which
> ones to author."

That sentence keeps the session honest. Without it this drifts into authoring, and
authoring without a grounded answer to *what* is how people end up with four
evaluations nobody looks at.

## 1. Learn what "good" means — briefly

The logs say what happened. Only the user says what *should* have. Get two things
and move on:

- **one good-run story and one bad-run story** — the highest-yield question there is;
- **who the agent serves**, and what it is on the hook for.

Keep it short. You are only learning what to look *for*; the sessions do the rest.

## 2. Scan the whole population before you sample

Choose your corpus from evidence, not from whichever session is on screen. Establish,
with actual queries:

- **What exists** — which agents run, in which environments, what error types occur.
- **Where it hurts** — error hotspots, and the rate (compare a window against a
  baseline; a raw count is not a rate).
- **The shape of the data** — event-type histogram, session length distribution,
  the biggest and longest sessions.

Report the numbers back as you go. This scan is not preamble; it is what makes every
later claim checkable, and it directly seeds the discrimination work in step 6.

Mechanics differ by where you are running — see `references/dashboard.md` (assistant)
or `references/cli.md` (local, with `fp`).

## 3. Check what is already measured

Two different questions, and you need both:

- **What is defined** — the evaluations that exist, enabled or not.
- **What has results** — the score keys actually landing, and their distributions.

They are not the same. An evaluation deployed yesterday has a definition and no
results, and if you only look at results you will propose it again. Re-proposing
something the user already has is the fastest way to lose their trust in the slate.

While you are here, look at the distributions: a score that is uniformly high across
every session is measuring nothing useful, and that is worth saying.

## 4. Confirm the signal is really there

**This is the step that separates a proposal from a wish**, and it is the one people
skip.

`event.payload` is free-form. An evaluation that reads a key the user's agents never
emit does not fail — it reads nothing on every session, scores them all identically,
and looks exactly like a working evaluation. Nobody notices for a month.

So before proposing anything, check the payload profile: for each event type, which
top-level payload keys actually appear, in what fraction of events, with what types
and value sets. Then, for every candidate:

- **Name the exact event types and payload fields it reads.**
- **Confirm each one is present**, and say at what rate. A key on 4% of events is not
  a foundation.

If the signal is not in the telemetry, do not propose it. Say so plainly and name what
instrumentation would be needed — that is a real answer, and it points at
`failproofai-sdk`. Classic casualties: "was the user satisfied", "did the customer come
back", anything needing ground truth that was never recorded.

## 5. Read the sessions that disagree

Now pull sessions — **5 to 8**, chosen from the scan, not at random:

- **≥2 the user calls bad** and **≥2 they call good**. The gap between those piles
  *is* the evaluation; you need both.
- **1-2 ordinary** runs — a measurement that only fires on extremes is not much use.
- **1 outlier** the queries surfaced: the longest, the loopiest, the most errors.

Confirm the corpus before you dig in: *"these six, including the two you flagged —
right set?"*

Read every one against the **same** checklist, so they become comparable and patterns
fall out of the columns. Record observations, not judgments — "searched the same query
five times", not "was inefficient".

| Row | What to capture |
|---|---|
| **Shape** | ordered event-type skeleton, event count, wall-clock span |
| **Goal vs outcome** | what it set out to do, against how it ended |
| **Tool usage** | tools used, call count, distinct vs repeated, longest identical-repeat run, failures |
| **Model behaviour** | stop reasons, round-trips, token peaks |
| **Errors & control flow** | error events, hook allow/deny, whether a human had to step in |
| **Sub-agents** | fan-out, and whether the children finished |
| **How it ended** | cleanly / never / errored / interrupted |
| **Plain-words read** | one line on what actually went well or badly — *after* the rows above |

## 6. Two gates, each carrying a number

Every candidate passes both, or it is cut and the cut is reported.

**Gate A — is it there?** Step 4, applied per candidate. Named fields, confirmed
present, presence rate stated.

**Gate B — does it discriminate?** Compute the candidate across the good and bad
cohorts and state the gap. Two sessions are an anecdote; the metric that looked
decisive in a pair often washes out over two hundred, and SQL over the population is
how you find that out before the user does.

A candidate that reads the same on both sides is cut, or demoted to "worth watching,
not a quality signal".

> **Low variance is not a defect.** An evaluation asked for "fraction of tool calls
> that errored" returning 0.00 on healthy sessions is returning the *right answer*.
> Never rewrite a working measurement because the number does not move — that is how
> people talk themselves out of their best evaluations.

**Keep a running "considered and rejected" list**, each entry carrying the number that
killed it, and **put it in your answer** — it is a required part of the output, not a
note to yourself. It is how the user knows you looked, and why the slate is this one
and not something else.

Without it a slate is unfalsifiable: three confident proposals read exactly the same
whether you tested ten candidates or thought of three. **Name at least one thing you
cut and the number that cut it**, every time. "I checked X; good runs 0.81, bad runs
0.79 across 40 sessions, so it is not a quality signal" is worth more to the reader
than a fourth proposal.

## 7. Converge — 2 to 4, named once

Present the survivors as a short slate and ask for reactions: keep, cut, rename, merge.
Then the question that catches what you missed: *"is there a failure you've seen that
none of these would catch?"* Their answer sends you back to the sessions.

Two limits to hold firm on:

- **2 to 4 proposals.** Past four nobody reads the dashboard and the evaluation stops
  changing decisions.
- **Get explicit sign-off on each key name.** Keys are permanent in practice —
  renaming splits the history and breaks every trend built on it. Agree the exact
  strings now.

## 8. Hand over the prompt — and the link, in the same breath

The deliverable for each survivor is **the prompt**, written so the authoring page
composes cleanly from it on the first try. That has its own craft — the grammar that
picks the result type, how specific to be, which field names to name outright. See
`references/writing-the-prompt.md`.

**Then build the link for every proposal, before you write your answer.** As the
dashboard assistant that is `build_eval_authoring_link`, once per survivor. From a
machine with `fp` there is no such tool — build it yourself, as `references/cli.md`
shows. Either way the link goes in the proposal. A proposal without its link is not
finished — the whole point is that the operator can act on it in one click, and a
prompt they have to copy, navigate to authoring, and paste is most of the friction
this exists to remove.

Three things not to do, because each one reads as helpful and lands as a dead end:

- **Do not offer to generate the links.** "Shall I generate the authoring links?" is
  a round trip that buys nothing — you already know which proposals you are making.
- **Do not ask which ones they want first.** Build a link for each; they pick by
  clicking. Choosing is the cheap part for them and the expensive part for you.
- **Do not write the words "link" or "here are the links" without a link.** Describing
  a link you did not build is worse than omitting it: it reads as done.

The rule in one line: **if you named a proposal, you built its link.**

## The proposal format

Each proposal, in full:

> **`tool_retry_loop`** · score · for `checkout-bot` in production
>
> **Measures:** fraction of tool calls that repeat the previous call's tool and
> arguments exactly. 0 is healthy, 1 is a pure retry loop.
>
> **Why you:** 34% of your error sessions last week show four or more identical
> retries; your clean sessions show none. Nothing raises an error, so no alert fires —
> a standing score is the only way to see this move.
>
> **Reads:** `tool_use.tool_name` (100% of `tool_use` events), `tool_use.input` (98%).
>
> **Grounded in:** session `run-8842` — `search_orders` called five times with
> byte-identical arguments, then the session ended with no answer.
>
> **Prompt:** "Fraction of a session's tool calls that repeat the previous call's tool
> name and input exactly. Read `tool_use.tool_name` and `tool_use.input`. 0 when every
> call is distinct, 1 when every call after the first is a repeat."
>
> **Author it:** [/acme/eval-authoring/new?intent=…](#) ← the link from step 8

**Every field above is required, including the last one.** A proposal that stops at
the prompt has handed the operator homework instead of a decision.

Then **the rejected list** — a short table of what you considered and the number that
killed each one — and the open question about what none of them catch. An answer with
proposals but no rejected list is incomplete, however good the proposals are.

## When the honest answer is "nothing yet"

Two cases, and both are real answers — say them plainly rather than manufacturing a
slate:

- **No telemetry.** Nothing to ground a proposal in. Point at `failproofai-sdk` to
  instrument first, or brainstorm provisionally from the good/bad stories alone and
  stamp it **"unverified against real sessions"**. Never dress a hunch as evidence.
- **Nothing separates.** You looked, and no observable quantity tracks the user's
  good/bad call. Report what you checked and what it returned. That is a finding about
  their fleet, and it is more useful than four generic dimensions.

## Reference files

| File | Read it for |
|---|---|
| `references/patterns.md` | observation → candidate catalog, and the result-kind mapping |
| `references/writing-the-prompt.md` | writing an intent prompt that composes cleanly first try |
| `references/cli.md` | running this locally with `fp` — commands, and the gotchas that make one lie |
| `references/dashboard.md` | running this as the dashboard assistant — which tool answers what |

The method is one text; only the grounding mechanics differ, so each surface
carries the reference it can actually use and not the other. Working from a
machine with `fp`, you have `cli.md` and no `dashboard.md`. Working as the
dashboard assistant, the reverse — there is no shell there, so a command palette
would only be something to recite at the user. **Whichever one you have is the
one for you; the missing file is not an error and not worth mentioning.**
