# Candidate patterns

Worked mappings from what you *saw* to what you can *measure*. Use them to name a
candidate fast, then put it through both gates — a pattern from this table is still
a guess until its fields are confirmed present and its gap is computed.

## Observation → candidate

| What you saw in the sessions | Candidate measurement |
|---|---|
| bad runs repeat the same call four to six times | repeat rate — calls identical to the previous call, over total calls |
| bad runs never reach an end event | completion — did the run finish |
| a tool is called and never once succeeds | per-tool success rate, scoped to that tool |
| the agent calls a tool with arguments its schema forbids | invalid-argument rate (points at a wrong tool description) |
| some runs burn many times the work for the same goal | volume — calls, model round-trips, or events per run |
| a human had to step in | intervention count, or the wait time before they did |
| the run ends by telling the user to contact someone else | deflection rate |
| a sub-agent is spawned and its result never comes back | orphaned-handoff rate |
| the run says it did something its own results contradict | **needs a judge** — see below |
| errors cluster in one environment or one build | any of the above, scoped by a condition |

## Picking the result kind

Let the phrasing decide it. These map one-to-one, and getting it right first time is
most of what makes a prompt compose cleanly:

| The measurement is… | Kind | Phrase it as |
|---|---|---|
| a fraction, a rate, a ratio — bounded 0 to 1 | **score** | "Fraction of…", "Ratio of… to…" |
| a count or a quantity with a unit — unbounded | **metric** | "How many…", "Number of…", "Total… in the session" |
| a yes/no fact about the run | **assertion** | "Did the agent…?", "Did every… get a…?" |

Default to **score** for anything you want to watch a trend on. A rate is comparable
across sessions of different sizes; a raw count is not, and a count that rises because
runs got longer looks like a regression that is not there.

## Rules before judges

Two ways to compute anything here:

- a **rule** — counting, ratios, thresholds over the event stream. Deterministic, free,
  instant, and it explains itself.
- a **judge** — a model reads the conversation text and decides. Subjective, costs
  latency and money, and needs its own prompt kept honest over time.

**Default to the rule.** Reach for a judge only when the signal genuinely lives in free
text and no count approximates it — "was the final answer correct", "did it follow the
policy it was given". When you do propose one, say so in the proposal: it changes the
cost and the review the user is signing up for.

Many things that *feel* like judge territory have a rule hiding in them. "Did it give
up?" is usually "did the run end without reaching an end event". "Was it confused?" is
often "how many times did it call the same tool with the same arguments". Look for the
count before reaching for the model.

## Generic versus theirs

There is a floor of measurements that work on any agent because they read the core
event stream rather than anyone's custom payload: error rate, completion, tool success,
calls per run, round-trips per run, hook allow/deny, human waits.

**These are safe and they are also undifferentiated.** They are worth proposing when
the user has nothing at all — something measured beats nothing — but they are not why
anyone needs a brainstorm. The proposals that earn the session are the ones reading the
keys only *this* user's agents emit: their order id, their tenant, their retrieval
score, their stage name, their model version.

So spend the payload profile well. Scan it for keys that look like a **status**, a
**stage**, a **verdict**, a **score**, a **version**, a **channel**, or a **cost** — those
are where the user's own semantics live, and an evaluation over one of them measures
something nobody else could have proposed.

## Conditions — when a measurement should not run everywhere

An evaluation can carry a condition that decides which sessions it runs on at all.
Reach for one when:

- the measurement only makes sense for one agent, one environment, or one build;
- the population is mixed and an average over all of it means nothing (a retrieval
  score across sessions that never retrieve anything);
- you are scoping to a stage — only sessions that got as far as checkout.

Two cautions. A condition that excludes everything produces an evaluation that never
runs and reports nothing — it looks deployed and is inert. And a condition reading a key
that is not present excludes every session for that reason, which is the same failure
wearing a different hat. Both are caught by the authoring page's backtest, but proposing
them wastes the user's round trip, so check the condition's fields in the payload profile
exactly as you check the measurement's.
