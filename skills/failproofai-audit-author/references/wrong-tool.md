# When an audit is the wrong tool

| the user needs | use | why not an audit |
|---|---|---|
| the action STOPPED before it runs (force push, `rm -rf`, a secret leaving) | a policy (`failproofai-policy-author`) | an audit reads after the fact; at best hourly |
| someone paged within minutes when a rate or count crosses a line | an alert (`failproofai-alert-author`) | an audit runs on a schedule and files issues, it does not page |
| a per-session score to trend or gate on (helpfulness, correctness) | an evaluation (`failproofai-eval-author`) | an audit samples ~20–35 sessions a run; an evaluation scores every one |
| a one-off question about the data | a query / the answer itself | a schedule for a question asked once is noise |
| a recurring sweep that reads transcripts, judges, and files evidenced issues | an audit | — |

Combinations are normal: a policy blocks force pushes, an audit sweeps weekly for the ones
that slipped through other paths. Say which half each tool covers.

Signs in the data that another tool fits better:
- the pattern the user describes only appears inside PreToolUse hook payloads (the policy
  layer already sees it) → a policy enforces it; the audit only reports it;
- the signal is a plain rate on error events (errors/hour, latency) → an alert;
- the question is "how good" rather than "what went wrong" → an evaluation.
