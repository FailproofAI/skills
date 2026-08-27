---
name: failproofai-policy-deploy
description: |-
  The way to get a written policy off one machine and onto the machines that need it — publish a version, deploy it to the fleet, then prove it fired. Reach for it the moment a rule exists and the question turns into where it runs.

  Trigger when the user wants to:
  • deploy or roll out a policy — "put it on the fleet", "ship this to the machines";
  • publish a policy version, or draft one with `fp policies compose`;
  • know whether it actually fired — "did my policy do anything?", coverage, blocks;
  • roll it back, disable it, or promote observe → enforce;
  • install a policy on one machine — scopes, the filename convention, packs.

  Served by `fp` for the fleet and the local CLI for a single machine.

  NOT for deciding what the rule should be or writing its source (`failproofai-policy-author`); nor telemetry and org operations (`fp-cloud-cli`), evaluator scoring (`agenteye-evaluator`), or install and daemon setup (`failproofai`).
---

# failproofai Policy Rollout

A policy that decides correctly on your laptop enforces nothing anywhere else. This skill
carries one from a file to the machines that should run it, and then proves it bit.

    test  →  publish  →  fleet deploy  →  guardrails  →  promote, or roll back
    local     a new       which machines   what it        observe → enforce
    no auth   version     run it           actually did   or back out

Source pointers are grep anchors inside the installed `fp` CLI — the `fp_cli/` package in the
`fp-cloud-cli` site-packages tree. They survive refactors; line numbers do not.

## The boundary with `failproofai-policy-author`

| Half | The question it answers | Skill |
|---|---|---|
| author | **what is the rule**, and does it decide correctly? | `failproofai-policy-author` |
| deploy | **how does it reach machines**, and how do you prove it bit? | this one |

If the rule does not exist yet — the user is describing a behaviour, an audit finding, or a
line in a CLAUDE.md — that is authoring, and it happens first. Route there and come back with
a file. If a file exists and the question is *where it runs*, you are in the right place.

The two halves meet at exactly one command. `fp policies test` belongs to both: it is the
author's last check and this skill's first step, and it is the only piece of the cloud lane
that needs no server, no fleet and no account.

## Two lanes — infer which, do not ask

| Already in the conversation | Lane |
|---|---|
| "the fleet", "our machines", "everyone", a machine id, any `fp` output | Cloud |
| a policy id plus "roll it back", "did it fire", "who is running it" | Cloud |
| "this repo", "my machine", a path under `.failproofai/policies/` | Local |
| "enable block-sudo", "install the builtins", a pack | Local |

Both lanes can be live at once, and that is the normal case rather than an ambiguity: you
deploy from the cloud side, and the local lane is what the artifact becomes once it lands on
disk. Read *The local lane* whenever the question is what a machine ends up running.

Resolve the binary before anything else — **`fp` first**:

```bash
command -v fp agenteye
```

`agenteye` is the legacy cloud binary. It carries no `policies`, `fleet` or `guardrails`
command at all, so on a machine where only it answers, this whole lane is genuinely
unavailable. That is an upgrade — `uv tool install fp-cloud-cli` — not a missing flag. Never
write `uv tool install fp-cli`: `fp_cli` is the Python module, `fp-cloud-cli` is the
distribution, and the module name installs nothing.

## The cloud lane

Full surface — every flag, every JSON key, every exit code — in `references/cloud-lane.md`. What
follows is the path through it.

**What was and was not run.** `policies test`, `publish`, `show`, `disable`, `enable`,
`delete` and `compose` were executed end to end against a live org with `policies:write`, on a
throwaway policy that was archived afterwards; their output here is verbatim. Confirmed that
way: `publish` returns `carriers: {}` on a new policy, which is the proof that **publishing
deploys nothing**; `disable`/`enable`/`delete` return `machinesUpdated`; a policy's own
`description` in `customPolicies.add({...})` is **not** the published description — that comes
only from `--description`, and without it the dashboard row is blank.

`fleet deploy`, `fleet rollback` and reading `guardrails` after a real fire are still documented
from `fp <cmd> --help` and the installed `fp_cli` source, not from a run. They were deliberately
not executed: the org available carries live machines, `fleet` has no delete, and `rollback` is
append-only, so there is no way to deploy for a test and leave no trace.

