---
name: failproofai-complete
description: |-
  The complete FailproofAI reference — the whole product. Both binaries, all five verticals, every command of both CLIs, the docs map, and which sibling skill owns what. Reach for it on "explain FailproofAI", "what can it do?", "which skill do I install?"

  Trigger when the user wants to:
  • understand the product — what FailproofAI is, how local enforcement and FailproofAI Cloud differ, what a policy/finding/deployment is;
  • see the whole surface — every `fp` command, the local CLI, the SDKs, the evaluator, the API;
  • compare the verticals — observe, enforce, evaluate, audit, manage — and what each cannot do;
  • pick or install a skill from the collection;
  • hand one standalone artifact to an agent that must know everything, wiring a machine from zero included.

  The KNOWING skill. For DOING on a live machine — a broken install, a symptom, a stopped daemon — use `failproofai`; authoring policy `failproofai-policy-author`, rollout `failproofai-policy-deploy`, the cloud `fp-cloud-cli`.
---

# FailproofAI, complete

Observability and enforcement for every harness your agents run in — coding CLIs, chat
gateways, self-hosted assistants, and agents you instrumented yourself.

    Session  →  Audit  →  Finding  →  Issue  →  Policy
    what happened   is it a pattern   what broke   who owns it   stop it recurring

This skill is the **reference**, not the runbook. It answers *what is this, what can it do,
which command, which skill* — the full map, in one artifact, so an agent handed only this
file can explain the product and stand a machine up unaided.

Its sibling `failproofai` answers the other half: *my install is broken, my sessions aren't
landing, fix this*. If both are installed, symptoms go there and questions stay here.

Read in order: *Two halves, two binaries* (the category error that costs the most time), *The
five verticals* (what the product is for), then the two command maps. After that, go to *Set
up a machine from zero* or *The skill directory* depending on whether the user wants to build
or to route.

`references/` carries the depth this file deliberately withholds — see *References* at the
bottom. SKILL.md is shape and routing; the moment you need a flag, open the reference.

## Two halves, two binaries

**FailproofAI is one product with two halves, and each half ships its own binary.** Almost
every early mistake is a category error between them — a cloud command aimed at the local
CLI, or an install that never connected anything.

| | Local | **FailproofAI Cloud** |
|---|---|---|
| Binary | `failproofai` | `fp` — current. `agenteye` is legacy, still installable |
| Install | `npm i -g failproofai` (Node >= 20.9) | `uv tool install fp-cloud-cli` (or pipx) |
| Runs | on one machine, offline | against a dashboard over HTTPS |
| Does | hooks, policies, enforcement, capture, machine enrollment, offline audit, local dashboard | sessions, events, evals, errors, audits, issues, alerts, keys, orgs — and publish/deploy/roll back policy |
| Needs an account | **no** — a fully offline machine is a supported end state | yes |
| Platform | Linux/macOS (Windows unsupported for anything daemon- or capture-related) | anywhere Python runs |
| Config | `~/.failproofai/` | `~/.failproofai/fpcli/cli-auth.json`, mode 0600 |

**Never write `uv tool install fp-cli`.** `fp_cli` is the Python module; the distribution is
`fp-cloud-cli`. The module name installs nothing.

Separate packages and separate auth — but **not** separate config trees any more. The cloud
CLI's session file moved *inside* the local home, so `~/.failproofai/` existing tells you
nothing about cloud sign-in, and being signed in tells you nothing about the local half.
Probe each with its own command. (`~/.fp/cli.json` and `$FP_HOME/cli.json` are read once for
adoption and never written.)

**Two cloud binaries can be on PATH, and `fp` wins.** Resolve it once, before writing any
command:

```bash
command -v fp agenteye        # fp first — prefer it whenever both resolve
```

Legacy `agenteye` (0.1.13, dist and module `agenteye`/`agenteye_cli`) has no `policies`,
`fleet`, `guardrails` or `usage` **at all** — a missing command there means "wrong binary",
not "not shipped".

### The cloud half was called AgentEye

It is now **FailproofAI Cloud** — spell it that way, one word, matching the binary's own
help. Never introduce "AgentEye" yourself. But recognise it, because the old name is still
load-bearing where a rename cannot cheaply reach, and an agent that meets one of these must
know it is the same product:

