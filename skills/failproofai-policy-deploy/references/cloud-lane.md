# The cloud lane in full

Every surface `fp` exposes for getting a policy onto machines and reading what it did.
Grep anchors are inside the installed `fp_cli` package (the `fp-cloud-cli` distribution).

**What was executed.** `fp policies test` was run and its output here is verbatim. Every write
command — `publish`, `compose`, `enable`, `disable`, `delete`, `fleet deploy`, `fleet rollback`,
`fleet rename` — is documented from `--help` and the installed source, on an account holding
`policies:read` only. Nothing in the write half was executed. Where a claim comes from reading
code rather than running it, it says so.

## The 23-command surface, and the three that matter here

`fp help` groups them. ENFORCE is this lane:

| Command | Subcommands |
|---|---|
| `policies` | `list show publish enable disable delete test compose` |
| `fleet` | `list show deploy diff history rollback rename` |
| `guardrails` | `summary timeline` |

`fp help`'s own CI line states the constraint: *"in CI: authenticate with `--api-key` /
`FP_API_KEY` instead of a session (login, orgs, agent, policies, fleet and guardrails then exit
2)."*

## Argument order

Globals come **before** the command; a command's own options after it.

| Form | Result |
|---|---|
| `fp --json policies list` | correct |
| `fp policies list --json` | usage error, **exit 2**, hint: *global options go before the command* |
| `fp --json fleet deploy <machine-id> --add x:observe` | correct — `--add` belongs to `deploy` |

Globals: `--json --base-url --org --token --api-key --insecure/--secure --timeout --quiet
--no-color`.

## Exit codes

One table, and it is a scripted contract (`errors.py`):

| Code | Meaning |
|---|---|
| 0 | success — **including a deploy no-op and a declined prompt** |
| 1 | API error, and the concurrency refusal |
| 2 | usage error — bad flag, bad ref, globals after the command, **and every API-key refusal** |
| 3 | the dashboard could not be reached |
| 4 | not signed in, or the stored session expired |
| 5 | authenticated but missing the required permission |
| 6 | the resource does not exist — unknown machine id, unknown policy |

Exit 2 for an API-key refusal is deliberate rather than an oversight: the raise happens before
any HTTP call, and "this credential can never do that" is a usage error
(`errors.py`, grep `class KeyModeUnsupportedError`).

## Why an API key cannot deploy

`deny_in_key_mode` is the **first statement** of every command in this family
(`_context.py`), so an unsupported command never half-runs and never produces a 401 the caller
has to interpret.

Underneath it is a routing fact. Under an API key the CLI translates `/api/...` to `/v1/...`,
and three families have no `/v1` equivalent at all (`client.py`, grep `_V1_NO_EQUIVALENT`):

| Family | Why it is absent from `/v1` |
|---|---|
| `auth` | the sign-in endpoints take a browser session, not a key |
| `agent` | the assistant is implemented by the dashboard; there is no API route behind it |
| `enforcement` | cloud-managed policies are an operator surface, and `/v1` is internet-facing |

`policies`, `fleet` and `guardrails` all address `/api/enforcement/*`. `policies compose`
addresses `/api/agent/compose-policy`. That is the whole explanation, and it will not change
with a flag.

`fp policies test` sits outside all of it: no `require_auth`, no key check, no HTTP
(`commands/policies_cmds.py`, grep `No \`require_auth\``).

## `policies test`

```bash
fp --json policies test ./rule.mjs --command "git push --force origin main"
```

Verified output shape:

```json
{
  "ok": true,
  "decision": "deny",
  "policies": [
    {"name": "no-force-push",
     "description": "Force-push rewrites shared history.",
     "decision": "deny",
     "reason": "Force-push rewrites shared history. Use --force-with-lease, or push a branch."}
  ],
  "error": "",
  "syntax": {"ok": true, "checked": true, "message": ""},
  "expected": null,
  "met": true
}
```

| Option | Default | Note |
|---|---|---|
| `--tool` | `Bash` | the tool name the hook fired for |
| `--command` | — | becomes `toolInput.command` |
| `--file` | — | becomes `toolInput.file_path` |
| `--event` | `PreToolUse` | the hook event |
| `--expect` | — | `allow`/`deny`/`instruct`; **exit 1** when unmet, JSON still prints with `met: false` |

How it runs (`policy_check.py`, grep `def run_policy`): a temp directory containing
`node_modules/failproofai/` (a shim exporting `allow`, `deny`, `instruct` and a
`customPolicies.add` that collects registrations), `policy.mjs` — your source byte for byte —
and a runner. The shim lives in `node_modules` rather than beside the policy so a bare
`import { deny } from "failproofai"` resolves by node's ordinary lookup; an import map would
have meant testing a rewritten file.

