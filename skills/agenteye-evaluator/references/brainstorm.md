# Brainstorm mode — deciding what to evaluate (plan only)

The deliverable of this mode is **a decision, not code**. You research the user's
real logs *with them* and stop at a written eval plan. Do not scaffold a project,
do not write `evaluator.py`, do not touch a deploy. When they're ready to build,
that's the build loop (SKILL.md §6–12) — seeded by the plan you produced here.

Two things make a plan worth trusting, and they run through every step:

- **It's collaborative.** You present, they react, you refine — turn by turn, not
  one big reveal at the end. The user is the only source of what "good" means; the
  logs are the only source of what actually happens. You're joining the two.
- **It's data-backed.** Every observation, every candidate dimension, every
  rejection is grounded in a number you actually queried — not a hunch from
  skimming a couple of sessions. Run the `agenteye` CLI *frequently*. Before you
  propose anything, scan the whole population; quantify each claim; and put the
  numbers in front of the user. The goal is the most evidence-grounded plan their
  telemetry can support.

The command mechanics live in [`session-data.md`](session-data.md) — how to pull a
session, the full event vocabulary, and the CLI gotchas. This file is the *method*;
that file is the *tooling*. The palette near the end is the short list of what to
run and when.

## Step 0 — Frame it, and say where it stops

Open by setting the contract out loud: *"We'll read your real logs together and come
out with a plan of what's worth scoring. I won't write evaluator code in this mode —
when the plan's right, you decide whether to build it."* That one sentence keeps the
session honest and stops it drifting into a scaffold.

Then get just enough of the human half to read the logs against — borrow §2's
highest-yield prompt (**one good-run story, one bad-run story**) and *who* the agent
serves. Keep it short. The transcripts do the heavy lifting from here; you're only
learning what to look *for*.

## Step 1a — Scan the whole population first (data before sampling)

Before you open a single session, quantify the landscape so your corpus is *chosen
from evidence*, not guessed. Run, at minimum:

- **Facets — what even exists.** `agenteye --json list agents`, `list envs`,
  `list error_types`, `list score_filters`. This is the vocabulary of their
  deployment: which agents run, which environments, what errors occur, and which
  score keys (if any) already exist.
- **Where it hurts, and how often.** `agenteye --json errors --aggregate --since 7d`
  for the error hotspots; `agenteye --json sessions --status error,timeout --since 7d
  --all --limit 1000` for the count and identity of failed runs (compare against a
  healthy window to get a rate, not just a number).
- **What's already scored.** `agenteye --json evals --aggregate --since 7d` →
  `score_stats` tells you which dimensions are tracked today and how they're
  distributed — so you don't re-propose something they already have, and you can spot
  a score that's uniformly high (measuring nothing) or already regressing.