| Still says AgentEye | What it is |
|---|---|
| `X-AgentEye-Org`, `X-AgentEye-Client`, `X-AgentEye-Signature`, cookie `ae_session`, OpenAPI title "AgentEye API" | the wire and the session. `fp` still sends every one |
| `AGENTEYE_HOME`, `~/.agenteye/events` | the **local daemon's** legacy SDK spool, still watched |
| `AGENTEYE_KEY` (collector ingest), `AGENTEYE_API_KEY` (dashboard admin) | ingest credentials. `FP_API_KEY` was named deliberately *not* to collide — never reuse either |
| `ghcr.io/agenteye-enterprise/*`, k8s namespace `agenteye`, ClickHouse `agenteye.events` / `agenteye.agent_sessions` | self-hosted infrastructure |
| dist `agenteye-evaluator`, module `agenteye_evaluator`, UA `agenteye-server/<version>` | the evaluator package — and the one sibling skill that keeps its name |
| `incidents:read`/`:write`/`:ack`, `alerts:ack`, the `INCIDENT_ID` positional on `issues show` | retired grants and arguments the server still parses |

**The env prefix follows the binary; the wire never modernises.** Those are two halves of one
rule and both are true. `fp` reads `FP_HOME`, `FP_JSON`, `FP_TOKEN`, `FP_API_KEY`, `FP_ORG`,
`FP_DASHBOARD_URL`, `FP_INSECURE`, `FP_ANALYTICS_DISABLED`, `FP_CLI_DEV`, plus
`FAILPROOFAI_HOME` — and **zero** `AGENTEYE_*` variables. Legacy `agenteye` reads
`AGENTEYE_HOME`, `AGENTEYE_CLI_TOKEN`, `AGENTEYE_CLI_JSON`. Note the dropped infix: it is
`FP_TOKEN` and `FP_JSON`, **not** `FP_CLI_TOKEN`/`FP_CLI_JSON` — a mechanical `AGENTEYE_` →
`FP_` rewrite produces names nothing reads. And `AGENTEYE_TOKEN` in the SDK install doc is an
invented placeholder for a GitHub PAT, defined by no artifact — it must not become
`FP_TOKEN`.

Full table, both binaries, with read sites: `references/env-vars.md`. The
never-rename list with what still reads each literal: `references/literals.md`.

## The five verticals

What the product is *for*, and — more usefully — what each cannot do on the half you have.

| Vertical | Answers | Local half | Cloud half |
|---|---|---|---|
| **Observe** | what did the agent actually do? | hook-activity rows + transcripts on disk, browsable at `127.0.0.1:8020` | `fp events` `fp sessions` `fp errors`, traces, models, tools, hooks in the dashboard |
| **Enforce** | stop it before it happens | 39 builtins + custom/convention policies, hooks in 12 harnesses | `fp policies` versions, `fp fleet deploy`, `fp guardrails` |
| **Evaluate** | was that run any good? | — nothing local | `fp evals`, plus an evaluator service you host |
| **Audit** | is this a pattern across many runs? | `failproofai audit`, offline, no account | `fp audits` sweeps → findings → `fp issues` → `fp alerts` |
| **Manage** | who can do what, and what does it cost | — nothing local | `fp orgs` `fp keys` `fp users` `fp settings` `fp usage` |

Two rows have an em-dash for a reason: **evaluate and manage do not exist offline.** An offline
machine runs observe, enforce and audit completely and the other two not at all — a supported
configuration, not a broken one.

**"Audit" means two unrelated things** and the fork wastes more time than anything else here:

| | Local audit | Cloud audit |
|---|---|---|
| Command | `failproofai audit` | `fp audits …`, or the dashboard |
| Scans | this machine's own agent history, offline | sessions already delivered to the cloud |
| Account | not needed | required |
| Scheduling | `audit --schedule [days]`, emails you | server-side cadence |
| Output | `127.0.0.1:8020/audit` + a JSON cache | findings → issues → alerts |

Depth on every vertical: `references/verticals.md`.

## The `fp` command map — 23 commands

