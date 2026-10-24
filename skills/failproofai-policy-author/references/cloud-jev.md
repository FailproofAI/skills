# Writing and deploying policies in FailproofAI Cloud

A FailproofAI Cloud policy has a **kind**, picked when you write it: `regex`, `jev` or `both`.
Everything else (which machines, which agents, enforce or observe) is chosen when it is
deployed. *What you can write and deploy* has the whole picture.

Jev checks run on FailproofAI Cloud; nothing of them is installed on the machine. A machine
with any `jev` or `both` policy deployed sends each gated tool call to FailproofAI Cloud, which
asks the checks deployed to that machine for the calling agent and returns their verdict.

A `both` policy is one item: deployed, toggled and rolled back together, so a machine never
gets the regex floor without the checks that review it. Cloud derives the module's
`authority: "reviewable"` and `reviewedBy` from the policy's own check names; never write
either in the module (publish refuses a module that mentions `semanticPolicies`,
`authority`, `reviewedBy`, `reviewable` or `userCanOverride`, comments and strings included).

## Contents

- What you can write and deploy
- Pick the kind
- The declaration
- Probes that decide
- What Jev sees
- Both: a regex floor its own checks review
- Names, limits and budget
- Mode, rollout and backtest

## What you can write and deploy

| kind | you write | pick it when | on the machine |
|---|---|---|---|
| `regex` | a module (`customPolicies.add`) | a string in the call decides it | the module, always hard |
| `jev` | Jev checks, JSON | nothing in the call decides it | nothing: FailproofAI Cloud asks the checks |
| `both` | a module and its own checks | a string half-decides it, noisily | the module, its blocks reviewable by its checks |

Chosen per machine and per policy at deploy, never written into the version:

- **Effect**: `enforce` (block), or `observe` (watch: blocks nothing, records what it would
  have done) — for every kind: a module, a `jev` policy's checks, both halves of a `both`.
  There is no Jev mode to choose: FailproofAI Cloud runs Jev on a machine whenever a `jev` or
  `both` policy is deployed to it.
- **Agents**: all (the default), an integration (`claude`, `codex`, `copilot`, `cursor`,
  `opencode`, `pi`, `hermes`, `openclaw`, `factory`, `devin`, `antigravity`, `goose`; with its
  future profiles), or one exact profile from that machine's roster (`agt_<hex>`; up to 256).
  Up to 32 targets an assignment, matched if any matches; a target covers the module and the
  Cloud checks alike. A call whose profile cannot be identified matches no targeted
  assignment (`agent_scope_unresolved`); untargeted ones still apply.
- **Budget**: 27,591 characters of questions per Jev request, for the Cloud checks that apply
  to one agent; checks targeted at different agents do not share it.

So a version never decides which agent it is for. *"Block force-pushes, only in Codex"* is
the rule with no agent test, deployed with agents → **all codex profiles**
(`fp fleet deploy <machine> --target no-force-push=codex`). *"Only my work Hermes profile"* is
the same rule targeted at that profile, **hermes / work (agt_…)**
(`--target no-force-push=hermes/agt_<id>`). `ctx.cli` is for harness mechanics, a tool or event
name only some integrations have: as a scope it ties the version to one integration and
cannot tell two profiles apart, and no Jev check is shown the agent at all.

## Pick the kind

- A string in the call decides it (a flag, a path, a tool name): `regex`.
- Nothing in the call decides it (the real target, the environment, whether the user asked
  for it): `jev`.
- A string half-decides it and the regex is noisy on harmless shapes: `both`. The module blocks
  every shape; Jev clears the harmless ones.
- Something a forged "the user asked for it" must never unlock (irreversible deletes, credential
  access, privilege escalation, running code fetched from the internet): `regex`, kept hard, or
  checks with `userCanOverride: false`.
- The operator names an exception to a pattern — "block X, but allow it when the user asked",
  "… except inside build/", "… unless it only reads": `both`, even for deletes. X is the module,
  hard everywhere the exception does not reach; the exception is its own check.

## The declaration

The same entry a failproofai pack manifest carries for a semantic policy, as JSON:

```json
{
  "name": "acme-db-migration-on-production",
  "title": "Tried to run a schema migration against a production database",
  "appliesTo": ["shell"],
  "mode": "deny",
  "userCanOverride": true,
  "probes": [
    { "id": "applies_migration",
      "instructions": "The command in `agent_request` APPLIES database schema migrations: `prisma migrate deploy`, `knex migrate:latest`, `alembic upgrade`, `rails db:migrate`, or an equivalent, however the binary is spelled or pathed.",
      "criteria": { "true": "Running it would change a database schema.",
                    "false": "It only creates, lists, checks or previews migrations (`--create-only`, `status`, `--dry-run`)." } },
    { "id": "production_target",
      "instructions": "The database it targets is production or shared, or cannot be told from the command, its flags, or the environment variables set inline on it.",
      "criteria": { "true": "Production, shared, or unknown database.",
                    "false": "Clearly local or throwaway: localhost, a docker-compose service, a sqlite file, an env named dev, test or local." } }
  ],
  "guidance": "Run migrations against a local or staging database, or hand the command to a human to run against production."
}
```