- **Anything the flags can't express — drop to SQL.** `agenteye --json query run
  --sql "…"` runs over the exposed tables `events`, `evaluations`, `agent_sessions`
  (`agenteye --json query schema` prints the columns first — check it before
  guessing one). This is how you get the shape of the whole dataset:

  ```bash
  # event-type histogram across the population
  agenteye --json query run --sql \
    "SELECT event_type, count() c FROM events GROUP BY event_type ORDER BY c DESC"

  # the biggest / longest sessions — your outlier candidates
  agenteye --json query run --sql \
    "SELECT session_id, count() c FROM events GROUP BY session_id ORDER BY c DESC LIMIT 20"
  ```

  Once `query schema` confirms the columns your deployment promotes (e.g. tool,
  duration, or token fields), the same pattern gives you duration distributions,
  token distributions, and per-tool call counts — the raw material for the tool-loop,
  cost, and latency dimensions you'll weigh later.

Report the numbers back to the user as you go. This scan tells you what's common,
what's rare, and which sessions are *actually* the worst — and it directly seeds
Steps 3–5, where those same queries become discrimination evidence.

## Step 1b — Assemble the corpus from the scan

Now pull the sessions you'll read closely — **5–8**, chosen from Step 1a, not at
random:

- **≥2 the user calls bad** and **≥2 they call good** — the good/bad gap *is* the
  eval, so you need both piles.
- **1–2 typical** middle-of-the-road runs (a dimension that only fires on extremes
  isn't much use).
- **1 outlier** the queries surfaced — the longest, the most tool-looping, the one
  with the most errors.

Pull mechanics are in [`session-data.md`](session-data.md): the export endpoint gives
a byte-identical fixture, or `agenteye --json events --full --session-id <id> --order
asc --all --limit 1000`. Skim on the payload-free feed first (its one-line server
`summary` per event is ideal for reading a session's *shape*), then `--full` only on
the ones you're reading line by line. **Confirm the corpus with the user** before you
dive in — "these five, including the two you flagged; right set?"

> **No logs yet?** If the agent isn't emitting sessions, stop — you can't ground a
> plan in transcripts that don't exist. Say so plainly, and either point them at the
> `agenteye-python-sdk` skill to instrument first, or brainstorm *provisionally* from
> the good/bad interview alone and stamp the plan **"unverified against real logs."**
> Don't dress a hunch up as evidence.

## Step 2 — Read each session against a fixed catalog

The systematic core. Read every session in the corpus against the *same* checklist,
so sessions become comparable and patterns fall out of the columns. Record
**observations, not judgments** — "searched the same query 5×", not "was inefficient".

| Row | What to capture | Where it lives |
|---|---|---|
| **Shape** | ordered event-type skeleton, event count, wall-clock span (first→last `ts`) | the event stream; note `ended_at` may be absent |
| **Goal vs outcome** | did it do what it set out to? | `agent_start.goal` vs `agent_end.outcome`/`summary` (or the absence of `agent_end`) |
| **Tool usage / loops** | tools used, call count, distinct vs repeated, longest identical-repeat run, failures, slow calls, orphan calls | `tool_use.tool_name`/`input`, `tool_result.error`/`duration_ms`; pair by `tool_call_id` |
| **Model behavior** | models used, stop reasons (watch `length`/refusal), token totals + peaks, round-trips | `model_response.stop_reason`/`input_tokens`/`output_tokens`, count of `model_request` |
| **Errors & control flow** | error events; hook allow/deny/block; did a human have to step in, and for how long | `error.*`, `hook_completed.outcome`, `human_wait`/`human_input.duration_ms`, `human_interrupt` |
| **Sub-agents** | fan-out, and did the children finish | `agent_start` with `parent_id`; matching `agent_end` |
| **How it ended** | clean / never ended / errored / interrupted | `agent_end` vs none vs `error` vs `human_interrupt` |
| **Plain-words read** | one line: what actually went well or badly here | your judgment, *after* the rows above |

The event-type → payload-field vocabulary is tabulated in
[`session-data.md`](session-data.md#event-vocabulary) — don't guess field names, and
remember conversation text lives in `model_request.messages` / `model_response.content`
(there's no `user_message` event type).

## Step 3 — Diff good vs bad, then quantify the separation

Lay the good catalogs beside the bad ones and find the rows that **move**. A candidate
dimension is born wherever an observable quantity separates the piles.

Then don't stop at the sample — **confirm it holds across the population.** The metric
that looked decisive in two sessions may wash out over two hundred. Where the metric
is expressible in SQL, compute it per session and compare the cohorts:

```bash
# does "how it ended" actually track the user's good/bad call?
agenteye --json query run --sql \
  "SELECT session_id, countIf(event_type='agent_end') AS ended, count() AS events
   FROM events GROUP BY session_id ORDER BY ended ASC, events DESC LIMIT 30"
```

Rows that read the same across both piles are dead ends — **note them so you don't
revisit them**, and so you can show the user you checked.

## Step 4 — Turn observations into candidate dimensions

For each row that moves, phrase a measurable quantity **with a direction**. Worked
mappings:

| What you saw | Candidate dimension |
|---|---|
| bad runs repeat the same search 4–6× | `tool_efficiency` — distinct ÷ total tool calls |
| bad runs never emit `agent_end` | completion / did-it-finish |
| bad runs end by telling the user to contact support | deflection rate |
| some runs burn 5× the tokens for the same goal | a token/cost **magnitude** metric |
| a human had to interrupt | human-intervention rate |
| "was the final answer correct / on-policy?" | correctness / policy — **flag the ground-truth risk now** |

## Step 5 — Two filters, each verified with a query

Run every candidate through both gates. These are §3–4's tests, applied *per
candidate* and *backed by data* rather than eyeballed.

**Filter A — is the signal in the transcript, and actually populated?** Name the exact
event types and payload fields that feed the dimension. Then *prove the field is there
in their data* — the schema allowing a field doesn't mean their instrumentation emits
it:

```bash
agenteye --json events --full --session-id <id> --all --limit 1000 \
  | jq '[.events[] | select(.event_type=="tool_use") | .payload.tool_name] | unique'