Argument order is a hard rule, and getting it wrong is a usage error, not a warning:

```bash
fp --json sessions            # global BEFORE the command      — OK
fp sessions --json            # global after                   — usage error, exit 2
fp --json keys create ci-bot  # a command's own options after it — OK
```

Globals: `--json --base-url --org --token --api-key --insecure/--secure --timeout --quiet
--no-color`. Every command takes `--json`, so the whole surface is agent-drivable.

**ESSENTIALS**

| Command | Purpose |
|---|---|
| `version` | The CLI version. `fp --json version` → `{"version": "x.y.z"}`; `fp --version` for a bare string |
| `help` | The command list, plus the argument-order rule printed at the foot of every help page |
| `login` | Sign in with a 6-digit emailed code; picks the active org and saves a ~24h session |
| `logout` | Best-effort server-side revocation, then wipes the session. Keeps `base_url` and `--insecure` |
| `whoami` | Who you are, the active org, that org's grants. **Never errors** — see below |

**`fp whoami` exits 0 whether or not you are signed in.** Signed out it prints
`{"logged_in": false, "auth_mode": "none"}`. Branch on the `.logged_in` / `.auth_mode`
**field**. Any instruction to read "exit 4 means not signed in" is wrong and will misreport a
healthy machine. Under an API key it reports a third, honest shape —
`{"logged_in": false, "auth_mode": "api_key", "active_org": …}` — where a null org means an
instance-scoped key resolved server-side to the default org, so you got *an* org's data, just
not necessarily the one you meant, with no error anywhere.

**OBSERVE**

| Command | Purpose |
|---|---|
| `events` | The raw per-step trail — tool calls, model requests/responses, hooks, results — newest first. Payload-free by default; `--full` is a heavier endpoint, so bound it |
| `sessions` | One row per agent run. `status` is the run's latest *evaluation* outcome, so it needs `evaluations:read`, not `events:read`; blank means never evaluated, not failed |
| `evals` | One row per scored judgement, or `--aggregate` for per-metric score stats, worst average first |
| `errors` | Errored events, or `--aggregate` for a count plus its blast radius (sessions, agents, recency) |
| `usage` | The active org's current fixed 30-day metering window. Read-only; it applies and displays no limits |

**ENFORCE**

| Command | Subcommands |
|---|---|
| `policies` | `list show publish enable disable delete test compose` — cloud-managed policy |
| `fleet` | `list show deploy diff history rollback rename` — machines and what each is told to enforce |
| `guardrails` | `summary timeline` — what enforcement actually did |

**Every `policies`/`fleet`/`guardrails` subcommand except `policies test` exits 2 under an
API key.** Enforcement is a human-session operation. CI cannot drive it, and no flag changes
that — plan the rollout as something a person runs.

**MANAGE**

| Command | Subcommands |
|---|---|
| `orgs` | `list switch current perms` — which tenant you are acting as |
| `keys` | `list show create update disable regenerate` — API keys by name; the secret is shown once |
| `users` | `list show create update disable enable` — members by email |
| `query` | `list show create update delete run schema` — saved SQL against the read-only analytics pool |
| `alerts` | `list show create update delete test` — a trigger, a cadence, and channels (email/Slack/webhook) |
| `audits` | `list show create edit delete run runs findings finding ack mute dismiss resolve reopen assign` |
| `issues` | `list count show ack assign resolve comment-list comment-add comment-delete subscribers subscribe unsubscribe open` |
| `settings` | `list schema set` — per-org settings; `schema` is the registry, `list` your values |

**TOOLS**

| Command | Subcommands |
|---|---|
| `list` | `envs agents event_types score_filters models hooks tools error_types` — the distinct values behind the dashboard's filter dropdowns. Run this before guessing a filter value |
| `agent` | `health models chats ask show rename delete` — the FailproofAI Cloud assistant, scoped to your org |

Every flag of every one of these, with permissions and JSON shapes: `references/commands.md`.

## The local `failproofai` command map

Eleven subcommands, a hook entrypoint, and a bare invocation that launches a dashboard.

