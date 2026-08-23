# Concepts: the nouns and the loop

SKILL.md gives you the loop as a one-line diagram. This file is what each noun is made
of, which half of the product owns it, and where the loop has no command behind it.

## The ten nouns, and which half owns each

`docs/start/concepts.mdx` defines ten terms in one table and never says which product
implements them. That omission causes most concept-level confusion: **four of the ten
have no local implementation at all**, so an offline machine runs only part of the loop.

| Noun | What it is | Local half | Cloud half |
|---|---|---|---|
| Session | one agent task or run | a transcript on disk, browsable | one row per run |
| Event | one recorded action in a session | a hook-activity row | an ingested event |
| Trace | the ordered, nested session view | — | dashboard only |
| Evaluation | one scored judgement of a run | — | `agenteye evals` |
| Audit | a review of a session population | `failproofai audit` | `agenteye audits` |
| Finding | evidence-backed failure an audit found | a report card, no id | a triageable record |
| Issue | the durable response record | — | `agenteye issues` |
| Alert | a rule that detects recurrence | — | `agenteye alerts` |
| Policy | a rule evaluated during activity | 39 builtins + yours | published versions |
| Deployment | a versioned rollout to machines | `active.json` | dashboard only |

### Session

Locally a session is a transcript file grouped **by project folder** (`app/project/`,
grep `getCachedSessionFiles`); in the cloud it is grouped **by agent and environment**.
Same word, two axes. A cloud session can involve **more than one agent**: `--agent-id`
matches if *any* agent in it is the one you named, not just the root. And `agenteye
sessions` needs **`evaluations:read`, not a sessions permission**, because its `status`
column is the session's latest *evaluation* outcome — a session that was never evaluated
shows blank, which is an unscored run, not a failed one.

### Event

Locally an event is a row in the hook-activity store (`hook-activity-store.ts`). It
carries the decision plus the attribution that tells you *which layer* decided:

| Field | Meaning |
|---|---|
| `decision` | `allow` \| `deny` \| `instruct` — the whole vocabulary (`policy-types.ts`) |
| `policySource` | `builtin` \| `custom` \| `convention` \| `cloud` \| `pack` |
| `cloudPolicyId`/`cloudVersion`, `packId`/`packVersion` | which policy, which version |
| `cloudDeployment` | what was deployed here — on **every** row of a managed machine |
| `observed` | what an observe-mode policy would have done |
| `pausedBy` / `pauseExpiresAt` | set only when a session pause was live |

`undefined` means *unknown*, not *builtin* — a row written before a field existed looks
exactly like one where it did not apply. Do not infer absence. `cloudDeployment` is
stamped on every row so you can tell a rollout that **changed no outcomes** from one
that **never arrived**; without it those are identical.

In the cloud the daemon emits hook rows as a **pair** — `hook_triggered` then
`hook_completed` (`transform.rs`, grep `to_events`). `trigger_event` is on the start leg
only, because the server semijoins on `hook_id` and duplicating it would double-count
every hook. `--event-type hook_completed` gets you decisions; `hook_triggered` gets you
attempts. The default feed is **payload-free** (a server-computed `summary`, never raw
content); `--full` hits a heavier endpoint, so bound it with one `--session-id`.

### Trace and Evaluation