```

If you can't name the source, cut it — or park it as **"needs instrumentation"** and
point at the `agenteye-python-sdk` skill. Classic casualties: "did the customer come
back next week", "was the user satisfied", anything needing external ground truth.

**Filter B — does it discriminate, measurably?** Don't hand-wave on two sessions.
Compute the candidate across the good vs bad cohorts (SQL over the population wherever
the metric is expressible) and show the actual gap in the distributions. A candidate
that reads ~the same on both is cut, or demoted to **"monitor-only, not a quality
signal."**

Keep a running **"rejected & why"** list as you go, each entry carrying the
query/number that killed it. It's a deliverable, not waste — it's how the user knows
you looked and why the plan is *this* and not something else.

## Step 6 — Classify each survivor by shape and method

So the plan is build-ready without being a build, tag every surviving dimension two
ways:

- **Shape** (how the platform stores and renders it):
  - **rate** — a 0–1 fraction, shown as a bar. The default for a quality signal.
  - **magnitude metric** — a physical quantity with a unit (cost $, latency ms,
    tokens). Use when the thing is a *count with a unit*, not a fraction.
  - **label** — a category tag (a bucket, not a number).

  Rule of thumb: a quality *fraction* → rate; a *quantity with a unit* → magnitude; a
  *bucket* → label.
- **Method:** **rule** (counting / ratios / thresholds over events — deterministic,
  free, instant) vs **judge** (an LLM reads `messages`/`content` — subjective, costs
  latency and money). **Default to rule.** Reach for a judge only when the signal
  lives in free text and no count approximates it. Choosing a judge is a *flag for
  build mode* — it's what triggers the async / 30-second concerns in SKILL.md §8–9 —
  not something to solve here.

## Step 7 — Converge with the user (all the way through)

Collaboration isn't a final step — it runs the whole time. But it peaks here: present
the surviving candidates as a short slate, **each carrying the numbers you queried**.
Per candidate:

- the one-line definition and its direction,
- the real session it's grounded in (cite the id and what you saw),
- its **prevalence** — how often the failure shows up across the population (e.g.
  "in 34% of last week's error sessions"),
- the **measured good-vs-bad gap**.

Then ask for reactions — keep / cut / rename / merge — and the question that catches
what you missed: *"is there a failure you've seen that none of these catch?"* Their
answer sends you back to the transcripts, maybe to pull one more session to confirm
or refute. This is present → react → refine, turn by turn.

Two limits carried over from §4, and worth holding firm on:

- **Converge on 2–4 dimensions.** Past four, nobody reads the dashboard and the eval
  stops changing decisions.
- **Get explicit sign-off on the exact score-key names.** Names are permanent in
  practice — renaming later splits the history and breaks the trend. Agree the strings
  now, in the plan.

## Step 8 — Deliver the plan, then hand the user the wheel

Write up the plan (template below) and present it. Then **offer the next step — don't
pick it for them.** Three explicit exits:

1. **Save it** — write the plan to a markdown file (suggest `eval-plan.md` at the repo
   root or `docs/`). **Ask first, and ask where** — plan mode may be running before
   the evaluator repo even exists, and the file can carry paraphrased customer data, so
   never write it unprompted. Cite session ids and *paraphrased* observations; never
   paste raw transcript.
2. **Build it** — switch to build mode (SKILL.md §6–12), seeded by this plan: each
   dimension rule-first, tested against a real captured session, judges async.
3. **Keep brainstorming** — back to the logs: pull more sessions, refine, rename, or
   merge dimensions, re-check discrimination.

That's the whole point of the mode — the user leaves with a data-backed decision and
chooses what to do with it.

## CLI command palette

The go-to commands, by what you're trying to learn. Full mechanics, the event
vocabulary, and every gotcha are in [`session-data.md`](session-data.md); this is the
quick index.

| To learn… | Run |
|---|---|
| what exists (agents, envs, errors, score keys) | `agenteye --json list agents` / `list envs` / `list error_types` / `list score_filters` |
| where it hurts, how often | `agenteye --json errors --aggregate --since 7d` · `agenteye --json sessions --status error,timeout --since 7d --all --limit 1000` |
| what's already scored / regressing | `agenteye --json evals --aggregate --since 7d` (→ `score_stats`) · `agenteye --json evals --score <key>:..0.5 --since 7d --all --limit 200` |
| a session's shape, then its content | `agenteye --json events --session-id <id> --order asc --all --limit 1000` → add `--full` |
| anything the flags can't (duration, tokens, loops, histograms) | `agenteye --json query run --sql "…"` over `events`/`evaluations`/`agent_sessions` · `query schema` for columns |

**Run them *properly* — the gotchas that make a command lie:**

- **Globals go before the command:** `agenteye --json events …`, never `agenteye
  events --json` (exit 2).
- **`--all` is capped by `--limit` (default 50).** A bare `--all` returns 50 rows and
  looks complete. Always `--all --limit 1000`; bigger needs cursor paging.
- **`--since` is a closed enum:** `all` `15m` `1h` `6h` `24h` `7d`. Anything else is a
  usage error — use `--from`/`--to` with RFC3339 instead.
- **`evals`/`errors` filters are single-valued** (a repeated flag = last wins);
  `sessions`/`events` take CSV and repeats.
- **Keep `--full` bound to one `--session-id`** — it's slow at scale.
- Needs `events:read`; `evals` also needs `evaluations:read`.

## The eval-plan artifact

The written deliverable. Structure it so every dimension traces back to a number, and
so the "rejected" list shows the work.

```markdown
# Eval plan — <agent name / agent_id>
_Status: proposed · not yet built · <date>_