| Command | Purpose |
|---|---|
| `config` (aliases `configure`, `setup`) | The six-step wizard. `--connect --token`, `--status`, `--pause`, `--resume`, `--disconnect`, `--machine-id`, `--machine-label`, `--no-transcripts`. **The only thing that installs the daemon** |
| `policies` (alias `p`) | List, `--install`, `--uninstall` hooks and policies across the 12 harnesses, per `--scope` and `--cli` |
| `policy add\|remove <name>` | Flip exactly one policy. Takes only `--scope`, `--cli`, `--beta` |
| `pack` | `pack list`, `pack add <owner/repo[@tag]>`, `pack remove <publisher/name>` — published policy packs, verified against the release `SHA256SUMS` |
| `harness` | `harness list`, `add-path`, `remove-path` — tell the collector where a harness's sessions live |
| `audit` | Scan this machine's own agent history offline. Also `--status`, `--schedule [days]`, `--no-schedule`, `--email` |
| `backfill` | Ask the daemon to re-read history it already holds a cursor for. `--since 30d\|6m\|YYYY-MM-DD`, `--dry-run` |
| `flush` | Ship what is spooled, now. `--wait`, `--timeout <secs>`. Refuses outright on Windows |
| `update` | Pending migrations + the matching daemon binary + a service restart |
| `migrate` | Layout migrations alone. `--dry-run` |
| `uninstall` | Hook entries from every CLI, plus the daemon service. `--purge` also deletes `~/.failproofai` |
| bare `failproofai` | The local dashboard on `127.0.0.1:8020`. **Parks until Ctrl+C** |
| `--hook <event> [--cli <name>]` | The entrypoint the harnesses call. Exits before the CLI proper, with its own exit-code contract |

Four rules that hold across the whole local surface:

- **No `--flag=value`.** Every parser is hand-rolled and rejects the equals form. Across both
  binaries there are exactly four exceptions: `--cli=`, `--effect=`, `--out=`, `--email=`.
- **`failproofai audit` and bare `failproofai` never exit.** Both serve until Ctrl+C. Never
  call either in a foreground agent shell — use `timeout`, or ask the user to run it. The
  audit cache is written *before* the server starts, so `timeout 180 failproofai audit`
  (exit 124) still leaves you `~/.failproofai/audit/dashboard.json`.
- **Two things need a TTY:** the `config` wizard, and `policies --install` with no policy
  names. Off a TTY the latter silently narrows to the 11 default-enabled builtins out of 39.
- **Nothing needs sudo except the daemon**, and only the wizard and `update` ask for it.

Full flag tables, exit codes and on-disk layout: `references/commands.md`. Paths, homes and
every variable: `references/env-vars.md`.

## Set up a machine from zero

This section is deliberately self-contained — see *Note for maintainers*. State the fork before
running anything, because it decides whether sudo is needed. **Local only** is hooks and
policies on this machine, nothing leaves it, no account, never `--connect` — a complete,
supported setup. **Cloud connected** adds centrally-managed policy, session capture and the
fleet view, and requires the daemon, which requires sudo.

### 1. The local half

```bash
npm install -g failproofai        # Node >= 20.9, Linux or macOS
failproofai config                # the interactive six-step wizard
```

**Only the interactive wizard installs the daemon.** `config --connect` deliberately avoids
sudo and merely warns. Without a daemon there is no policy pull, no transcript capture and no
delivery — so a `--connect`-only machine looks configured and ships nothing. This is the
single most common broken setup in the product.

### 2. Connect to the cloud, if you want the cloud

One URL and one scoped token configure **two independent capabilities**, each probed before
anything is written. `events:add` + `policies:pull` is the entire requirement, and the secret
is shown exactly once:

| Capability | Permission | Verified against |
|---|---|---|
| Pull managed policy | `policies:pull` | `GET <base>/enforcement/v1/desired-state` |
| Push events/transcripts | `events:add` | an empty `POST <base>/v1/events` |

```bash
failproofai config --connect https://app.befailproof.ai --token "<one-time-secret>"
```

Three traps, all of which have bitten people:

- **The exit code tracks only the policy half.** An `events:add`-only key writes a working
  ingest credential and still exits 1. Never `&&`-chain on this command — read the output.
