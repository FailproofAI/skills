# Sourcing policy work from FailproofAI Cloud

[FailproofAI Cloud](https://app.befailproof.ai) is the observability side of the same story: failproofai
enforces inside the agent loop, FailproofAI Cloud records what happened across the fleet. Where the
local `failproofai audit` reads one machine's transcripts, FailproofAI Cloud holds every session from
every agent in an org — so it sees things a local audit structurally cannot.

The commands here were verified against a live FailproofAI Cloud deployment. Figures quoted below are
illustrative of the shapes you will see, not from any particular org.

## Preflight

```bash
fp --json whoami
```

**`whoami` does not error when you are signed out — it exits 0 either way.** Branch on the
`.logged_in` field, never on the exit code; signed out it prints
`{"logged_in": false, "auth_mode": "none"}`. Any check of the form "exit 4 means not logged
in" silently treats every signed-out run as a success and then fails on the next command
with something unrelated.

```bash
fp --json whoami | jq -e '.logged_in' >/dev/null || echo "not signed in — stop here"
```

If not logged in, **stop and ask the user to run `fp login --email you@example.com`** — it
needs a one-time code emailed to them, so you cannot complete it. Note the permissions
`whoami` prints; they decide what you may do at the end (see "Closing the loop").

Add `--json` to **every** command — it prints machine-readable output and nothing else. It is
a **global** option, so it goes **before** the command, not after it:

| Form | Result |
|---|---|
| `fp --json audits findings` | correct |
| `fp audits findings --json` | usage error, **exit 2** |

The same rule holds for `--base-url`, `--org`, `--token`, `--api-key`, `--insecure`/`--secure`,
`--timeout`, `--quiet` and `--no-color`. A command's own options still come after it —
`fp --json audits findings --limit 100 --show-id`.

## Four sources of policy work

FailproofAI Cloud answers four different questions. Check all four; they produce different work — and
two of them produce no policy at all, which is a result worth reporting rather than a dead end.

### 1. Findings already classified as policy-shaped

FailproofAI Cloud tags each finding with a `kind`. **`kind: policy` means it is enforceable** —
`improvement` and `failure` are code or instrumentation work and are not yours.

```bash
fp --json audits findings --limit 100 --show-id \
  | jq '.findings[] | select(.kind == "policy") | {id, title, severity, status}'
```

`--show-id` is not optional: `audits finding <id>` **requires the full UUID**. The short id
in the table looks usable and is rejected with `no finding <id>`, exit 6 — the CLI reference
says short ids are accepted, and for this subcommand they are not.

Then read one in full:

```bash
fp --json audits finding <FULL-UUID>
```

The fields that matter:

| Field | Use |
|---|---|
| `description` / `root_cause_hypothesis` | what happened and why — the policy's rationale |
| `recommendation` | FailproofAI Cloud's own fix. Often names the mechanism ("add a pre-tool-use hook that rejects…") |
| `evidence.queries` | **runnable SQL, often containing the exact regex** |
| `evidence.policy_id` | FailproofAI Cloud's internal rule id, e.g. `secret.credential_in_tool_args` |
| `scope` | narrows it — e.g. `{"tool": "db.query"}` |
| `occurrences`, `evidence.matched_sessions` | how much this actually happens |

A real one, verbatim: *"Credential-shaped strings passed to db.query in production"*, whose
evidence query carries `match(payload, '(AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,})')`.
That regex is the pattern to enforce — but **run it through the builtin-first check anyway**:
`sanitize-api-keys` and `sanitize-bearer-tokens` already cover those two shapes, so the
answer is mostly config, and a custom policy only covers what the builtins miss.

### 2. Hook failures — policies that are silently enforcing nothing

**The one thing a local audit can never tell you.** failproofai fails open (`traps.md` §3):
a policy that throws or times out returns allow, and nothing surfaces. Locally that is
invisible. FailproofAI Cloud records every hook outcome, so the gap is a query:

```bash
fp --json query run --sql "
  SELECT JSONExtractString(payload,'hook_name') AS hook,
         JSONExtractString(payload,'outcome')   AS outcome,
         count() AS c
  FROM events
  WHERE event_type = 'hook_completed'
    AND JSONExtractString(payload,'outcome') NOT IN ('ok','approved')
  GROUP BY hook, outcome ORDER BY c DESC LIMIT 20"
```

A real deployment showed a pre-tool-use guard failing several hundred times over a week, and a
PII redaction hook failing on a similar order. Every one of those is an action that ran
**unguarded** while the dashboard showed a hook installed.

This is not a policy to author — it is a **broken policy to report**. Tell the user which
hook is failing and how often, and treat fixing it as higher priority than any new policy:
a guard failing a few percent of the time is worth less than nothing, because it looks like
protection while quietly letting actions through.

### 3. Denial patterns — policies that are too strict

A high denial count means one of two very different things, and **the raw count cannot tell
you which** — you must measure the *distribution across sessions* before drawing any
conclusion. FailproofAI Cloud's own finding text says denials mean an agent is "burning a turn each
time", which presumes a retry loop; that is one of the two cases, not the default.

| Shape | Meaning | Fix |
|---|---|---|
| Denials **concentrated** — few sessions, many denials each | an agent stuck retrying something it will never be allowed | the rule is right; the agent needs to be *told* what to do instead → `instruct` |
| Denials **spread** — many sessions, ~1 denial each | the rule is contested broadly, i.e. **mis-scoped** | narrow the rule, or downgrade to oversight |

Measure it rather than assuming — this query gives the distribution, not just the total:

```bash
fp --json query run --sql "
  SELECT denials_per_session, count() AS sessions FROM (
    SELECT session_id, count() AS denials_per_session
    FROM events
    WHERE event_type = 'hook_completed'
      AND JSONExtractString(payload,'outcome') IN ('denied','blocked')
    GROUP BY session_id)
  GROUP BY denials_per_session ORDER BY denials_per_session"
```

A real deployment showed roughly **three quarters of affected sessions with exactly one
denial** and a maximum of four — the *spread* shape, i.e. a mis-scoped rule. A report calling
that a retry loop would be wrong on the mechanism even while landing on the right fix, and an
agent did make exactly that error. State the distribution, not just the total.

One caveat before recommending any change: a human-approval gate (`approval.tool_use`) is
*supposed* to deny sometimes. A non-zero denial rate there is the control working, not a
defect. Ask whether the denials cluster on a handful of tool/argument shapes before
proposing anything.

### 4. The issues board — read it, but classify before believing it

Issues are FailproofAI Cloud's **human attention queue**, not a behaviour log. Three sources feed it,
and only one reliably contains policy work:

```bash
fp --json issues list --limit 100 --show-id
```

| `source` | What it is | Policy material? |
|---|---|---|
| `audit` | a finding that graduated — same content, back-linked | **Yes** — follow `source_finding_id` and treat it as §1 |
| `alert` | a configured metric crossed a threshold | **Almost never** — see below |
| `manual` | a person opened it, free text | **Sometimes** — depends entirely on what they wrote |

**Why alert-born issues are usually not yours.** An alert fires on a *number*: p95 latency,
error rate, eval score, token burn. A policy gates a *tool call before it runs*. Those are
different axes, and no policy can move a latency percentile. Measured on a live deployment:
**0 of 11 issues were policy-actionable** — every one was a metric breach whose resolution
comments read "revert the prompt", "tune down retries", "fix the downstream service".

Check `trigger_kind` and `breach_summary` before spending any effort: `eval_compound`,
`error_rate`, `latency_p95`, `token_burn` are all metric triggers and none of them describes
an action a hook could have stopped.

**Manual issues are free text**, so treat them exactly like the complaint path — does the
text describe a *behaviour* ("the agent keeps writing to prod config") or a *measurement*
("checkout latency is up")? Behaviour goes through the *Enforcing a rules file* classification in SKILL.md; a
measurement does not become a policy no matter how it is phrased.

**Audit-born issues are the ones worth chasing**, because they are findings in a different
wrapper:

```bash
fp --json issues list --limit 100 --show-id \
  | jq '.issues[] | select(.source == "audit") | {id, title, source_finding_id}'
```

Then `fp --json audits finding <source_finding_id>` and you are back in §1.

**A caveat worth checking in the target org.** The CLI reference states every finding
graduates to an issue, but on the live deployment tested here **no issue carried a
`source_finding_id` and no `kind: policy` finding carried an `issue_id`** — the two surfaces
were entirely disconnected. If the same is true wherever you are running, do not conclude
there is no policy work because the issues board looks operational; go to `audits findings`
directly. Say so in the report, because a disconnect there means audit findings are never
reaching the board the team actually watches.

## Getting the actual commands

A policy must match real input, and its tests need real payloads (see *Verify it fires* in SKILL.md). Two routes:

```bash
# a) the finding's own evidence query, bounded
fp --json query run --sql "<evidence.queries[0]> LIMIT 20"

# b) raw payloads for a cited session
fp --json events --full --session-id <SESSION_ID> --all --limit 1000 \
  | jq '.events[].payload'
```

**`--full` is the only way to get `payload`** and it hits a heavy endpoint — always bound it
to a session, never sweep unbounded.

**An evidence query returning zero rows does not mean the finding is wrong.** Verified live:
the credential finding cites 1424 matched events, yet its evidence query returns nothing,
because a finding's evidence and the event table can be generated or retained separately. When that
happens, fall back to the patterns named in the finding text itself, and say in your report
that the policy was built from the finding's description rather than from observed payloads —
that is a real difference in confidence.

## Then: author it and plug it in

From here it is *The authoring core* in SKILL.md, unchanged — **check builtins and their params first**, pick a mode, name
the file `*policies.mjs`, test both directions with `scripts/test-policy.mjs`. FailproofAI Cloud
changes where the work comes from, not how a policy gets written.

"Plugging it in" is two concrete edits in the target project, and neither touches FailproofAI Cloud:

```
.failproofai/policies/<name>-policies.mjs     the custom policy (filename convention — traps.md §1)
.failproofai/policies-config.json             `enabledPolicies` for any builtin that covers a finding
```

Nothing about *this* needs a FailproofAI Cloud permission — a failproofai policy is a local file
plus a config entry, and that is the whole story for one machine. It is **not** the whole story
for a fleet: `fp policies publish`, `fp fleet deploy` and `fp guardrails` are shipped commands
that carry the same rule to every machine and show it firing, and they need `policies:write`.
That Cloud rollout path belongs to `fp-cloud-cli` — hand off rather than assuming the local
edit is all there is. Then prove both local edits took effect, because neither is self-evident:

```bash
export SKILL_DIR=/path/to/skills/failproofai-policy-author   # this skill's own folder

# the custom file actually loads (fail-open hides a file that never loaded — traps.md §3)
node "$SKILL_DIR/scripts/test-policy.mjs" --policy .failproofai/policies/<name>-policies.mjs \
  --cwd . --event PreToolUse --tool Bash --input '{"command":"<should-deny case>"}' --expect deny

# an enabled builtin fires against the REAL project config (omit --policy)
node "$SKILL_DIR/scripts/test-policy.mjs" --cwd . \
  --event PreToolUse --tool Bash --input '{"command":"sudo ls"}' --expect deny
```

Record which FailproofAI Cloud finding each policy came from, in the file itself, so the two systems
stay traceable to each other:

```js
// derived-from: FailproofAI Cloud finding <full-finding-uuid>
// "<the finding's title>" (org <slug>, <date extracted>)
```

One extra step worth taking: FailproofAI Cloud knows which tools actually exist in the fleet.

```bash
fp --json list tools      # also: agents, envs, event_types, hooks, error_types
```

A policy matching a tool name no tool ever emits is dead on arrival, and this is the cheapest
way to catch that before shipping it. The next-cheapest is to replay the finished draft against
the same fleet's traffic before anyone deploys it — *Backtest the draft before it ships*.

## Backtest the draft before it ships

A local test proves the policy decides correctly for the input you typed. The **backtest**
replays it against the org's stored fleet traffic and reports how often it fires and how much
of that lands on calls that actually failed. SKILL.md's *Backtest it against real fleet
traffic* carries the decision rule — enforceability is judged before precision, and the verdict
vocabulary. This is the operating procedure.

**There is no CLI surface for it.** `fp policies` is `list show publish enable disable delete
test compose` and nothing else; there is no `fp policies backtest` and no `fp policies author`.
Say that plainly rather than implying a flag exists. Both live in the dashboard:

| Route | What it is |
|---|---|
| `https://app.befailproof.ai/<org>/policy-editor` | where both backtests run. `/<org>/policies` redirects here, query preserved |
| `https://app.befailproof.ai/<org>/policy-editor?from_issue=<issue-id>` | the hand-off link: drafts, replays and redrafts a policy for that issue |
| `https://app.befailproof.ai/<org>/policy` | what *deployed* policies did — block rate, per-policy table. `/<org>/guardrails` redirects here |

Keep the `<org>` segment on every link you print. An org-less `/policy` falls through the
legacy resolver and can land a multi-org user in the wrong tenant.

**Permissions: `policies:write` AND `events:read`, both.** `policies:write` alone gets 403 —
the route checks the pair explicitly. The reason is worth understanding before you ask an admin
to widen someone's role: a replay runs caller-supplied code over stored event payloads and
returns whatever the policy gave as its reason, so `instruct(JSON.stringify(ctx.toolInput))`
reads event payloads back out. It is an events read, whatever it looks like. Eligibility alone
(*can a policy address this at all*) needs only `policies:write`. Check `whoami` first —
a read-only account has neither.

`fp policies compose "<description>"` is the **un-backtested** path: one model call, never
replayed, no fired/precision/enforceable numbers behind what it prints. Useful as a starting
draft, worthless as evidence. It is session-only and exits 2 under an API key.

### Read the coverage line before the fire count

Zero fires has four causes and only one of them is good news: the policy allowed everything
correctly; it matched nothing; **it never loaded** (`registered: []`, failure kind
`not_loaded` — "the source registered no policies, check it calls `customPolicies.add(...)`");
or the window held no replayable traffic (`empty_corpus`). A failure is never reported as a
clean run that produced no fires — the failure kinds are `not_loaded`, `threw`, `timed_out`,
`sandbox_unavailable`, `empty_corpus`. Read that field first.

Then check what the run actually measured, because several fields quietly shrink it:

| Field | What it means for the numbers |
|---|---|
| `truncated` | the window held more than the read cap — you got a recent slice, not the window you asked for |
| `available` > `reconstructed` | same thing, stated as two numbers; every outcome figure is over `reconstructed` |
| `payloadCapped` | paging stopped on the retained-payload budget, not the row cap. The events were **large**, so widening the window makes this worse, not better |
| `omittedForSize` / `dropped` | individual cases dropped on a size bound; `droppedReasons` says which |
| `evalErrors > 0` | the policy threw on that many calls. A throw fails open (`references/traps.md` §3), so it enforced nothing on those — and the fire count cannot show you which |

**Scope to one agent or the numbers are blended.** The stored events do not record which
integration produced them, so the replay resolves it from the agent id prefix
(`<integration>-<purpose>`) and reports `cliResolvedFrom`: `request` (you named it),
`agent-prefix` (inferred), or `default` — and `default` means nothing was identifiable and the
Claude tool map was assumed. Treat a `default` result as unscoped. `cliHasToolMap: false` means
tool names pass through uncanonicalized, so only a policy matching raw names can fire there.

**429 means wait, not broken.** Replay slots are capped instance-wide and shared with the
authoring loop; a saturated pod answers 429 with a `Retry-After` and the UI says "waiting for a
slot…". Two people backtesting at once is enough to hit it. Do not report it as a failure.

### The issue → policy loop, and where it stops

`?from_issue=<id>` runs the whole thing: eligibility check, a tool-vocabulary probe, then up to
three compose→backtest rounds, streamed phase by phase (~20–30s end to end). Two limits decide
how much of the output to trust:

- **The eligibility check rejects on framing.** When a finding's headline describes a
  cross-call effect — "retried 14 times", "burned the run budget" — it refuses a policy-shaped
  finding roughly half the time, in one measured case even after the finding named the
  enforceable `PreToolUse` remedy itself. If you believe a policy applies, restate the finding
  with the enforceable action in the **title** and re-run; that alone flips it. An ineligible
  verdict on a badly-framed issue is not a finding about the issue.
- **The redraft rounds do not widen coverage.** Given a precise-but-narrow draft and the calls
  it missed, the next round comes back *less* precise, not more — it rewrites the matcher
  wholesale instead of extending it. The loop keeps the best round, so it is not harmful; it is
  just not progress. Take the best draft and finish the coverage by hand.

### What the verdict cannot tell you

Three gaps, all declared, all of which change what you write in the report:

- **Builtins are invisible to it.** The composer never considers them and the replay loads none,
  so a draft duplicating an existing builtin scores exactly like an original and then never
  fires, because the builtin already decided. The builtin check in SKILL.md's *Check the
  builtins first* runs **before** any backtest — a green verdict is not evidence the policy is
  needed, only that it aims correctly.
- **It measures aim, not outcome.** The recorded agent cannot react: a deny in the replay
  stopped nothing, and everything after it in that session still happened. Write "would have
  fired on 50 real failures", never "would have prevented 50 failures".
- **It is not a substitute for observing in production.** Deploying with `effect: observe`
  answers what the rule does to calls being made *now*. Use both: replay first because it is
  free, observe second because it is true. The Cloud deploy half is `fp-cloud-cli`.

## Closing the loop

After a policy is installed and tested, the finding should not sit open forever. But:

**Do not run the triage commands yourself.** Two independent reasons:

1. `fp`'s confirm prompts **auto-skip on a non-TTY — which is exactly how you run it**.
   `audits resolve <id>` executes immediately, with no chance to catch a wrong id, on a board
   the user's whole team shares.
2. Triage needs `audits:write`, which a read-only account does not have — a standard-role
   account may hold `audits:read` only. Check `whoami` before assuming.

So **print the commands and let the user run them**:

```bash
fp issues comment-add <ISSUE_ID> --body "Enforced by failproofai policy \`<name>\` in .failproofai/policies/<file> — denies <what>, verified with N cases."
fp audits resolve <FULL-FINDING-UUID>
```

`resolve` leaves no suppression, so a genuine recurrence reopens as new — the right verb once
enforcement exists. `mute`/`dismiss` suppress the pattern permanently and are the wrong choice
here. Every finding carries an `issue_id` linking to its issue; triage on either surface
mirrors onto the other.

## What to report

Same honest split as everywhere else, plus one FailproofAI Cloud-specific line:

- **enforced now** — new policies + builtins enabled, with the finding each came from
- **backtested** — for anything replayed: the verdict, `fired` / on real failures /
  fires-that-can-block, and the window it ran over. A draft that came back `observe-only` is
  reported as detection, not enforcement, whatever its precision said. Say "would have fired
  on", never "would have prevented"
- **already covered** — findings a builtin already handles
- **broken enforcement** — hooks failing (source 2). Call these out first; they are live gaps.
  Give the **fleet-wide aggregate** (`failed / total = N%`) alongside per-hook counts — raw
  counts alone undersell the systemic scale (a real fleet showed ~5% of all hook runs failing)
- **too strict** — deny-mode policies that should be oversight (source 3)
- **not policy work** — `kind: improvement` / `failure` findings, and alert/metric issues.
  Name them and say why, so the user can see they were read rather than skipped
- **to close** — the exact `comment-add` / `resolve` commands, for the user to run