The synthetic context is exactly:

```js
{ eventType, toolName, toolInput: payload, payload }
```

Four failure shapes worth recognising:

| Symptom | Meaning |
|---|---|
| `decision: "skipped"` on a row | `match.events` or `match.toolNames` excluded this context. **The policy did not run.** Verified live for both axes |
| `ok: false`, `policies: []`, error about registering | the file never called `customPolicies.add({...})`, or the call does not run at import time |
| `ok: false` with a 5s message | the policy did not finish in the execution budget — the same budget a hook has |
| `syntax.checked: false` | node was absent or the parse check timed out (30s). **Not the same as passing** — the shape exists so "we did not look" can never render as "we looked and it passed" |

Budgets are split on purpose (`policy_check.py`, grep `_SYNTAX_TIMEOUT_SECS`): execution is 5s
because a policy that cannot decide in five seconds cannot sit on a hook, parsing is 30s because
`node --check` runs no user code and the only variable is how loaded the box is.

Limits to state in any report: no `--cli` flag, so one harness shape per run; no capability
check, so it will report `deny` just as happily for an event the target harness discards; and it
cannot prove the daemon feeds the policy the same context.

## `policies publish`

```bash
fp --json policies publish <policy-id> ./rule.mjs --description "one line"
cat rule.mjs | fp --json policies publish <policy-id>
fp --json policies publish <policy-id> -          # read stdin explicitly
```

`POST /api/enforcement/policies` — mints a new version, never edits one in place. Needs
`policies:write`.

**Publishing deploys nothing.** The `--json` body is the created version plus:

| Key | Meaning |
|---|---|
| `carriers` | `{machine-id: version}` — which machines run this policy *right now*, at which version. Empty means nobody |
| `syntax` | the `node --check` result, `{ok, checked, message}` |

`carriers` exists because the card used to say "not deployed anywhere" unconditionally, which
was wrong for every policy that already had a version in the field.

The parse check is the only validation anywhere in the pipeline. The server checks the id
charset and a 1 MiB ceiling and nothing else, so without it this reaches every machine in the
fleet and fails at enforcement time, where nobody is watching:

```bash
echo 'this is not javascript {{{' | fp policies publish broken   # refused by the check
```

**`--no-verify` with `--json` is a landmine.** Read from the source, not executed: `syn` is
assigned inside `if not no_verify:`, and the JSON writer emits `"syntax": syn.to_dict()`
unconditionally (`commands/policies_cmds.py`, grep `carriers = {`). The version is created
server-side first, so the failure comes after the write. Let the check run, or drop `--json` for
that call.

A host with no `node` on PATH is not blocked — it publishes with `checked: false` and a warning.
That warning is printed only on the human path, which is why `checked` matters on the JSON one.

## `policies list` / `show`

`list` prints **one row per version**, not per policy: versions are immutable and every one
stays addressable, so a policy published three times is three rows. Deduplicate on `id` if you
want one row per policy. `state` is `active`, `disabled` (kept but not enforced) or `archived`
(deleted; machines already carrying it keep it until redeployed). Both need `policies:read`.

**Never paste `fp --json policies list` output into a file or a report.** It carries full policy
source, which is customer code.

## `policies enable` / `disable` / `delete`

All three need `policies:write` and all three take `--yes`.

| Command | Server effect | `--json` |
|---|---|---|
| `disable <id>` | reissues **every** deployment carrying it, without it, advancing each machine's generation. `fleet history` shows the reissue as an ordinary entry | `{id, disabled, archived, machinesUpdated}` |
| `enable <id>` | the exact inverse — puts it back into every deployment it was removed from. Nothing needs redeploying by hand | same shape; `machinesUpdated` matches the preceding disable |
| `delete <id>` | archives it. Hidden from `list` and from future deployments. **Machines already carrying it keep enforcing it until something redeploys** | same shape, or `{"cancelled": true}` |

`machinesUpdated` is the number to check when you expected a no-op.

`delete` cannot be undone from the CLI. Since it does not stop enforcement either, it is almost
never the right verb in an incident — `disable` is.

## `fleet list` / `show` / `diff` / `history`

All `policies:read`.

`fleet list` columns: `machine · label · pol · intended · applied · seen · events · state`.
**`intended` is the generation deployed; `applied` is the one the machine last collected; `seen`
is when it last reported anything** — a machine can be in sync and dead, or alive and behind, and
those are different problems. A machine appears from its very first check-in, including the poll
that finds nothing deployed, which is usually exactly the machine you are looking for.

