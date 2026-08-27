# The five verticals, as workflows

Observe, enforce, evaluate, audit, manage. Each section is the question a user actually asks,
the command that answers it, and the trap that makes the obvious command answer something
else.

Two of the five **do not exist on the local half at all**. An offline machine runs observe,
enforce and audit completely and evaluate and manage not at all. That is a supported end
state, not a broken install — do not send someone to sign in because `fp evals` is missing on
a machine that was never meant to have it.

| Vertical | Local | Cloud | Owns the depth |
|---|---|---|---|
| Observe | hook activity + transcripts on disk, dashboard at `127.0.0.1:8020` | `events` `sessions` `errors` | `fp-cloud-cli` |
| Enforce | 39 builtins + custom policies, hooks in 12 harnesses | `policies` `fleet` `guardrails` | `failproofai-policy-author`, `failproofai-policy-deploy` |
| Evaluate | — nothing | `evals` + an evaluator service you host | `agenteye-evaluator` |
| Audit | `failproofai audit`, offline, no account | `audits` → findings → `issues` | `failproofai`, `fp-cloud-cli` |
| Manage | — nothing | `orgs` `keys` `users` `query` `alerts` `settings` `usage` | `fp-cloud-cli` |

Before writing any cloud command, resolve the binary and check auth mode — both answers change
which of the rest of this page applies:

```bash
command -v fp agenteye          # prefer fp
fp --json whoami | jq -r '.auth_mode'   # session | api_key | none
```

---

# OBSERVE — what did the agent actually do?

`events` `sessions` `evals` `errors` `usage`. Read-only, and the fastest vertical to be wrong
in, because three commands look interchangeable and answer different questions.

| The question | The command | The trap |
|---|---|---|
| "what ran in the last day?" | `fp --json sessions --since 24h` | `status` is the latest **evaluation** outcome. Blank means never evaluated, not passed |
| "what did *this* run do, step by step?" | `fp --json events --session-id <id> --all` | The default feed is payload-free. You get `summary`, not arguments |
| "show me the actual tool arguments" | `fp --json events --full --session-id <id> --all` | `--full` is a different, heavy endpoint. **Bound it to one session** |
| "what's failing in prod?" | `fp errors --env prod --since 24h` | `errors` takes **one value per filter**. `--env prod,staging` looks for an env literally named `prod,staging` |
| "how bad is it, overall?" | `fp --json errors --aggregate --since 7d` | Aggregate gives count + blast radius (sessions, agents, recency), not a list |
| "which agent is worst?" | `fp --json evals --aggregate --agent-id <agent>` | Needs an evaluator to have run. No evaluator, no evals — see EVALUATE |
| "what values can I even filter on?" | `fp --json list agents` (`envs`, `event_types`, `tools`, `models`, `hooks`, `error_types`, `score_filters`) | Run this **first**. A filter value that does not exist returns an empty list, not an error |
| "am I near a limit?" | `fp --json usage` | It reports the 30-day window and **applies and displays no limits**. It is not a quota check |

## The multi-value split

`events` and `sessions` accept multiple values per filter — repeat the flag or comma-separate,
and values within one filter match *any*. `evals` and `errors` take exactly one value per
filter. This is the single most common wrong-answer-with-no-error in the vertical:

```bash
fp --json events --env prod,staging --event-type tool_use,error   # either/or — works
fp --json errors --env prod,staging                                # matches nothing, exit 0
```

Different filters always AND together, in all four commands.

## Sessions vs events vs evals

One row per **run** is `sessions`. One row per **step** is `events`. One row per **scored
judgement** is `evals`. A session can involve more than one agent: `agent_id` is the root
agent (the first to start) and `agents` is the full roster; `--agent-id` matches a session if
*any* of its agents is named, which is why an agent filter can return sessions whose displayed
agent is a different one. `--agents` expands the roster in the rendered table only — `--json`
always carries it.

`sessions` needs `evaluations:read`, not `events:read`, because the status column comes from
the evaluation. A read-only key scoped to events gets a permission error on a command that
reads like an events command.

## Paging

`--limit`/`-n` caps the total (default 50). `--all` auto-paginates up to that limit;
`--page-size` sets rows per request (max 200); `--cursor` resumes from a prior `next_cursor`.
Time is `--since` (`all`, `15m`, `1h`, `6h`, `24h`, `7d`) or `--from`/`--to` in ISO-8601 UTC,
which override it.

Route: `fp-cloud-cli` for driving a live deployment. Instrumenting your own agent so events
exist at all is `failproofai-sdk`.

---

# ENFORCE — stop it before it happens