- **Transcripts ship by default.** `--no-transcripts` limits to hook decisions, and is
  matched by exact string while the `config` branch validates *no* unknown flags — so
  `--no-transcript` or any other typo is silently ignored and full transcripts (prompts, file
  contents) ship. Confirm with `config --status`, never with the exit code.
- **The machine id does not default to the hostname**, despite what `config --help` says. It
  is an explicit `--machine-id`, else the one on disk, else a random UUID. The hostname is
  only the mutable *label*. Passing `--machine-id "$(hostname)"` on several machines silently
  merges them into one.

### 3. The cloud CLI

```bash
uv tool install fp-cloud-cli      # NOT fp-cli
fp login                          # 6-digit code by email; --org <slug> skips the picker
fp --json whoami                  # read .logged_in, not the exit code
```

### 4. Wire the agent CLIs

```bash
failproofai policies --install --cli claude --scope user
failproofai policy add block-rm-rf
```

Supported harnesses: `claude`, `codex`, `copilot`, `cursor`, `opencode`, `pi`, `hermes`,
`openclaw`, `factory` (binary `droid`), `devin`, `antigravity` (binary `agy`), `goose`.

- **Scope is not just a location.** `--scope project` writes a committable
  `npx -y failproofai` command with no machine-specific paths; `user`/`local` write an
  absolute binary path. Hermes and OpenClaw are user-scope only — they have no project config.
- **Installs are additive.** Repeated `--install` unions with what is enabled. There is no
  "exactly these and nothing else" — subtract with `--uninstall`.
- **Convention policies load by filename.** Any file matching `policies.{js,mjs,ts}` under
  `.failproofai/policies/` (project) or `~/.failproofai/policies/` (user) auto-loads.
  `block-force-push.mjs` is **skipped silently** and enforces nothing; name it
  `block-force-push-policies.mjs`.
- **Enforcement is not uniform across the 12 harnesses.** A `deny` stops something only where
  that harness consumes the verdict. `PreToolUse` is the only event that blocks everywhere;
  `PostToolUse` is observation-only on 10 of 12.

One builtin, `block-failproofai-commands`, is **always on and cannot be disabled** — it
bypasses the enabled set entirely, including during a pause and when the config fails to
parse. That is what stops an agent disabling its own guardrails.

### 5. Verify — do not assume

```bash
command -v failproofai fp agenteye     # which halves exist at all
failproofai config --status            # pause state, connection rows, version triad
failproofai policies                   # what is enabled, in which scope
fp --json whoami                       # cloud session — read the field
```

`config --status` is the single most informative command in the product, and it overrides its
own "connected" line with the delivery-health verdict — trust the rejection row over the
connection row when they disagree:

| Row says | Means |
|---|---|
| `Ingest REJECTED (401/403) — N batches parked` | the key stopped being accepted *after* connecting. Nothing is arriving |
| policy connected, ingest absent | an `events:add`-only or `policies:pull`-only key. Half the machine works |
| daemon `stopped`, or a version different from the CLI | enforcement is **failing closed** |
| paused | enforcement suspended; max 8h, one session |

Then make one real tool call in the target agent CLI and confirm a decision appears in the
local dashboard's Policies → Activity log. An install that has never evaluated a single event
is not a verified install.

**Fail-closed is deliberate.** Once daemon configuration is recorded there is no silent
in-process fallback: an unreachable or version-skewed daemon denies everything, including
`UserPromptSubmit`, so the user cannot even ask their agent what happened. `failproofai
update` is the fix. Recovery beyond that is `failproofai`'s job, not this file's.

The wizard's six steps, the non-interactive path, self-hosting, and what each step writes:
`references/setup.md`.

## The policy lifecycle

The headline capability, and every step of it is CLI-drivable — no dashboard required. Text
anywhere calling deployment, assignment, promotion or rollback "dashboard work" or "not
exposed by the cloud CLI" is out of date, and will stop an agent looking for shipped commands.

    compose  →  test  →  publish  →  fleet deploy  →  guardrails