### Preflight

```bash
fp --json whoami
```

**It exits 0 whether or not you are signed in.** Branch on the `.logged_in` field, never on
the exit code — signed out it prints `{"logged_in": false, "auth_mode": "none"}`. Any check of
the form "exit 4 means not signed in" reads every signed-out run as a success and then fails
two commands later on something unrelated.

```bash
fp --json whoami | jq -e '.logged_in' >/dev/null || echo "not signed in — stop here"
```

You cannot fix a signed-out session: `fp login --email you@example.com` needs a code emailed to
the user. Ask them and stop.

Then read the permissions `whoami` prints. They split this lane in half:

| Permission | Buys you |
|---|---|
| `policies:read` | `policies list/show`, `fleet list/show/diff/history`, `guardrails summary/timeline` |
| `policies:write` | `policies publish/enable/disable/delete/compose`, `fleet deploy/rollback/rename` |
| neither | `fp policies test`, and nothing else here |

Global options go **before** the command. `fp --json policies list` is correct;
`fp policies list --json` is a usage error, **exit 2**, with the hint printed. A command's own
options still come after it: `fp --json fleet deploy <machine-id> --add no-force-push`.

### CI cannot drive a deploy

**Every `policies`, `fleet` and `guardrails` subcommand except `policies test` exits 2 under
an API key.** Not a 403 from the server — the CLI refuses locally, before it opens a
connection (`_context.py`, grep `deny_in_key_mode`), which is why the message explains the
credential rather than the request.

The reason is structural and will not be flagged away. These commands address
`/api/enforcement/*`, and that family is deliberately absent from `/v1` — the versioned API an
API key authenticates against is internet-facing, and publish, deploy and rollback are
operator writes (`client.py`, grep `_V1_NO_EQUIVALENT`). The assistant family behind
`policies compose` is absent for the same reason.

So a rollout needs a signed-in human session. Design around that rather than discovering it in
a pipeline:

- A CI job **can** run `fp policies test` — it takes no credential at all.
- A CI job **cannot** publish, deploy, promote or roll back. Do not write a workflow that
  tries, and do not offer an API key as the fix.
- Where a pipeline must gate on policy, the gate is `fp policies test --expect deny` against
  the source, not a fleet call.

### 1. Prove it locally

The safe first step, and the only one that changes nothing anywhere.

```bash
fp --json policies test ./rule.mjs --command "git push --force origin main"
```

```json
{"ok": true, "decision": "deny",
 "policies": [{"name": "no-force-push", "decision": "deny", "reason": "Force-push rewrites shared history…"}],
 "syntax": {"ok": true, "checked": true, "message": ""}, "expected": null, "met": true}
```

No server, no fleet, **no auth** — it shells out to `node` and nothing else, which is why it is
the one subcommand an API key can drive. It resolves `import { deny } from "failproofai"` with
nothing installed in the working directory: the CLI writes a shim into
`node_modules/failproofai/` inside a temp directory, so the file under test is byte-identical
to the one you will publish (`policy_check.py`, grep `_SHIM`). Needs `node` on PATH; without it
the command says so rather than passing.

Source can be a path, `@path`, `-` for stdin, a pipe, or an interactive paste when you give
none. Its own options come after the subcommand: `--tool` (default `Bash`), `--command`,
`--file`, `--event` (default `PreToolUse`), `--expect`.

Three fields decide whether you have proven anything:

| Field | Read it as |
|---|---|
| `decision` | the **strictest** verdict any registered policy returned — deny beats instruct beats allow |
| `policies[].decision` | per policy. **`skipped` means it never ran** — see below |
| `met` | `--expect` was satisfied. Unmet also exits **1**, so it scripts |

**A `skipped` row is the failure this command exists to catch.** The runner applies the same
`match` filter the engine does, so a policy whose `match.events` or `match.toolNames` does not
cover the context you described is reported as skipped and contributes nothing to the overall
decision — which then reads `allow`. Verified live:

```bash
fp --json policies test ./rule.mjs --event Stop --command "git push --force origin main"
# → decision "allow", policies[0].decision "skipped",
#   reason "match.events does not include Stop"
```

Before that filter existed, a `PostToolUse`-scoped policy printed a red DENY under the default
`--event PreToolUse` and `--expect deny` passed in CI while the machine allowed the command.
Read the per-policy rows, not just `decision`.

State the limits rather than letting a green line stand in for enforcement. It proves the
policy parses, registers, and decides for the input you typed. It **cannot** prove the daemon
feeds it the same context; it has no `--cli` flag, so every run is one harness shape; and it
knows nothing about whether the target harness acts on the verdict. For the harness-aware
runner, that is `failproofai-policy-author`'s `scripts/test-policy.mjs`.

### 2. Publishing mints a version and deploys nothing

```bash
fp --json policies publish no-force-push ./rule.mjs --description "Deny git push --force"
```

**\*\*\* Publishing deploys nothing. \*\*\*** A new version sits unused until an
`fp fleet deploy` names it. This is the most common wrong mental model of this lane — "I
published it, so it is live" — and nothing in the success output contradicts it unless you read
`carriers`.

| Fact | Consequence |
|---|---|
| Every publish **mints a new version**; none edits one in place | versions are immutable and every one stays addressable, so `policies list` shows one row per version, not per policy |
| The source is parse-checked with `node --check` first | a file that is not parseable JavaScript is refused, exit 1, with node's own error |
| `--no-verify` skips the check | a host without `node` publishes with a warning rather than a block |
| Needs `policies:write` | a `policies:read` account gets exit 5 |
| `--json` returns the created version plus **`carriers`** | a map of machine id → the version of this policy that machine runs *right now* |

`carriers` is the field to read. It answers "what did this publish leave behind?" without a
second call — an empty map means nothing in the fleet runs this policy under any version, and a
map full of `1` while you just published `2` means every carrier is still on the old one until
you deploy.

Source forms are the same five as `test`: a path, `@path`, `-`, a pipe, or a paste.

**One trap, read from the source and not executed:** `syn` is assigned only inside the
`if not no_verify:` branch, and the `--json` writer emits `"syntax": syn.to_dict()`
unconditionally (`commands/policies_cmds.py`, grep `carriers = {`). So
`fp --json policies publish <id> <src> --no-verify` looks like it publishes and then fails while
rendering — with the version already created server-side. Prefer letting the check run; if a
host genuinely has no `node`, drop `--json` for that one call.

### 3. `fp fleet deploy` — a bare `--add` enforces

**\*\*\* `fp fleet deploy <machine-id> --add <policy>` on a policy the machine does not already
run puts it in `enforce` mode. \*\*\*** There is no observe-by-default anywhere in this system:
`resolve_ref` falls through explicit effect → the effect already deployed → `enforce`
(`enforcement.py`, grep `def resolve_ref`). Write the effect every time.

```bash
fp --json fleet deploy <machine-id> --add no-force-push:observe   # measure first
fp --json fleet deploy <machine-id> --add no-force-push:enforce   # then bite
```

Ref grammar, one ref per flag:

| Form | Means |
|---|---|
| `id` | newest published version, `enforce` — **unless the machine already runs it**, in which case its pinned version and effect are kept |
| `id@3` | version 3; effect as above |
| `id:observe` | version as above; run it for real, record what it would have decided, return allow |
| `id@3:observe` | both explicit |

Effects are exactly `enforce` and `observe`; anything else is a usage error, exit 2. **Refs are
not comma-split** — `--add a,b` fails to parse as one token, because the id charset is
`[A-Za-z0-9._-]` and a comma is not in it. Repeat the flag instead.

That "keeps its pinned version" rule is worth saying out loud: a bare `--add` on a policy the
machine already runs is a **no-op, not an upgrade**. To move a machine onto the version you just
published, name it — `--add no-force-push@4`.

Everything else that will surprise you:

| Behaviour | What actually happens |
|---|---|
| `--set` | replaces the **whole** set — the only way to drop what you do not name. Cannot be combined with `--add`/`--remove`; mixing them is exit 2 |
| A no-op | exits **0** with `"applied": false`. The exit code is 0 either way, on purpose — a retrying harness re-running the same deploy should succeed — so `applied` is the only signal that anything changed |
| A declined prompt | exits **0** with `"cancelled": true`. Also not distinguishable by exit code |
| **The prompt** | is skipped entirely under `--json`, under `--yes`, or when stdin is not a TTY (`commands/_write.py`, grep `def should_prompt`). **A harness never sees it.** The confirmation is not a safety net you have |
| Concurrency | the write is a full replace with no server lock, so the CLI records the generation it read and refuses if the result is not exactly `base + 1` — **exit 1**. Someone else deployed in between, and a replace does not merge |
| An unknown machine id | refused, exit 6 — *unless* you pass `--create` |
| `--create` | allows deploying to an id that has never checked in (pre-staging). **A typo with `--create` mints a machine nobody owns**, carrying policies nobody will collect, and the only sign is an extra row in `fleet list` |
| A disabled policy | refused before the plan is drawn, with `fp policies enable <id>` as the hint |

On a concurrency refusal, do not retry blind. Re-read, then redeploy:

```bash
fp --json fleet show <machine-id>          # the current set, and the generation
fp --json fleet deploy <machine-id> --add no-force-push:enforce
```

**Deployed is not enforcing.** `fleet deploy` moves *intent*; only the machine polling moves
*delivery*. `fp fleet diff` is the one surface that shows the gap, and it computes `drifted` for
you so a harness need not derive it:

```bash
fp --json fleet diff <machine-id>
# {"machines":[{"machineId":"<machine-id>","intended":7,"delivered":6,"drifted":true}]}
```

A drifted machine is still enforcing its previous set. Reporting a rollout as done while
`drifted` is true is the mistake this field exists to prevent.

### 4. Did it actually fire

```bash
fp --json guardrails summary --since 24h --machine <machine-id>
fp --json guardrails timeline --since 24h
```

**Write the subcommand.** A bare `fp guardrails` prints the group's help and exits **0** —
verified live — so a harness checking only the exit code believes it got a report and then
parses an empty result.

`summary` gives evaluated and blocked totals, how many machines are enforcing versus merely
reporting, a sparkline of denies, and the per-policy table: **`fired`, `blocked`, `instructed`,
`p95`** (JSON field `p95Ms`). `timeline` gives one row per bucket — time, activity, total,
denied, instructed — with times in UTC.

Four things about those numbers:

- **The two halves come from different stores.** Coverage is Postgres, the deployment records;
  decision counts are ClickHouse, the hook telemetry machines reported. A machine can be
  deployed-to and silent, or reporting and undeployed, and only the first half moves when you
  run `fp fleet deploy`.
- **The `(no policy)` row is the denominator, not a gap.** Most evaluations are allows nothing
  objected to. "14 blocked" means little without the 933 it came from.
- **`--since` takes exactly `1h`, `6h`, `24h`, `7d`.** `15m` is refused with exit 2 on purpose:
  both endpoints take whole-hour windows, so accepting it silently widened the window 4x with
  nothing on screen to say so.
- **An unknown `--machine` is refused**, exit 6, rather than answered with an empty window —
  because "this machine was quiet" and "you typed the id wrong" must not look alike.

`fired` counts evaluations the policy matched; `blocked` counts the subset it denied. A policy
deployed in `observe` shows `fired` with `blocked` at 0 — that is the measurement working, not a
broken rule. A policy with `fired: 0` after a real window either matches nothing anyone does, or
is not delivered: check `fleet diff` before rewriting the rule.

### Promote, and back out

The safe rollout is two deploys, not one.

1. `--add <policy>:observe` on one machine. The policy runs for real, records what it *would*
   have decided, and returns allow.
2. Read `guardrails summary` over a window that contains real traffic. `fired` high with
   `blocked` plausible means the rule matches what you meant. `fired` high and indiscriminate
   means it is mis-scoped, and enforcing it will get it switched off by a human.
3. `--add <policy>:enforce` on that machine, then widen.

Backing out has three verbs and they are not interchangeable:

| Verb | What it does | Use when |
|---|---|---|
| `fp fleet rollback <machine-id> <generation>` | mints a **new** generation carrying the old set — history stays append-only, the counter never rewinds | one machine's last deploy was wrong |
| `fp policies disable <policy-id>` | the server reissues **every** deployment carrying it, without it, advancing each machine's generation | the rule itself is wrong, everywhere |
| `fp policies delete <policy-id>` | archives it: hidden from `policies list` and from future deployments | it is dead and you want it out of the library |

**\*\*\* `disable` stops enforcement. `delete` does not. \*\*\*** A machine already carrying an
archived policy keeps enforcing it until something redeploys. Deleting is not a way to stop
enforcement, and reaching for it during an incident leaves the rule running on exactly the
machines you were trying to protect. `disable` first; `delete` later, if at all.

Two more constraints, worth knowing before you need them. `policies enable` is the exact inverse
of `disable` — it puts the policy back into every deployment it was removed from, so nothing
needs redeploying by hand. And a generation naming a policy since disabled or deleted **cannot
be reinstated at all**, so `fleet rollback` will refuse it.

### Drafting with `fp policies compose`

```bash
fp policies compose "deny git push --force on any branch" --out no-force-push-policies.mjs
```

**\*\*\* It needs `policies:write`, not `agent:use`. \*\*\*** This is backwards from what the
name implies, and it is the permission question people get wrong. The route is
`POST /api/agent/compose-policy`, which the dashboard exports wrapped in
`withAuth("policies:write", …)`; `agent:use` gates the assistant's *other* routes — chat,
answer, conversations — and is not checked on this one. So a role holding only `agent:use` is
**refused here**, and a role holding `policies:write` without it **works**. Session-only, like
everything else in the family.

- By default the draft is printed and nothing else happens. A generated policy that deploys
  itself is a generated policy nobody read.
- `--out <file>` saves it, and saves **before** anything that can fail — a refused publish no
  longer throws away the draft you just paid an assistant to write.
- `--publish <id>` takes a **policy id, not a boolean**. `--publish true` publishes a policy
  called `true`.
- `--json` returns `{prompt, source, syntax, published, savedTo}`.

A composed draft is an unproven policy. Put it through step 1 before step 2 — the assistant
writes source, it does not verify behaviour.

## The local lane

What lands on one machine, and what stops a policy running once it is there. Full detail in
`references/local-lane.md`; packs in `references/packs.md`. Four things belong here in the
SKILL, because each of them silently produces a machine that looks protected and is not.

**The filename convention.** Any file matching `/policies\.(js|mjs|ts)$/` in
`.failproofai/policies/` (project) or `~/.failproofai/policies/` (user) auto-loads with no
config and no flag. Anything else is **silently skipped** — it never ran, and nothing said so.

| Name | Loads? |
|---|---|
| `no-force-push-policies.mjs` | yes |
| `security-policies.ts` | yes |
| `no-force-push.mjs` | **no** |
| `no-force-push-policy.mjs` | **no** — singular |

The warning for a skipped file goes to the hook log, which nobody reads, and the local
`policies` listing does not check at all. Check the filename before believing any other
diagnosis.

**Three scopes, and their merge rules are opposites.** Read in order project → local → user
(`hooks-config.ts`, grep `readMergedHooksConfig`):

| Field | Merge rule |
|---|---|
| `enabledPolicies` | **union across all three**, no subtraction anywhere |
| `disabledCustomPolicies` | union |
| `customPoliciesEnabled` | **first scope that defines it wins** |
| `customPoliciesPaths` | first scope defining it wins |
| `policyParams` | first scope naming a policy wins that policy's **whole object** |

Two consequences. You **cannot disable a user-scope policy from project scope** — the write
succeeds, prints `Disabled 1 policy(ies)`, and changes nothing observable while the user scope
still enables it. And a `customPoliciesEnabled: false` in the first scope that sets it disables
convention policies for everything below, whatever the other two say.

**Installing a custom policy:**

```bash
failproofai policies --install --custom ./no-force-push-policies.mjs --cli claude --scope project
failproofai policies --install block-sudo --cli claude codex --scope project
```