`policies` `fleet` `guardrails`, plus the whole local half. This is the vertical with real
blast radius, and the one where the shipped surface is newest.

**Deployment is CLI-drivable.** Anything claiming assignment, promotion or rollback is
"dashboard work" or "not exposed by the cloud CLI" is stale, and acting on it stops an agent
looking for commands that exist.

## The lifecycle

```
compose  →  test  →  publish  →  fleet deploy  →  guardrails
draft it    prove it   mint a       put it on      watch what
            decides    version      machines       it actually did
```

| The question | The command | The trap |
|---|---|---|
| "write me a policy that blocks X" | `fp policies compose "block force pushes to main"` | Needs **`policies:write`, not `agent:use`** — backwards from the name |
| "does it actually deny that?" | `fp policies test ./rule.mjs --command "git push --force origin main"` | Proves it parses, registers and decides. **Cannot** prove the daemon feeds it the same context |
| "ship it" | `fp policies publish no-force-push ./rule.mjs` | ***Publishing deploys nothing.*** It mints a version that sits unused |
| "put it on the machine" | `fp fleet deploy <machine-id> --add no-force-push:observe` | ***A bare `--add` enforces.*** Omit `:observe` and it is live |
| "what is this machine running?" | `fp fleet show <machine-id>` | Read it before any `--set` — that flag replaces everything |
| "is it actually running it?" | `fp fleet diff` | Intent vs delivery. A machine can be in sync and dead, or alive and behind |
| "did it block anything?" | `fp guardrails summary --since 24h` | Bare `fp guardrails` prints help and exits 2. The summary is a named subcommand |
| "turn it off everywhere" | `fp policies disable <id> --yes` | **`delete` does not stop enforcement.** Machines already carrying an archived policy keep running it |
| "undo that deploy" | `fp fleet rollback <machine-id> <generation>` | Mints a *new* generation carrying the old set. History stays append-only |

## The three that bite hardest

**A bare `--add` on a new policy enforces it.** Effect resolution is: explicit → the effect
already deployed → `enforce`. There is no observe-by-default anywhere. If you want a dry run
on a real machine, `--add <id>:observe` is the only way to get one. Effects are exactly
`enforce` and `observe`.

**Publishing and deploying are separate, and only one of them changes behaviour.**
`policies publish` mints an immutable new version — every version stays addressable, which is
why `policies list` shows one row per version and you deduplicate on `id` to get one row per
policy. Nothing runs it until `fleet deploy` names it. The `--json` from publish includes
`carriers` (machine id → the version each currently runs) precisely so a harness can see that
gap without a second call.

**`disable` stops enforcement; `delete` does not.** `disable` makes the server reissue every
affected machine's deployment *without* the policy, advancing each generation — `machinesUpdated`
in the JSON is the count, and it is the number to check when you expected a no-op. `delete`
archives: hidden from the library and from future deployments, still enforced by every machine
already carrying it until something redeploys.

## Deploy mechanics worth knowing before you run one

- Refs are `id` | `id@version` | `id:effect` | `id@version:effect`, and are **not
  comma-split** — `--add a,b` is one malformed ref, exit 2. Repeat the flag.
- `--set` replaces wholesale and **cannot mix** with `--add`/`--remove`.
- `--add` on a policy the machine already runs **keeps its pinned version**; pass `id@version`
  to move it.
- A no-op exits 0 without writing. `applied: false` in `--json` is the only way to tell "I
  changed it" from "it already matched" — and because the short-circuit precedes the write, a
  reader without `policies:write` also gets 0. **Exit 0 is not proof of write access.**
- A declined prompt exits 0 with `cancelled: true`.
- Concurrency is base+1: exit 1 means someone else deployed in between and a replace does not
  merge. Re-read `fleet show`, then deploy again. Never loop on it.
- `--create` pre-stages a machine that has not checked in. Without it a typo'd id is refused
  (exit 6); with it, a typo mints a machine nobody owns carrying policies nobody collects.

## CI cannot drive this

**Every `policies`/`fleet`/`guardrails` subcommand except `policies test` exits 2 under an API
key.** These are operator surfaces and are not exposed on the versioned API a key
authenticates against; the refusal fires before any HTTP call, so nothing half-runs. No flag
changes it. Plan the rollout as something a person runs, and put only `policies test` in the
pipeline — it needs no server, no fleet and no auth, just `node` on PATH.

## The local half

Enforcement on one machine needs no account at all: 39 builtins, custom policies, hooks
installed into 12 harnesses. `failproofai policies --install`, `failproofai policy add <name>`.
Two silent-blast-radius traps live there — `policies --uninstall --scope all` has no
confirmation prompt, and with `--cli` omitted off a TTY install/uninstall target every
detected agent CLI.