| Step | Command |
|---|---|
| Draft it from a description | `fp policies compose "block force-push to main"` |
| Prove it decides correctly, offline | `fp policies test ./rule.mjs --command "…"` |
| Mint an immutable version | `fp policies publish <policy-id> ./rule.mjs` |
| Deploy it pinned, in observe, to one machine | `fp fleet deploy <machine-id> --add <policy-id>@3:observe` |
| Read what it would have done | `fp guardrails summary`, `fp guardrails timeline` |
| Promote that machine to enforce | `fp fleet deploy <machine-id> --add <policy-id>@3:enforce` |
| Roll back | `fp fleet rollback <machine-id>` |

Five things that bite:

- **`fp policies publish` deploys nothing.** It mints a new version, never edits one in
  place, and that version sits unused until a `fleet deploy` names it.
- **A bare `--add` on a new policy enforces it.** `:observe` is not the default. Omitting the
  effect is how a first deploy goes straight to enforcement on a live machine. Always write
  the effect; they are exactly `enforce` and `observe`. Ref grammar is
  `id | id@v | id:effect | id@v:effect`, and refs are **not** comma-split.
- **`fp policies compose` needs `policies:write`, not `agent:use`** — backwards from what the
  name implies. A role with only `agent:use` is refused; one with `policies:write` and no
  `agent:use` works. It is session-only.
- **`disable` stops enforcement; `delete` (archive) does not.** Reach for `disable` when the
  goal is to make a policy stop firing.
- **API keys cannot drive any of this** except `policies test`.

`fp policies test` is the cheapest thing in the product: no server, no auth, no fleet, and
nothing installed in the working directory — the CLI shims the `failproofai` module itself.
It wants only `node` on PATH.

```bash
fp policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",…}]}
```

Flags: `--tool` (default `Bash`), `--command`, `--file`, `--event` (default `PreToolUse`),
`--expect`. Source can be a path, `@path`, `-` for stdin, or an interactive paste. The overall
decision is the **strictest** any registered policy returned. State its limit honestly: it
proves the policy parses, registers and decides for the input you handed it, and it **cannot**
prove the daemon feeds it the same context on a real machine. Only `fp guardrails` shows that.

## The skill directory

Seven skills. Three are mirrors, synced from a private repo and marked do-not-hand-edit;
patching them here is a maintenance bug. Two of the three were renamed with the product. The
evaluator was **not** — `agenteye-evaluator` is its real, current name upstream.

| Skill | Owns | Route to it when |
|---|---|---|
| `failproofai` | DOING on a machine | the user has a symptom, a broken install, a daemon that stopped, history to move in |
| **`failproofai-complete`** (this one) | KNOWING | the user wants the product explained, the full surface, or a skill recommendation |
| `failproofai-policy-author` | writing a policy | "agents keep force-pushing" — a complaint, an audit finding, a CLAUDE.md to make real |
| `failproofai-policy-deploy` | shipping a policy | publish a version, deploy in observe, promote, prove it fired, roll back |
| `fp-cloud-cli` *(mirror)* | operating the cloud | browse sessions/events/evals, triage issues and alerts, manage keys, users, settings, queries |
| `failproofai-sdk` *(mirror)* | instrumenting your own agent | a Python/LangChain/CrewAI/LlamaIndex/Pydantic-AI loop that is not one of the 12 CLIs. Module is `failproofai_sdk` |
| `agenteye-evaluator` *(mirror)* | scoring runs | decide what to score, then build the HTTP service the server POSTs transcripts to |

```bash
npx skills add FailproofAI/skills                                  # the whole collection
npx skills add FailproofAI/skills --skill failproofai-complete     # just one
npx skills add FailproofAI/skills --skill failproofai -a codex     # for a specific agent
npx skills add FailproofAI/skills --list                           # what's in the repo
```

Two routes run the other way. **Policy work on an unset-up machine** goes to *Set up a machine
from zero* first — a policy cannot be enforced without an installed CLI and, for cloud policy,
a daemon; the one exception is `fp policies test`. **"My SDK events never appear in the
dashboard"** splits by evidence, not symptom: verify the delivery half (`config --status`,
then `flush --wait`) before sending anyone to the SDK skill, because the bug is usually
delivery, not instrumentation.

If a specialist is not installed, do the job from here and say which skill would have done it
better, with the install line above.

