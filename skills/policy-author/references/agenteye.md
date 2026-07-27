# Sourcing policy work from AgentEye

[AgentEye](https://app.befailproof.ai) is the observability side of the same story: failproofai
enforces inside the agent loop, AgentEye records what happened across the fleet. Where the
local `failproofai audit` reads one machine's transcripts, AgentEye holds every session from
every agent in an org — so it sees things a local audit structurally cannot.

Everything here was verified against a live deployment (org `demo`, `agenteye` 0.1.13).

## Preflight

```bash
agenteye whoami            # exit 4 = not logged in; you cannot fix this — see below
```

If not logged in, **stop and ask the user to run `agenteye login --email <them>`** — it needs
a one-time code emailed to them, so you cannot complete it. Note the permissions `whoami`
prints; they decide what you may do at the end (see "Closing the loop").

Add `--json` to **every** command — it prints machine-readable output and nothing else.

## Three sources of policy work

AgentEye answers three different questions. Check all three; they produce different policies.

### 1. Findings already classified as policy-shaped

AgentEye tags each finding with a `kind`. **`kind: policy` means it is enforceable** —
`improvement` and `failure` are code or instrumentation work and are not yours.

```bash
agenteye --json audits findings --limit 100 --show-id \
  | jq '.findings[] | select(.kind == "policy") | {id, title, severity, status}'
```

`--show-id` is not optional: `audits finding <id>` **requires the full UUID**. The short id
in the table looks usable and is rejected with `no finding <id>`, exit 6 — the CLI reference
says short ids are accepted, and for this subcommand they are not.

Then read one in full:

```bash
agenteye --json audits finding <FULL-UUID>
```

The fields that matter:

| Field | Use |
|---|---|
| `description` / `root_cause_hypothesis` | what happened and why — the policy's rationale |
| `recommendation` | AgentEye's own fix. Often names the mechanism ("add a pre-tool-use hook that rejects…") |
| `evidence.queries` | **runnable SQL, often containing the exact regex** |
| `evidence.policy_id` | AgentEye's internal rule id, e.g. `secret.credential_in_tool_args` |
| `scope` | narrows it — e.g. `{"tool": "db.query"}` |
| `occurrences`, `evidence.matched_sessions` | how much this actually happens |

A real one, verbatim: *"Credential-shaped strings passed to db.query in production"*, whose
evidence query carries `match(payload, '(AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,})')`.
That regex is the pattern to enforce — but **run it through §2.1 builtin-first anyway**:
`sanitize-api-keys` and `sanitize-bearer-tokens` already cover those two shapes, so the
answer is mostly config, and a custom policy only covers what the builtins miss.

### 2. Hook failures — policies that are silently enforcing nothing

**The one thing a local audit can never tell you.** failproofai fails open (`traps.md` §3):
a policy that throws or times out returns allow, and nothing surfaces. Locally that is
invisible. AgentEye records every hook outcome, so the gap is a query:

```bash
agenteye --json query run --sql "
  SELECT JSONExtractString(payload,'hook_name') AS hook,
         JSONExtractString(payload,'outcome')   AS outcome,
         count() AS c
  FROM events
  WHERE event_type = 'hook_completed'
    AND JSONExtractString(payload,'outcome') NOT IN ('ok','approved')
  GROUP BY hook, outcome ORDER BY c DESC LIMIT 20"
```

Live demo output included `pre_tool_use failed 877` and `pii_redactor failed 702`. Every one
of those is an action that ran **unguarded** while the dashboard showed a hook installed.

This is not a policy to author — it is a **broken policy to report**. Tell the user which
hook is failing and how often, and treat fixing it as higher priority than any new policy:
a policy that fails 877 times is worth less than nothing, because it looks like protection.

### 3. Denial patterns — policies that are too strict

A steady denial rate means an agent keeps attempting something it will never be allowed to
do, burning a turn each time. AgentEye raises this itself (*"180 tool calls were blocked by a
policy hook … burning a turn each time"*).

That is the signal that a `deny` should have been an `instruct` (§2's mode table). A block
teaches nothing; an oversight message tells the agent what to do instead. Check for it:

```bash
agenteye --json query run --sql "
  SELECT JSONExtractString(payload,'hook_name') AS hook, count() AS c,
         uniq(session_id) AS sessions
  FROM events
  WHERE event_type = 'hook_completed'
    AND JSONExtractString(payload,'outcome') IN ('denied','blocked')
  GROUP BY hook ORDER BY c DESC LIMIT 10"
```

Many denials concentrated in few sessions = one agent stuck in a retry loop. Many denials
spread across many sessions = the rule is genuinely contested and probably mis-scoped.

## Getting the actual commands

A policy must match real input, and its tests need real payloads (§2.4). Two routes:

```bash
# a) the finding's own evidence query, bounded
agenteye --json query run --sql "<evidence.queries[0]> LIMIT 20"

# b) raw payloads for a cited session
agenteye --json events --full --session-id <SESSION_ID> --all --limit 1000 \
  | jq '.events[].payload'
```

**`--full` is the only way to get `payload`** and it hits a heavy endpoint — always bound it
to a session, never sweep unbounded.

**An evidence query returning zero rows does not mean the finding is wrong.** Verified live:
the credential finding cites 1424 matched events, yet its evidence query returns nothing,
because the demo's seeded findings and seeded events were generated separately. When that
happens, fall back to the patterns named in the finding text itself, and say in your report
that the policy was built from the finding's description rather than from observed payloads —
that is a real difference in confidence.

## Then: the normal authoring core

From here it is §2 unchanged — **check builtins and their params first**, pick a mode, name
the file `*policies.mjs`, test both directions with `scripts/test-policy.mjs`. AgentEye
changes where the work comes from, not how a policy gets written.

One extra step worth taking: AgentEye knows which tools actually exist in the fleet.

```bash
agenteye --json list tools      # also: agents, envs, event_types, hooks, error_types
```

A policy matching a tool name no tool ever emits is dead on arrival, and this is the cheapest
way to catch that before shipping it.

## Closing the loop

After a policy is installed and tested, the finding should not sit open forever. But:

**Do not run the triage commands yourself.** Two independent reasons:

1. `agenteye`'s confirm prompts **auto-skip on a non-TTY — which is exactly how you run it**.
   `audits resolve <id>` executes immediately, with no chance to catch a wrong id, on a board
   the user's whole team shares.
2. Triage needs `audits:write`, which a read-only account does not have (the live demo
   account has `audits:read` only — check `whoami` before assuming).

So **print the commands and let the user run them**:

```bash
agenteye issues comment-add <ISSUE_ID> --body "Enforced by failproofai policy \`<name>\` in .failproofai/policies/<file> — denies <what>, verified with N cases."
agenteye audits resolve <FULL-FINDING-UUID>
```

`resolve` leaves no suppression, so a genuine recurrence reopens as new — the right verb once
enforcement exists. `mute`/`dismiss` suppress the pattern permanently and are the wrong choice
here. Every finding carries an `issue_id` linking to its issue; triage on either surface
mirrors onto the other.

## What to report

Same honest split as everywhere else, plus one AgentEye-specific line:

- **enforced now** — new policies + builtins enabled, with the finding each came from
- **already covered** — findings a builtin already handles
- **broken enforcement** — hooks failing (source 2). Call these out first; they are live gaps
- **too strict** — deny-mode policies that should be oversight (source 3)
- **not policy work** — `kind: improvement` / `failure` findings, which need code, not policies
- **to close** — the exact `comment-add` / `resolve` commands, for the user to run