There is **no `trace` command on either binary** — none of `agenteye`'s 19 commands is
one. The trace is the dashboard's session view; the CLI approximation is `agenteye events
--session-id <id>`, which gives order but not nesting. An evaluation is one scored
judgement of a run: `agenteye evals --score KEY:MIN..MAX` filters by range (either bound
optional, repeatable, ANDed) and `--aggregate` rolls the set into per-metric stats, worst
average first. Nothing local produces evaluations.

### Audit

The fork is covered in SKILL.md. What it *costs* you is the noun below it: a **local
audit produces no findings you can triage**. Its output is an `AuditCount` row
(`src/audit/types.ts`) — name, source (`builtin` for a replayed policy, `audit-detector`
for an audit-only pattern), hits, projects, first/last seen, examples, `enabledInConfig`.
No id, no status, no assignee. The report renders them as cards called findings
(`src/audit/findings.ts`); they are regenerated wholesale on every scan.

It works by **replay** — synthesising a `PreToolUse` (plus a `PostToolUse` where the
transcript captured a result) per historical event and running the real
`evaluatePolicies` over it (`src/audit/replay.ts`). That is what `enabledInConfig`'s
"already protected" vs "slipping through" split means: what your *current* policy set
would have caught. Two blind spots follow — `Stop`-only workflow policies never fire, and
`warn-repeated-tool-calls` is skipped because it writes a sidecar into your real
transcript directory.

### Finding

A cloud finding is a durable, deduplicated record carried **across runs** — it has
`occurrences` and `last_seen_at`, so a finding is a pattern, not a single hit.

| Facet | Values |
|---|---|
| `status` | `open`, `recurring`, `resolved`, `dismissed`, `muted` |
| `kind` | separates a failure from a policy violation from an improvement |
| default filter | with no `--status`, the server returns the **live set** — open + recurring |
| verbs | `ack` · `mute` · `dismiss` · `resolve` · `reopen` · `assign` |

`ack` is not suppression — an acknowledged finding **stays visible, just deprioritized**.
`mute` and `dismiss` are the suppressing verbs; getting that backwards is how a finding
you meant to hide keeps surfacing.

### Issue

The docs say Issue. **The API, the CLI help and the path arguments all say incident** —
`agenteye issues show` takes `INCIDENT_ID`, and a missing one exits 6. One object, two
names; grep for either.

| Facet | Values |
|---|---|
| `state` | `firing`, `acknowledged`, `resolved` |
| `source` | `manual`, `alert`, `audit` |
| link back | `source_finding_id` (JSON only) |
| severity | `info`, `warning`, `critical`; inherited when opened from an alert |

**The Finding → Issue hop has no CLI command.** `agenteye issues open` accepts
`--alert-id` and nothing else — there is no `--finding-id` — yet `source` includes
`audit` and every issue carries `source_finding_id`. The dashboard makes that hop and the
CLI cannot; do not hunt for the flag. The two also have **separate triage vocabularies
and separate command families**: `audits ack|mute|dismiss|resolve|reopen|assign
<finding-id>` versus `issues ack|assign|resolve <incident-id>`. Whether resolving one
propagates to the other is UNVERIFIED; assume not, and work both queues.

### Alert

A rule that fires when a known condition returns. Trigger kinds: `metric_threshold`,
`custom_sql`, `evaluation_score`, `eval_compound`, `per_event`. Severity `info` /
`warning` / `critical`. Cadence is `--eval-interval-secs` (30–86400) plus
`--min-breaches` within `--eval-window` intervals. Channels: email / Slack / webhook.
`agenteye alerts test <name>` **really sends** to those channels — it is not a dry run.

### Policy and Deployment

A policy is evaluated *during* activity; every other noun in the loop is post-hoc. A
deployment is a monotonically increasing integer naming one immutable set of policy
versions, held in two files under `cloud-policies/` (`fp-home.ts`, grep
`cloudPoliciesDir`): `desired-state.json`, what the server wants this machine to run, and
`active.json`, what is actually live plus the deployment number. That pair is the
machine-side of the dashboard's **assigned vs reported** view. They diverge when the
daemon never pulled, or pulled and *refused* the manifest — an unknown `effect` value or
a SHA256 mismatch fails the whole deployment rather than guess (grep
`failed integrity verification`).

`config --disconnect` removes `active.json` only; the content-addressed artifacts stay,
hash-verified and inert, so a reconnect is cheap and offline-safe. That removal is
load-bearing: before it, disconnecting stopped the *refresh* while every artifact already
on disk **kept enforcing on every tool call** — a user who had left their org went on
being governed indefinitely, with `--status` reporting them unconnected.

## The loop, and where it has no command

    Session  →  Audit  →  Finding  →  Issue  →  Policy       Alert watches for return

| Hop | How it is made |
|---|---|
| Session → Audit | server-side schedule, or `agenteye audits run` — **async**, poll `audits runs` |
| Audit → Finding | automatic, deduplicated across runs |
| Finding → Issue | **dashboard only** — no CLI flag exists |
| Finding → Policy | `failproofai-policy-author`, which reads the local audit cache |
| Policy → Deployment | **dashboard only** — deployment routes are root-only |
| Recurrence → Alert → Issue | `alerts create`, then `issues open --alert-id` |

Alerts sit across the loop's output rather than inside it, watching for a condition to
return after you thought you closed it — and an alert can open an issue directly, which
is why `source` has three values and not two.

## Observe vs enforce — the word covers two unrelated things

1. **Deployment effect** — `enforce | observe` on a cloud-managed or pack policy
   (`cloud-managed-policies.ts`, grep `PolicyEffect`). Observe runs the policy for real,
   records the verdict, and returns `allow` anyway.
2. **Harness enforcement capability** — `block | observe` per harness per event type
   (`enforcement-capability.ts`, grep `EnforcementCapability`). This is what the *agent
   CLI* does with a verdict, and no policy setting changes it.

So a policy deployed in **enforce** mode on a `PostToolUse` event is still
observation-only: the harness discards the verdict. `PreToolUse` is the only event that
blocks across all twelve. Three more things that bite:

- **Absent `effect` means enforce**, deliberately: a manifest written before observe mode
  existed must not silently downgrade a machine to observation.
- **There is no observe mode for a builtin, a `--custom` policy, or a convention
  policy.** Only cloud-managed and pack layers carry `effect` (`handler.ts`, grep
  `observeOnly`). A convention policy enforces the moment it loads. To trial one, deploy
  it as cloud policy or ship it in a pack.
- **Observe records only non-`allow` verdicts.** A row with no `observed` array means
  either "the policy matched nothing" or "it allowed" — you cannot tell those apart.

## Policy layers: five sources, one evaluation

| `policySource` | Activity-log prefix | Comes from | Can be observe | Survives a pause |
|---|---|---|---|---|
| `builtin` | `failproofai/` | the npm package, 39 of them | no | only `alwaysOn` |
| `custom` | `custom` | an explicit `--custom <path>` | no | no |
| `convention` | `.failproofai-<scope>` | a filename in a policies dir | no | no |
| `pack` | `pack/<id>@<version>` | a GitHub release | **yes** | no |
| `cloud` | `cloud/<id>@<version>` | a deployment | **yes** | **yes** |

Counts verified in `policy-catalog.ts`: 39 `name:` entries, 11 `defaultEnabled: true`,
exactly one `alwaysOn: true` — `block-failproofai-commands`.

**A session pause suspends every layer except cloud.** `failproofai config --pause`
defaults to 30 minutes, hard-capped at 8 hours (`session-pause.ts`, grep
`PAUSE_CEILING_MS`) measured from `firstPausedAt` rather than the latest renewal — so
re-pausing every seven hours cannot suspend enforcement forever. Config may lower the
ceiling, never raise it, and expiry is evaluated at read time rather than by a sweeper,
so a stale pause file is inert. Cloud policies and `alwaysOn` enforce throughout.

## Scope: user | project | local

Scope is which agent-CLI settings file the hooks land in, and it changes the **shape** of
the command written, not just its location (`manager.ts`, grep `command_format`):

| Scope | Command written | Committable | Supported by |
|---|---|---|---|
| `user` | absolute binary path | no | all 12 |
| `project` | `npx -y failproofai` | **yes** | 10 of 12 |
| `local` | absolute binary path | no | **`claude` only** |

`--scope local` is accepted by the argument parser and then rejected per-CLI at runtime
(`types.ts`, grep `HOOK_SCOPES`): `claude` is the only harness whose `scopes` array holds
`local`. `hermes` and `openclaw` are `["user"]` — no project config exists for them. The
other nine are `["user", "project"]`. `--scope all` exists on `--uninstall` and **not**
on `--install`. Installing at two scopes causes **duplicate policy evaluation**; the CLI
warns and does not prevent it.

## Machine id vs machine label

The id is the server's key for enrolment, deployment and history; the label is a mutable
display string, free to collide. Resolution order (`cloud-enrollment.ts`, grep
`resolveMachineId`), most explicit first: `--machine-id` → the id in
`credentials.json`'s `cloud` table → `config.json`'s `collector.machine_id` → a fresh
random UUID. **Never the hostname**, whatever `config --help` says.

It reads *two* files because the two capabilities are written under independent
conditions: the cloud credential only when `policies:pull` verified, the collector block
only when `events:add` did. Consulting one alone produced the bug this order exists to
prevent — an ingest-only connect stamps id A on every event; a later policy-capable
connect finds no cloud credential, mints B, and the fleet list shows **one host as two
machines**: A with history and nothing deployed, B enrolled and empty. A then counts
toward `unguarded` on the policy page — the exact false reading that page exists to
surface. The collector's value is returned verbatim, never trimmed, because the daemon
stamps it on events verbatim too.

## Convention policies

Any file in `.failproofai/policies/` (project) or `~/.failproofai/policies/` (user) whose
name matches `/policies\.(js|mjs|ts)$/` auto-loads — no flag, no config entry
(`custom-hooks-loader.ts`, grep `CONVENTION_FILE_RE`). `block-force-push-policies.mjs`
and `block-force-push.policies.mjs` both match; `block-force-push.mjs` does not, and
`.cjs` is never loadable. A near-miss name is **skipped silently and enforces nothing
while looking installed**.
The loader carries a second function, `findSkippedPolicyFiles`, purely to surface those
as a warning — written after this repo shipped `block-version-bumps.mjs` and the guard it
added after a bad version bump had never once run. The loader **does not recurse**, which
is why `cloud-policies/` can sit nested inside `policies/` untouched.

## Policy packs

Policies not compiled into the build, published as a GitHub release: one entry artifact
plus a manifest, verified against the release's `SHA256SUMS` at install and **re-verified
before every import**, so a pack cannot change under the machine after you installed it.

`failproofai pack add <source>` with no tag installs the newest release **and pins it**,
then names the tag it chose. By default you get the pack's own defaults — what its author
marked safe to switch on unattended — not everything it contains; widen with
`--category a,b`, `--only a,b`, or `--all`. Re-adding at a newer version keeps what you
chose rather than switching the rest back on. `FAILPROOFAI_NO_DOWNLOAD=1` refuses to
fetch while already-installed packs keep enforcing. `--only=` and `--category=` are two
of the only three places in the product that accept the `--flag=value` form.

## Two halves, and two finished states

One product — FailproofAI — with a local half and **Failproof AI Cloud** (the service
formerly called AgentEye; the name survives only in env vars, headers and image paths, which
are literals and must not be modernised).

Local-only and cloud-connected are both complete. Local-only gives up the four nouns with
no local column — Trace, Evaluation, Issue, Alert — plus finding triage (local findings
have no id) and fleet Deployment (`active.json` is only ever written by a daemon pulling
from a server). It keeps the whole enforcement path: 39 builtins, packs, convention
policies, hooks across 12 harnesses, and `failproofai audit` over local history.

The npm package ships **two** binaries, `failproofai` and `failproofaid`
(`package.json`, grep `"bin"`), on `node >=20.9.0`. `failproofaid` is a shim; the daemon
it launches is Linux/macOS only, so on Windows every cloud noun above stays unreachable
even after a successful `--connect`. Versions in this checkout: `failproofai`
1.0.2-beta.0 — a **prerelease**; what the `latest` dist-tag gives a fresh
`npm i -g failproofai` is UNVERIFIED — and `agenteye` 0.1.13.