## The docs

`https://docs.befailproof.ai`. Every page has a Markdown twin: **append `.md` to any docs
URL** and you get source instead of rendered HTML.

| Section | Covers |
|---|---|
| `/start/` | quickstart, first audit, first policy, choosing a setup, concepts, per-framework quickstarts |
| `/sessions/` | sessions, live events, reading a trace, models, hooks, policy decisions, tools, errors, evaluations, metrics, dashboards, queries |
| `/audits/` | overview, local audit, setup, agent contracts, run and review, cadence, findings and issues, alerts, recipes |
| `/policies/` | overview, builtins, the builtin catalog, custom policies, local configuration, the editor, deploy, fleet, rollback, failure behavior |
| `/admin/` | usage, keys and permissions, users and organizations, settings and security |
| `/reference/` | harnesses (all 12), the `fp` CLI, `openapi.json` |
| `/api-reference/` | one page per HTTP endpoint, each stating its required grant |

**`llms.txt` is the cheap read path for an agent**, and the two files are not
interchangeable:

| File | Size | Use it to |
|---|---|---|
| `https://docs.befailproof.ai/llms.txt` | small | pick a page. One line per doc, each with a real one-sentence description — not just a title. Read this whole |
| `https://docs.befailproof.ai/llms-full.txt` | ~390 KB | grep a term across the entire corpus. Do **not** read it whole into context |

The rule: read `llms.txt`, pick the page, fetch that page's `.md`. Grep `llms-full.txt` only
when you do not know which page a fact lives on. Note the docs site writes the product as
"Failproof AI" in places; the binaries write **FailproofAI**, and that is the spelling to use.

## Running these tools as an agent

Collected because getting one wrong wastes a turn or hangs the session:

- **Syntax:** `fp` globals go before the command; no `--flag=value` anywhere except `--cli=`,
  `--effect=`, `--out=`, `--email=`.
- **Never exit:** `failproofai audit`, bare `failproofai`. **Need a TTY:** the `config`
  wizard, `policies --install` with no names.
- **Exit codes that lie:** `config --connect` reports only the policy half; `flush --wait`
  exits 0 on an empty spool whether or not delivery works, and exits 1 on timeout, which is
  not a real failure but will kill a `set -e` script; `fp whoami` exits 0 signed out.
- **`backfill` then `flush --wait` back to back is a race** that reports success while
  nothing shipped. `backfill` writes a *request file* the daemon drains on its next tick;
  `flush` exits 0 with "Nothing spooled" the instant the spool is empty. Wait for the tick.
- **Never run on your own initiative:** `config --connect`, `--disconnect`, `uninstall`, a
  user-scope install, or `fp fleet deploy`. Enrollment sends data off the machine and a
  deploy can start denying tool calls on someone else's box. Propose; let the user run it.
- **Never paste real org data into a file.** `fp --json policies list` returns full policy
  source; org slugs, machine ids, user emails and event counts are all live data. Use
  `<org>`, `<machine-id>`, `you@example.com`.

## References

| Load when | File |
|---|---|
| You need a flag, a subcommand, a permission or a JSON shape — either binary | `references/commands.md` |
| You need what a vertical can and cannot answer, and the surfaces behind it | `references/verticals.md` |
| Installing, the wizard's six steps, connecting, provisioning without a TTY, self-hosting | `references/setup.md` |
| Which skill, package, repo or docs page owns a thing | `references/directory.md` |
| Which variable is read by which binary, and where each config file lives | `references/env-vars.md` |
| A name that looks stale — is it safe to rename, and what still reads it | `references/literals.md` |
| "What *is* a finding / trace / deployment / carrier / generation" | `references/glossary.md` |

## Note for maintainers

**The setup spine here duplicates `skills/failproofai/SKILL.md` on purpose.** This skill is the
artifact someone hands an agent standalone, with no sibling installed, and it has to wire a
machine unaided. The duplication is the feature — do not "fix" it with a pointer.

What the two must **not** share is depth. `failproofai` owns the symptom tables, the daemon
internals and the recovery paths; this file stops at the happy path plus the traps that
silently produce a broken install. A paragraph here that starts diagnosing belongs there.
