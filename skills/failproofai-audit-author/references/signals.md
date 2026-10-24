# Signals — what an audit can actually detect

Ids are the server's own: the deterministic policy catalog and the lenses. Every policy
runs on every audit regardless of the form; naming one in a draft says what the audit is
FOR and what the preview counts.

## Deterministic policies (findings, no model)

| id | severity | matches (over the whole event payload) |
|---|---|---|
| `secret-aws-access-key` | critical | `AKIA` + 16 upper/digits (inline base64 media stripped first) |
| `secret-api-key-token` | critical | `sk-` + 19 or more key chars, after a word boundary (short test keys do NOT match) |
| `secret-private-key` | critical | a PEM `-----BEGIN … PRIVATE KEY-----` block |
| `secret-jwt` | warning | a three-part `eyJ….eyJ….…` token |
| `secret-authorization-bearer` | warning | `authorization` then `bearer ` (case-insensitive) |
| `secret-env-assignment` | warning | `api_key / secret / password / token … = / :` assignments |
| `prompt-injection-markers` | warning | "ignore previous instructions", "reveal your system prompt", "jailbreak", … |
| `pii-ssn` | info | a `NNN-NN-NNNN` number (heuristic) |
| `tool-permission-denied` | warning | a `tool_use` whose payload says permission denied / forbidden / unauthorized |
| `runaway-tool-loop` | warning | a session calling the same tool 10+ times |

A policy hit is ONE finding per policy per run (count + sample sessions), never the
matched text. Policy findings bypass `top_k`.

## Lenses (leads for the investigation)

| id | what it measures |
|---|---|
| `task_completion` | sessions that never emit `agent_end` or end in `session_reset`, per agent, vs its 30-day baseline |
| `contract_invariants` | broken harness promises: tool calls without results, hooks without completion, starts without ends |
| `negative_space` | tools an agent never (or almost never) uses |
| `sequence_pathologies` | ordering defects: retry loops, ping-pong, long stalls between events |
| `cohort_drift` | a regression confined to one build / machine / channel, or a shift vs the prior period |
| `prohibited_actions` | the `Must not` bullets of each agent's contract (agent.md), matched against tool inputs/outputs |

`prohibited_actions` reads AGENT CONTRACTS, not the audit's notes: a prohibition only
becomes a deterministic check once it is a `Must not` bullet in that agent's contract.
Notes still steer the investigation.

## Which intent maps to which signal

- leaked keys / tokens / credentials → the `secret-*` policies that fit the shape named;
  "API keys or tokens" → `secret-api-key-token` + `secret-authorization-bearer`
- PII, SSNs → `pii-ssn`
- prompt injection → `prompt-injection-markers`
- denials, blocked tools, permission errors → `tool-permission-denied`
- loops, retries, stalls → `sequence_pathologies` (+ `runaway-tool-loop`)
- reliability, failed / unfinished work → `task_completion` (+ `contract_invariants`)
- destructive or forbidden actions → `prohibited_actions`
- "got worse", regressions, one build → `cohort_drift`