`fleet show <machine-id>` is what you read **before a `--set`**, because that flag replaces
everything shown. It also reports whether the machine has actually collected the deployment.
`--json` gives `{machine, deployment}`, with `deployment: null` when nothing is deployed.

`fleet diff [machine-id]` is intent versus delivery for one machine or the whole fleet:

```json
{"machines": [{"machineId": "<machine-id>", "intended": 7, "delivered": 6, "drifted": true}]}
```

`drifted` is computed by the CLI so a harness need not derive it.

`fleet history <machine-id>` lists generations newest first, `{deployment, policies, updatedAt}`.
A reissue caused by a `policies disable` appears as an ordinary entry — it is not marked as
different from a human deploy.

## `fleet deploy`

```bash
fp --json fleet deploy <machine-id> --add no-force-push:observe
fp --json fleet deploy <machine-id> --add prod-guard@1:observe --remove old-rule
fp --json fleet deploy <machine-id> --set no-force-push --set no-secret-echo
```

`PUT /api/enforcement/deployments/{id}` is a **full replace**. Send `{"policies": [a]}` to a
machine running `[a, b, c]` and it now runs `[a]`, permanently, with a 200 and no warning. That
is why `--add`/`--remove` exist: the CLI reads the current set, applies the delta, and writes the
whole thing back (`enforcement.py`, module docstring).

### Ref grammar

`_REF` is `^(?P<id>[A-Za-z0-9._-]{1,128})(?:@(?P<version>\d+))?(?::(?P<effect>[a-z]+))?$`.

| Token | id | version | effect |
|---|---|---|---|
| `no-force-push` | yes | resolved | resolved |
| `no-force-push@4` | yes | 4 | resolved |
| `no-force-push:observe` | yes | resolved | observe |
| `no-force-push@4:enforce` | yes | 4 | enforce |
| `a,b` | **parse error, exit 2** — a comma is not in the id charset | | |

Resolution, from `resolve_ref`:

- **Version:** explicit wins; else the version already deployed (so a bare `--add` on a policy
  the machine runs is a no-op, not a silent upgrade); else the newest published.
- **Effect:** explicit wins; else the deployed effect; else **`enforce`**, matching the server's
  default for an omitted effect.

**So a bare `--add` on a policy the machine does not run enforces it.** There is no
observe-by-default anywhere.

Effects are exactly `enforce` and `observe`. `observe` runs the policy for real, records what it
would have decided, and returns allow.

A disabled policy is refused before the plan is drawn (`enforcement.py`, grep `def disabled_ids`)
— otherwise the last thing on screen was a change that could not happen, under a prompt implying
it could.

### `--set`

Replaces the whole set and is the only way to drop policies you do not name. It **cannot** be
combined with `--add`/`--remove`: mixing "exactly these" with "these as well" has no single
reading, and guessing one would be guessing about somebody's fleet. Exit 2.

### Exit codes and JSON, which do not agree

| Outcome | Exit | `--json` |
|---|---|---|
| Applied | 0 | `{plan, deployment, applied: true}` |
| **No-op** | **0** | `{plan, deployment: null, applied: false}` |
| **Declined prompt** | **0** | `{plan, cancelled: true, applied: false}` |
| Bad ref / `--set` mixed with `--add` | 2 | error envelope |
| Unknown machine without `--create` | 6 | error envelope |
| Concurrency collision | 1 | error envelope |

The no-op short-circuit happens **before** the write, which has a second consequence worth
knowing: a reader without `policies:write` also gets 0 there. They gained nothing — the state
already held — but **exit 0 is not proof of write access**.

### The prompt you will not see

`confirm_destructive` → `confirm_action` → `should_prompt`, which returns False (auto-proceed)
when `--yes` is given, `--json` is set, **or stdin is not a TTY** (`commands/_write.py`). All
three describe a harness. Do not treat the confirmation as a check on your own behaviour; it
does not run for you.

### The concurrency guard

No optimistic locking exists on the endpoint. The CLI records the generation it read and refuses
if the result is not exactly `base + 1` (`enforcement.py`, grep `def check_race`), because a full
replace does not merge and reporting success would make the CLI the easiest way to silently
overwrite a colleague.

Recover by re-reading, never by retrying the same command:

```bash
fp --json fleet show <machine-id>
fp --json fleet deploy <machine-id> --add no-force-push:enforce
```

### `--create`

The server accepts a deploy to any id — that is how a machine gets pre-staged before it ever
polls. Without `--create` the CLI refuses an id nobody has checked in under (exit 6). With it, a
**typo mints a machine nobody owns**, carrying policies nobody will collect, and the only sign is
an extra row in `fleet list` — a permanent one. `fp fleet` has `list`, `show`, `deploy`, `diff`,
`history`, `rollback` and `rename`, and **no delete or forget**: nothing in the CLI removes a
machine once it exists. `rename` can label it as junk; it cannot take it back out. Verified live
against a real org: a mistyped id is not a recoverable mistake, so treat `--create` as
write-once and confirm the id before passing it. The dashboard cannot hit this because it deploys to a machine
picked from a list.