Route: authoring a policy from a complaint or an audit finding is `failproofai-policy-author`.
Getting one onto machines, proving it fired, and recovering a bad deploy is
`failproofai-policy-deploy`. Flags and JSON shapes are `references/commands.md`.

---

# EVALUATE — was that run any good?

The one vertical the product does not implement for you. **An evaluator is an HTTP service you
own.** When a session ends, the server POSTs the whole transcript to it and you return scores.
There is no registry and no plugin system; nothing is uploaded.

```
agent run ends  →  the server POSTs the transcript to YOUR service
                →  you return {"scores": {"helpfulness": 0.9, …}}
                →  scores land in evaluations  →  fp evals
```

| The question | The command | The trap |
|---|---|---|
| "show me the scores" | `fp --json evals --since 7d` | Empty is the **normal** answer with no evaluator running. It is not a broken install |
| "how is this agent doing overall?" | `fp --json evals --aggregate --agent-id <agent>` | Aggregate is over the whole matching set — point it at one slice or it means nothing |
| "which metric is worst?" | `fp --json evals --aggregate ... \| jq '.score_stats'` | Sorted worst-average-first already |
| "only the good runs" | `fp evals --score helpfulness:0.8.. --since 7d` | `KEY:MIN..MAX`, either bound optional, repeatable, **all ranges ANDed** |
| "what metrics exist?" | `fp --json list score_filters` | These are the keys your own evaluator emitted. Nothing is predefined |
| "why is `sessions` status blank?" | — | Never evaluated. Same root cause: no evaluator |

`evals` filters take **one value each** (`--env`, `--status`, `--agent-id`, `--session-id`).
`--status` is `done`, `error` or `timeout` — the run's health, not a score threshold. Both
list and aggregate honour every filter.

The hard part is deciding what to score, and only the user knows that. The SDK part is small.

Route: **`agenteye-evaluator`** — designing the dimensions, scaffolding the service, rules vs
LLM judge, testing against a real captured session, deploying it and confirming scores land.
That skill keeps its `agenteye` name because the package genuinely was not renamed: dist
`agenteye-evaluator`, module `agenteye_evaluator`, user-agent `agenteye-server/<version>`. Do
not "correct" it.

---

# AUDIT — is this a pattern across many runs?

**"Audit" means two unrelated things**, and the fork wastes more time than anything else in
this file:

| | Local audit | Cloud audit |
|---|---|---|
| Command | `failproofai audit` | `fp audits …` |
| Scans | this machine's own agent history, offline | sessions already delivered to the cloud |
| Account | not needed | required |
| Scheduling | `audit --schedule [days]`, emails you | server-side cadence |
| Output | `127.0.0.1:8020/audit` + a JSON cache | findings → issues → alerts |

Establish which one the user means before running anything. `failproofai audit` **never
exits** — it serves until Ctrl+C — so never call it in a foreground agent shell. The cache is
written before the server starts, so `timeout 180 failproofai audit` (exit 124) still leaves
`~/.failproofai/audit/dashboard.json`. Exit 75 means another audit holds the lock: come back
later, not a failure.

The cloud chain is `audit → run → finding → issue`. A finding is a **recurring pattern carried
across runs**, not a single event.

| The question | The command | The trap |
|---|---|---|
| "audit prod every night" | `fp audits create nightly-prod --scope '{"environments":["prod"]}'` | Everything but the name has a server default. Attach `--text`/`--url` **in this call** |
| "run it now" | `fp audits run nightly-prod` | Means **queued**, not finished. Follow with `fp audits runs nightly-prod` |
| "what did it find?" | `fp audits findings --status open` | No `--status` gives the live set: open + recurring |
| "tell me about this one" | `fp audits finding <id>` | Findings are by id; audits are by name. Two different handles |
| "I fixed it" | `fp audits resolve <id> --yes` | Leaves **no suppression** — if it recurs, the next run raises it as new. That is deliberate |
| "stop showing me this" | `fp audits mute <id> --reason "…" --yes` | Durable suppression by fingerprint. `reopen` is the undo |
| "who owns this?" | `fp audits assign <id> --to you@example.com` | **`--to` is required**; the status is untouched |
| "what's on fire right now?" | `fp issues list --state firing` | The CLI calls them incidents internally — every positional is `INCIDENT_ID` |
| "close it" | `fp issues resolve <id> --yes` | Needs `issues:close`; `ack` rides on `issues:read` |

## Choosing a triage verb

Five verbs exist because they leave five different things behind:

| Verb | Status | What survives |
|---|---|---|
| `ack` | unchanged | ranks the pattern lower in later runs; it stays visible |
| `mute` | `muted` | durable suppression — a re-detection of the same fingerprint stays hidden |
| `dismiss` | `dismissed` | durable suppression, labelled "judged not a problem" |
| `resolve` | `resolved` | nothing. A genuine recurrence comes back as new |
| `reopen` | `open` | clears mute/dismiss suppression |

`ack`, `mute` and `dismiss` take `--reason`, kept as durable feedback the ranker reads.

## Reference context is the lever on quality

`fp audits context-set <name> --text "…" --url https://docs.example.com/runbook` attaches an
operator brief and reference pages to the analysis prompt. Read `context-show` before trusting
a run: it reports how much of each page was stored, whether it was truncated, how many
secret-shaped values were masked, and **whether the page contains phrases that read as
instructions to an AI**. URLs are public `https://` only — private, loopback and cloud-metadata
addresses are refused.

Omission means *keep*, for both halves. Removing is explicit: `--text ""` clears the brief,
`--clear-urls` drops every page.

Route: local audit and its findings feed `failproofai-policy-author` — a finding's examples are
what turns a complaint into something matchable. Cloud triage depth is `fp-cloud-cli`.

---

# MANAGE — who can do what, and what does it cost

`orgs` `keys` `users` `query` `alerts` `settings` `usage`. Cloud only; there is no local
equivalent of any of it.

| The question | The command | The trap |
|---|---|---|
| "which tenant am I in?" | `fp --json orgs current` | `orgs switch` rewrites saved state and **silently retargets every later command**. `--org` scopes one invocation |
| "what can I do here?" | `fp orgs perms` | Permissions are **per org**. Switching orgs changes your grants |
| "give CI a read-only key" | `fp keys create ci-bot --permission-set read-only` | **The secret appears exactly once.** Piped, it goes to stdout bare |
| "rotate that key" | `fp keys regenerate ci-bot -y` | The old secret stops working immediately |
| "revoke it" | `fp keys disable ci-bot --yes` | **Not reversible.** Mint a replacement |
| "add a teammate" | `fp users create you@example.com --permission-set standard` | Grants are `(set ∪ added) − removed` |
| "offboard them" | `fp users disable you@example.com` | Needs `users:delete`, **not** `users:create`. The account is global — this is offboarding from every org |
| "alert me when errors spike" | `fp alerts create high-errors --trigger-kind metric_threshold --severity warning --trigger-spec '{…}'` | `alerts update` needs `alerts:read` **and** `alerts:write` — it re-sends the whole definition |
| "does the alert work?" | `fp alerts test high-errors` | It **really delivers** to the real channels. Success means dispatched, not received |
| "run some SQL" | `fp --json query run --sql "select count(*) from analytics.events"` | `--json` returns **all** rows; `--limit` only caps the table view |
| "what's queryable?" | `fp query schema` | Read-only analytics pool |
| "change a setting" | `fp settings set <key> --value <v>` | Provide the value exactly one way: `--value`, `--json-value`, or `--file`/stdin |
| "what's it costing?" | `fp --json usage` | A fixed 30-day window. It **applies and displays no limits** |

## The instance-scoped key trap

A key not bound to one org selects its tenant per request. **Omitting the org does not error**
— it resolves server-side to the *default* organization, silently, so reads answer with some
org's data and writes can land in the wrong tenant.

The pre-flight is `fp --json whoami | jq -r '.active_org'`: under a key it reports
`{"logged_in": false, "auth_mode": "api_key", "active_org": …}`, and a `null` there is exactly
this condition. In key mode **only an explicit `--org` is ever sent** — the saved org belongs
to whichever human logged in on that machine, not to whichever org a CI key was minted for.

## Permission tokens

`--add` / `--remove` on `keys` and `users` take the compact `slug:action.action` format. Dotted
actions expand: `keys:create.regenerate` becomes two grants. Compose by comma, repeated flag,
or a quoted group.

**Retired spellings still parse and expand wider than they read.** `incidents:read` →
`issues:read`; `incidents:write` → `issues:create`; and `incidents:ack` and `alerts:ack` each
expand to **all three** of `issues:read`, `issues:create`, `issues:close`. A script still
passing `--add alerts:ack` is granting issue-closing authority. See `references/literals.md`.

## What a key cannot do at all

Beyond the enforce group, key mode refuses `login`, `logout`, every `orgs` subcommand, every
`agent` subcommand, and `keys update` — that last one because it needs `keys:update`, which is
grantable to no key by construction. All exit 2, all before any HTTP call.

Route: `fp-cloud-cli` for operating a deployment day to day. Self-hosting and the HTTP API are
in the `failproofai` skill's `references/cloud.md`.
