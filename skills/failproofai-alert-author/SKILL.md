---
name: failproofai-alert-author
description: |-
  How to write a FailproofAI Cloud alert that fires when it should and stays quiet otherwise: pick the trigger kind from the intent (error event, metric, score, saved query), read the org's own baseline for that number, set window, threshold and "how sure" from it, replay the rule over the last 7 and 30 days, and repair it once if it is noisy or silent.

  Trigger when the user wants to:
  • be told when something happens — "tell me when billing starts throwing errors", "page me on a latency spike";
  • fix an alert — it fires all the time, it never fired, it fires on the wrong agent;
  • choose between an error, metric, score or query alert.

  NOT for deciding what to evaluate (`failproofai-eval-brainstorm`), blocking tool calls (`failproofai-policy-author`), or periodic reviews of many sessions (audits).
---

# Writing an alert

An alert is a rule the server checks on a schedule: every `every` it computes ONE number
over the last `window`, compares it to a threshold, and opens an issue (and notifies) when
enough recent checks crossed. Issues do not auto-resolve — later breaches ride on the open
issue — so the cost of a bad alert is pages, and a page nobody acts on teaches people to
ignore the channel.

    intent → trigger kind → the org's baseline for that number → window / threshold / sure
           → replay 7d + 30d → one repair → form values + "would have fired N× in 7 days"

The mechanics differ by where you are running — see `references/dashboard.md` (the
dashboard assistant, which runs this whole loop in one call) or `references/cli.md` (a
coding agent with `fp`: the baseline and the replay by SQL, the alert on the form or with
`fp alerts create`). You will have one of the two, not both.

## 1. Pick the trigger kind from what the intent can filter

| form trigger | server kind | fires when | can filter |
|---|---|---|---|
| `error` | per_event | ≥ 1 matching event in the lookback | event type (required), error type, **agent**, environment |
| `metric` | metric_threshold | the metric over the window crosses the threshold | environment; event type (event_count only). **Not agent.** |
| `score` | evaluation_score | the AVERAGE of a score over the window crosses (≥ 3 scores) | score key, environment |
| `query` | custom_sql | a saved query's `metric_value` crosses (no threshold: any row) | anything SQL can say: agent, payload fields, outcomes |

Rules that decide it:
- "Every time X happens" and X is rare → `error`. "A spike / a lot of / above normal" → a
  number with a threshold: `metric`, or `query` when the scope needs an agent or a payload
  field. An `error` alert has NO threshold: on a busy signal it fires every check.
- One agent + a threshold → `query` (metric rules cannot filter agent).
- Anything the metrics do not count — failed `agent_end` outcomes, policy denials by name,
  a payload value — → `query`.
- The six metrics: event_count, error_count (events of type `error` + anything with an
  `error_type`, which includes policy denials on `hook_completed`; NOT failed tool results),
  error_rate (that count / all events), p95/p99 latency (ms, over EVERY event with a
  duration — whole agent runs included, so latency of tool calls alone is a `query`), tokens.
- A score → `score` with the org's own score key (never invent one).

Details per kind, and the exact form grammar: read `triggers`.

## 2. Ground every number in this org's history

Never pick a round threshold from intuition. Compute the alert's OWN number at its OWN
window over the last 7 and 30 days — one value per check — and read its p50 / p95 / p99 /
max. Demo and real traffic are bursty: the median window is often 0 and the p95 is
hundreds of times larger, so "the average" is the wrong reference.
- A threshold sits above the p95–p99 of the per-check value (below the p5 for a score
  that drops), so it fires on the tail, not on the body.
- When the user names the number ("above 2.4 s", "below 0.7"), use theirs — then report
  what it would do, and suggest a change only if it is far off target.
- Use real names: environments, agents, error types and score keys exactly as the org
  spells them.

## 3. Replay before you show it

Replay the rule the way the server runs it: one check per `every`, the window sliding, the
"m of n" ring, one page per hour while it keeps breaching. Report fires in 7 days, fires in
30 days, and when it last fired. Target: **about one fire a day at most** unless the user asked
for something else; and an alert on a condition that really occurs should fire at least once in
30 days. How to read and repair: `noise`.

## 4. Routing and the words

- severity: `critical` = someone acts now (pages); `warning` = look today; `info` = FYI.
- name: what fired, in plain words ("billing errors spike"). meaning: one line — who should
  care and what to do first.
- Channels (email, Slack, webhook) are chosen on the form by the person; a draft does not
  set them.

## 5. What to tell the user

One line: what the rule is, then the replay — "would have fired 4× in the last 7 days (last:
Oct 11 18:50 UTC), 9× in 30". If it was repaired, say what changed and why ("raised the
threshold from 50 to 320: at 50 it would have fired 30× a day"). If a `query` alert needs a
saved query that does not exist yet, say so: the form picks saved queries by name.