- `title` is past tense and names what the agent tried; it is what the operator reads.
- `appliesTo`: `shell` (Bash), `write` (Write, Edit), `read` (Read, Grep, Glob), `network`
  (WebFetch, WebSearch), `other` (MCP and unknown tools, which are asked every check anyway).
- `mode`: `deny` blocks at evidence ≥ 0.85 and warns from 0.7; `instruct` only ever warns.
- `userCanOverride` is required and has no default. `true`: the user asking for the operation
  (real or forged) allows it, and a step of the user's task softens a deny to a warning.
  `false`: neither.
- `precondition` (optional) is a name, not code: `always`, `protected_branch`, `in_git_repo`,
  `has_paths`, `paths_outside_project`, `system_or_root_paths`. The check is asked only when it
  holds.
- `exempt` (optional) is one more question; when it holds (≥ 0.5) the check never fires.
- `guidance` is shown to the agent when the check fires: say what to do instead.

## Probes that decide

The check fires only when **every** probe holds (its evidence is the lowest answer). A check
that does not fire answers "no concern", so every probe must be **true for the harmful call**
and false for the harmless one.

- Each `instructions` **states the harmful claim** as a sentence, never a question and never
  the harmless case. Put the "does it do X" probe first, then what makes it harmful.
- Jev sees the call **before** it runs. Say what `agent_request` requests or would do, never
  that it "executes", "ran" or is "actual": "executes a Git push" scored 0.44 on a plain
  `git push --force origin main` and cleared the block; "would run a Git push" scored 0.97.
- `criteria.true` and `criteria.false` spell out each side, with the harmless look-alikes under
  `false`: read-only variants, local targets, a command merely quoted in a search.
- When "the user did not ask for this" is the concern, make it a probe ("The branch this
  command pushes to does not appear anywhere in `user_said`."), not a job for
  `userCanOverride`. An inverted probe ("the branch appears in `user_said`") fires on the
  requested push and clears the unrequested one.
- Two or three sharp probes beat six vague ones; every probe is a question paid for on every
  matching call.

## What Jev sees

Only this, so probes may talk about nothing else:

- `agent_request`: the tool and its input, as the agent requested it (it has not run);
- `user_said`: what the human typed in the session, oldest first;
- `facts`: computed by code and correct — `cwd`, `project_root`, `current_git_branch`,
  `paths[]` with each path's relation to the project.

No conversation history, no tool output, no file contents beyond what the call itself carries.

## Both: a regex floor its own checks review

The module fires on every shape of the concern; Jev clears a block only when **every** one of
the policy's checks was asked about the call and **none** answered deny. So:

- **Cover every shape.** The checks' `appliesTo` and `precondition` must include every tool
  and case the module fires on: a check never asked leaves the block permanent.
- **Model every shape.** For each shape the module fires on, write its harmful case and read
  every probe against it. A probe that is false for a harmful shape answers "no concern" and
  clears that block with no warning.
- **Leave something that can deny.** At least one deny-mode check, or the block becomes a
  warning once cleared. Where the block must hold even when the user asks, use
  `userCanOverride: false`.

## Names, limits and budget

- A check name is unique across the org's policies; the next version of the **same** policy
  may keep its names. FailproofAI's sixteen built-in check names are refused.
- At most 24 checks per policy and 6 probes per check. Probe ids match
  `^[a-z][a-z0-9_]{0,31}$` and may not be `exempt` or `user_asked`. Title ≤ 120 characters,
  instructions ≤ 600, each criterion ≤ 300, guidance ≤ 600.
- **The question budget.** Every check that applies to a call is asked in ONE Jev request,
  which carries at most **27,591 characters of questions**. A check costs the JSON of its
  questions: each probe's (and the exemption's) instructions and criteria, plus about 430
  characters when `userCanOverride` is true. A typical check costs 600–1,800. FailproofAI Cloud
  checks are asked first: when a call's whole set (Cloud plus the machine's installed packs) is
  over the budget, installed packs' checks are dropped first and each drop is reported.
  FailproofAI Cloud refuses a policy version whose own checks exceed the budget, and a deploy
  whose Cloud checks together would exceed it. So keep probes short and concrete, write
  criteria only where they add something, and prefer a few sharp checks to many vague ones.
- Publish is the only validation a check gets: FailproofAI Cloud refuses a declaration the
  CLI's own parser would not accept, so a published check is always asked.

## Mode, rollout and backtest

- Roll a new policy out in `observe`, read what it would have done, then `enforce` — the same
  per-policy effect for every kind. An observed `jev` or `both` policy's checks are asked and
  only recorded; an observed `both` module blocks nothing.
- The machine's Jev mode is FailproofAI Cloud's, derived from the deployed set (`enforce` with a
  Jev policy, `off` without); nobody sets it.
- Backtest before publishing. The regex half replays against your stored traffic as usual. The
  Jev half asks Jev about a sample of past calls matching `appliesTo` (at most 50 per run),
  shows the call count before it runs, and counts those calls against the org's daily Jev
  allowance. It reports each check's fire rate with examples; preconditions and the user's
  words are not reconstructed from history, so treat a gated check's rate as an upper bound.
  It also shows what the checks cost of the question budget. From a terminal:
  `fp policies backtest --semantic checks.json` (add the module file for `both`) is the free
  estimate; add `--run --sample N` to ask Jev, after the user agrees to the spend.
