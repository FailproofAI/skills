---
name: failproofai-audit-author
description: |-
  How to set up a FailproofAI Cloud (AgentEye) AUDIT that looks for the right failures at a sensible scope and cost: turn an intent into the audit form (scope, cadence, window, sensitivity, failures per run, errors to ignore, notify, notes), name the deterministic signals it relies on, preview what it would read and flag over the last window, and say when an alert, an evaluation or a policy is the better tool.

  Trigger when the user wants to:
  • set up a recurring sweep — "sweep the customer-facing agents weekly for leaked keys", "a daily reliability review of prod";
  • tune an audit — too noisy, finds nothing, too expensive, wrong agents;
  • decide whether an audit is the right tool at all.

  NOT for writing alerts, evaluations or policies themselves (`failproofai-alert-author`, `failproofai-eval-author`, `failproofai-policy-author`).
---

# Setting up an audit

An audit is a SCHEDULED investigation of a slice of the fleet. Every run does two things:

1. **A deterministic floor** — no model, always runs: the policy catalog (secret / PII /
   injection / denial patterns over raw payloads) plus the runaway-tool-loop check, and
   the lenses (fleet-wide SQL aggregates: unfinished sessions, broken event contracts,
   tools an agent never uses, ordering pathologies, cohort drift, contract prohibitions).
   Policy hits become findings directly; lens results become LEADS.
2. **An LLM investigation** — three specialists read the leads and a bounded number of
   transcripts (measured: ~20–35 sessions a run, whatever the scope size) and file at most
   `top_k` evidenced failures, steered by the description, the notes and the sensitivity.

So the cost of a run is roughly FIXED per run (the step budget caps it), not per session:
an hourly audit costs ~24× a daily one. And a huge scope is not read more thoroughly —
coverage just drops.

Read `signals` for what each signal id catches and `form` for every field. The mechanics
of the steps below differ by where you are running — see `references/dashboard.md` (the
dashboard assistant, which runs them all and previews the result in one call) or
`references/cli.md` (a coding agent with `fp`). You will have one of the two, not both.

## The procedure

1. **Intent → failure.** Name the failure in one line ("an `sk-` key in a tool argument",
   "sessions that never finish"). If you cannot name one, ask; an audit "for problems"
   finds whatever the model happened to open.
2. **Is an audit the right tool?** (see `wrong-tool`)
   - must be STOPPED before it happens → a policy;
   - must page someone within minutes on a rate/threshold → an alert;
   - a per-session quality score to trend → an evaluation;
   - a recurring sweep that reads, judges and files issues → an audit.
   Say so when another tool fits better; still draft the audit if the user wants one.
3. **Scope.** Only agent ids and environments that exist in this org's data. Map nicknames
   ("triage") to the real id. Unnamed → all. Check sessions/day for the scope: zero
   means the scope is wrong (a typo, a dead environment).
4. **Signals.** Pick the catalog ids / lenses the failure maps to, then LOOK at how often
   each occurs in this org. A signal at 0 is fine for a "make sure it never happens"
   sweep, but say so; a signal flagging a large share of sessions is noise.
5. **Sensitivity.** low = only clear, repeated failures ("low-noise"); high = rare or weak
   signals worth a look (customer-facing, PII, money); medium otherwise.
6. **Schedule and window.** Cadence from the user's words (hourly / 6h / daily / weekly;
   default daily). Window `since_last` reads exactly what is new since the last run; a
   fixed window (24h/3d/7d/30d) re-reads overlapping data — right for a "review of the last
   7 days", wasteful otherwise.
7. **Budget.** Estimate per-run cost from this org's past runs; multiply by runs per day.
   Hourly is for high-stakes, low-volume scopes; prefer daily otherwise.
8. **Noise controls.** `ignore_errors` only for error types the user calls known noise and
   that exist in the data. `top_k` 3–5 for a focused audit, up to 15 for a broad review.
9. **Notes.** What the investigation should know: the failure, the exact patterns, the
   agents' purpose, prohibitions as "Must not …" lines. Specific beats generic.
10. **Preview, then repair once.** Reads nothing → fix the scope or widen the window.
    Floods → narrow the scope, lower sensitivity, or use a policy/alert. Then hand the
    fields to the form with the preview line; the user presses create.