## `fleet rollback` / `rename`

`rollback <machine-id> <generation>` mints a **new** generation carrying the old set rather than
rewinding the counter, so history stays append-only. A generation containing a policy since
disabled or deleted **cannot be reinstated**; the server says so. `--json` returns the resulting
deployment, or `{"cancelled": true}`.

`rename <machine-id> "<label>"` stores a label **beside** the machine's self-asserted one rather
than replacing it: `{machineId, labelOverride}`. The id never changes.

## `guardrails`

```bash
fp --json guardrails summary --since 24h --machine <machine-id>
fp --json guardrails timeline --since 7d
```

**A bare `fp guardrails` prints the group help and exits 0** — verified live. The group is
`no_args_is_help=True`; the summary docstring's `fp guardrails` example is stale. Always write
the subcommand.

`summary` renders evaluated/blocked totals, `enforcingMachines`/`reportingMachines`, a 24-bin
sparkline of denies, and a per-policy table with columns **policy · fired · blocked ·
instructed · p95**. `--json` emits `{"summary": …, "timeline": …}` — both, from one call — and
the keys inside it are:

| Path | Holds |
|---|---|
| `.summary.totals` | `evaluated`, `blocked`, `enforcingMachines`, `reportingMachines` |
| `.summary.hours` | the window the server echoed back, which is what the title renders |
| `.summary.policies[]` | `policy`, `fired`, `blocked`, `instructed`, **`p95Ms`** |
| `.timeline` | the server's timeline verbatim, one entry per bucket per source |

So one policy's row is `jq '.summary.policies[] | select(.policy == "<id>")'`.

`timeline` renders **time · activity · total · denied · instructed**, one row per bucket, times
in UTC, the bar scaled to the busiest bucket with the blocked share drawn inside it. The label
follows the bucket size the server chose: a clock for hourly, a date for daily.

| Detail | Why it matters |
|---|---|
| Coverage is Postgres, decisions are ClickHouse | a machine can be deployed-to and silent, or reporting and undeployed. Only the first half moves when you deploy |
| The `(no policy)` row | the denominator. Most evaluations are allows nothing objected to |
| `--since` accepts only `1h`, `6h`, `24h`, `7d` | `15m` is **refused, exit 2**, on purpose: the endpoints take whole-hour windows, so it silently widened the window 4x and `timeline` renders no window label to contradict it |
| An unknown `--machine` | refused, exit 6 — an empty window reads as "quiet", not as "you typed it wrong" |

Reading the per-policy row:

| Row | Means |
|---|---|
| `fired > 0`, `blocked = 0`, deployed `observe` | working as intended — the measurement you promoted on |
| `fired > 0`, `blocked = 0`, deployed `enforce` | it matches, and nothing it matched was worth denying. Check the rule is not inverted |
| `fired = 0` after a real window | either nobody does the thing, or the machine never collected it. **`fleet diff` first** |
| `blocked` climbing steeply | check whether it is concentrated in a few sessions (an agent stuck retrying) or spread thin across many (a mis-scoped rule) before calling it a success |

## `policies compose`

```bash
fp policies compose "block force pushes to main"
fp policies compose "deny reading .env" --out env-policies.mjs
fp --json policies compose "…" --publish no-force-push
```

`POST /api/agent/compose-policy`. **It needs `policies:write`, not `agent:use`** — the dashboard
exports the route as `withAuth("policies:write", …)`, while `agent:use` gates the assistant's
chat, answer and conversations routes and is not checked here. A role with only `agent:use` is
refused; a role with `policies:write` and no `agent:use` works. Session-only.

The route **streams** `text/event-stream` — `delta` frames then one `done` carrying the finished
source. That is a client detail, not something you drive.

| Flag | Behaviour |
|---|---|
| *(none)* | prints the draft and does nothing else. A generated policy that deploys itself is one nobody read |
| `--out <file>` | saves it, **before** anything that can fail — a refused publish no longer discards the draft |
| `--publish <id>` | publishes under that **policy id**. It is not a boolean: `--publish true` publishes a policy named `true`. Still syntax-checked; a draft that does not parse is refused |

`--json` returns `{prompt, source, syntax, published, savedTo}`. If the assistant returns no
source at all, the hint points at `fp agent health` — the assistant may not be configured on that
deployment.

Always run a composed draft through `policies test` before publishing it. The assistant writes
source; it does not verify behaviour.