## What this agent does
1–2 lines: the agent, its users, and what "good" means (from the interview).

## Population scan (the data behind the plan)
The queries that framed this, with their numbers: session volume + status split,
error-type breakdown, existing score distributions, and any SQL histograms
(duration / tokens / tool loops). Every dimension below traces back to something here.

## Sessions reviewed
| session_id | user's verdict | one-line shape | how it ended |
|---|---|---|---|
| run-8842 | bad | search ×5, no answer | no agent_end (never finished) |
| run-9001 | good | 2 tools, answered | clean agent_end |
_This corpus grounds every dimension below._

## Proposed dimensions (N = 2–4)
### <score_key>  ·  <rate | magnitude | label>  ·  <rule | judge>
- **Definition:** what the number means, and which direction is good.
- **Why it matters:** the failure it catches, in the user's words.
- **Grounded in:** session <id> — <the concrete thing you saw>.
- **Signal source:** event types + payload fields (e.g. `tool_use.tool_name` +
  `.input`; pair `tool_result` via `tool_call_id`).
- **Data backing:** the query/queries run + what they returned — prevalence across the
  population (e.g. "34% of error sessions") and the field-populated check.
- **Discrimination evidence:** measured across cohorts — good ≈ <value>; bad ≈
  <value> (from `<query>`) — the gap.
- **Method:** rule (count/ratio) or judge (reads <field>); if judge, note the
  async / 30s implication for build.
- **Open questions / risks:** ground-truth gaps · is the field actually populated in
  their data · thresholds still to pick · non-rate shape to confirm against the SDK
  contract.

## Considered but rejected
| candidate | why rejected (with the number) |
|---|---|
| customer-returned-next-week | not in the transcript — no such event |
| answer correctness | needs ground truth we don't have; parked for a judge + labeled set |
| helpfulness (generic) | didn't discriminate — good and bad both ≈ 0.8 across 40 sessions |

## Open decisions for the user
- Final score-key names (permanent — renaming splits history).
- Any failure mode above that none of these catch?

## Next step (your choice)
Save this · build it (→ build mode, rule-first, tested against session <id>) · keep
brainstorming. Nothing here is built yet.
```

One caveat to carry into every dimension's **open questions**: the SDK types a score as
a plain number (`references/sdk-api.md`). A plan may legitimately call for a
**magnitude** or **label** shape — but *how* to emit a non-rate shape is a build-mode
detail. Name the intended shape here and confirm the representation against the SDK
contract when you build; don't assert it in the plan.
