Return ONLY a single JSON object, no prose and no markdown fences.

ALWAYS these keys:
  "kind":             "code", "jev" or "judge"
  "display_name":     short human label, e.g. "Tool error rate"
  "eval_key":         matches ^[a-z][a-z0-9_]*$  (lowercase, digits, underscores; starts with a letter)
  "labels":           a JSON array of 1-3 short lowercase tags — see LABELS
  "condition_source": a Python expression returning bool, or "" to always run —
                      see WHEN TO WRITE A CONDITION
  "reasoning":        one or two sentences on what the evaluation measures

WHEN "kind" IS "code", ALSO:
  "result_kind":      one of "score" | "metric" | "assertion"
  "evaluator_source": a Python expression returning EvalResult(...)

WHEN "kind" IS "jev", ALSO (and NO "evaluator_source" — it is assembled for you):
  "jev_type":         "score" for "how much X is this", "noul" for "is X true"
  "instructions":     the question, as ONE sentence. Jev answers exactly this
                      and nothing else, so make it specific and self-contained.
  "criteria":         for "score", an ARRAY of 3-5 rubric levels, WORST FIRST.
                      for "noul", an OBJECT: {"true": "...", "false": "..."}
                      describing what each answer means.
  "threshold":        a number 0-1; the score at or above which it passes. 0.7
                      is a sensible default.

  WORST FIRST IS NOT A STYLE CHOICE. Jev treats the first level as the lowest,
  so a rubric written best-first inverts every score and nothing anywhere says
  so. Write ["Failed", "Partial", "Complete"], never the reverse.

  A NOUL SCORES THE PROBABILITY THAT THE ANSWER IS TRUE, and it passes when that
  is at or above the threshold. So TRUE must be the GOOD outcome: ask "Did the
  agent stay polite?", never "Was the agent rude?" — phrased as the violation,
  every violating session passes and every clean one fails.

  THREE TO FIVE LEVELS, AND THIS IS MEASURED. The same question over the same
  session scored 0.00 with two levels, 0.01 with three, and 0.55 with ten: too
  few and it behaves like a yes/no, too many and it hedges toward the middle.
  Two levels is never right — use "noul", which does that better. Four is a good
  default.

  Each level must be a DISTINGUISHABLE state, not a grade. "Not grounded",
  "Partly grounded", "Fully grounded" works. "Bad", "OK", "Good" does not —
  it says nothing about what separates them.

  A condition still matters, for the same reason as a judge though less
  sharply: jev costs a model call per session, just a much cheaper one.

WHEN "kind" IS "judge", ALSO (and NO "evaluator_source" — it is assembled for you):
  "criteria":         one or two sentences saying what good looks like, written
                      as a REQUIREMENT: "The assistant must not promise a refund
                      without first checking the refund policy."
  "threshold":        a number 0-1; the score at or above which it passes. 0.7
                      is a sensible default.
  "steps":            3-5 short instructions telling the judge how to assess it.

  A CONDITION MATTERS MUCH MORE FOR A JUDGE. Every session it runs on costs a
  model call, so an unconditioned judge bills on 100% of traffic. Write a cheap
  code condition that narrows it to the sessions the question is even about —
  `session.count("tool_use") > 0`, `session.count("error") > 0`. Only leave
  "condition_source" empty when the question genuinely applies to every session.

  WRITING STEPS — THIS DECIDES WHETHER THE SCORE IS MEANINGFUL.
  The judge scores CONTINUOUSLY, from 0 to 1. Steps that name specific numbers
  break it: "Score 0 if X; score 1 if Y" made a completely correct session score
  0.1 while the judge's own explanation described correct behaviour. The same
  criteria phrased continuously scored 1.0 every time.

  So: NEVER write a digit in a step. Never write "score 0", "score 1", or
  "give a score of 0". Describe what to look for, then say which direction it
  moves the score:

    "Determine whether the assistant promised, approved, or issued a refund."
    "If it did, determine whether a policy-verification tool was called first."
    "Award a high score when policy was verified first, or no refund was made."
    "Award a low score when a refund was committed with no prior verification."

  The judge sees the conversation as turns, INCLUDING each tool call the agent
  made and what that call returned, in order. So "did it do X before Y" is a
  fair question to ask — write steps that lean on that ordering.

WHAT A JEV OR A JUDGE ACTUALLY READS — ask only what this can answer.
  Both read a transcript built from these event types, in order:
    human_input      -> a user turn (payload "response")
    model_response   -> an assistant turn (payload "content")
    tool_use         -> a tool call, with its tool_result "output" or "error"
    model_request    -> ONLY in a session with no human_input: the text of its
                        last user message, as a user turn (about 4000 characters,
                        both ends kept). Images and system messages are never
                        shown.
  Each other turn is cut to about 1000 characters and each tool output to about
  500. agent_start / agent_end payloads and every other event are never shown.
  So "was the answer correct for its input" is answerable for a single-shot
  pipeline (its prompt is shown) but NOT when the deciding evidence is an image
  or sits in the middle of a very long prompt; then ask about what the turns
  show (specificity, internal consistency, what the tools returned), use
  "code", or say in "reasoning" what is not visible.
  A session with none of these event types fails as not conversational, so give
  every jev and judge a condition that requires one, e.g.
  session.count("model_response") > 0.

LABELS: 1-3 SHORT lowercase tags saying what the evaluation is ABOUT, chosen so
related evaluations group together on the definitions list — quality, safety,
cost, latency, tooling, reliability, correctness are typical ones. A tag is a
CATEGORY, never a restatement of the display name and never a sentence: "Tool
error rate" is ["reliability", "tooling"], not ["tool error rate"]. Lowercase,
no punctuation, at most 64 bytes each. Return [] only if genuinely nothing
applies.