Both forms are **additive** — `--install a b` produces a superset of what was there, never
exactly `{a, b}` — and `--custom` is repeatable. A carried path whose file has vanished is
dropped with a printed line rather than an error. Off a TTY with no names, the picker returns
whatever that scope already had, unchanged; that is the path a harness takes.
`references/local-lane.md` has the scope restrictions per CLI and the `--uninstall` trap.

**Consent: their repo yes, their machine ask.** Project-scope edits inside the repo the user is
working in are fine when they asked for a fix. These three are off-limits without them asking in
the current request:

| Action | Why |
|---|---|
| `policies --install` at **user scope** | wires hooks into every project on the machine |
| Editing `~/.failproofai/policies-config.json` | a deny there fires everywhere |
| Setting `customPoliciesPath` globally | silently activates policy files across all projects |

The same line holds on the cloud side, one size up: deploying to **one** machine the user named
is the fix they asked for; a sweep across `fleet list` is a decision they make. A question —
"should this be everywhere?" — asks for an answer, not a deploy.

## Worked example: `no-force-push` to one machine

The whole lane, end to end. `<machine-id>` is an id from `fp fleet list`; `<org>` is the tenant
slug if the account has more than one.

```bash
# 0. preflight — branch on the field, not the exit code
fp --json whoami | jq '{logged_in, auth_mode, permissions}'

# 1. prove it decides correctly, locally. Nothing published, nothing installed.
fp --json policies test ./no-force-push-policies.mjs \
  --command "git push --force origin main" --expect deny
fp --json policies test ./no-force-push-policies.mjs \
  --command "git push origin main" --expect allow

# 2. mint a version. THIS DEPLOYS NOTHING.
fp --json policies publish no-force-push ./no-force-push-policies.mjs \
  --description "Deny git push --force" | jq '{id, version, carriers}'

# 3. put it on one machine in OBSERVE. A bare --add here would ENFORCE.
fp --json --org <org> fleet deploy <machine-id> --add no-force-push:observe \
  | jq '{applied, cancelled, deployment: .deployment.deployment}'

# 4. confirm the machine actually collected it — intent is not delivery
fp --json fleet diff <machine-id> | jq '.machines[] | {intended, delivered, drifted}'

# 5. let real traffic run, then read what it would have done
fp --json guardrails summary --since 24h --machine <machine-id> \
  | jq '.summary.policies[] | select(.policy == "no-force-push")'
# → {"policy":"no-force-push","fired":37,"blocked":0,"instructed":0,"p95Ms":4}
#   fired > 0, blocked 0 — observe mode is measuring, not blocking

# 6. promote the same policy to enforce on that machine
fp --json fleet deploy <machine-id> --add no-force-push:enforce | jq '.applied'

# 7. from here, blocked climbs. That is the proof it bit.
fp --json guardrails timeline --since 24h --machine <machine-id>

# back out, if it over-denies:
fp --json fleet deploy <machine-id> --add no-force-push:observe   # demote, keep measuring
fp --json fleet rollback <machine-id> <generation>                # this machine only
fp --json policies disable no-force-push                          # everywhere. NOT delete.
```

Step 4 is the one people skip and the one that makes the report wrong. Steps 3 and 6 are the
only two that change what an agent is allowed to do — confirm those with the user before running
them if they asked a question rather than for a rollout.

## What to report

Five lines, and none of them is bare "deployed".

- **Published** — policy id and version number, plus what `carriers` said was running before it.
- **Deployed** — which machines, at which **effect**, and the resulting generation. Name the
  effect explicitly; "deployed" without it hides the difference between measuring and blocking.
- **Delivered** — `fleet diff`'s `drifted` for each machine you touched. A drifted machine is not
  enforcing what you just deployed, and saying so is the honest version of "done".
- **Fired** — the per-policy `fired` / `blocked` numbers over a named window, or a plain
  statement that no window has passed yet. Never present a rollout as proven on a window with no
  traffic in it.
- **How to back it out** — the exact `fleet rollback` or `policies disable` line, and the
  reminder that `delete` does not stop enforcement.

If the account could not run the write half, say which commands you would have run rather than
reporting them as blocked by an unnamed error — and do not offer an API key as the workaround.
