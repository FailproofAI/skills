# Glossary

The product nouns. Enough to *explain* FailproofAI, not just drive it. Start at *Words that
mean two things* — that section is where the wasted hours actually go.

    Session  →  Audit  →  Finding  →  Issue  →  Policy        Alert watches for the return
    what happened  is it a pattern  what broke  who owns it  stop it recurring

## The record

**Session** — one agent task or run. Locally it is a transcript on disk, grouped by project
folder; in the cloud it is one row, grouped by agent and environment. Same word, two axes. A
cloud session can involve **more than one agent**.

**Event** — one recorded action inside a session: a tool call, a model request or response, a
hook decision, an error, a human intervention. Locally it is a row in the hook-activity store
carrying the decision plus which policy layer produced it; in the cloud it is an ingested
row on a payload-free feed, with a server-computed one-line `summary` rather than the raw
content.

**Agent** — the identity a run is attributed to. In telemetry it is a string (`agent_id`) you
choose and thread through your own code; the dashboard and every filter key off it. A session
carries a root agent plus any others it spawned, and `--agent-id` matches if *any* of them is
the one you named. A contract is written per agent, so a typo'd id is not rejected — it
simply never applies.

**Machine** — one enrolled host. Identified by a **machine id**, a UUID that is the server's
key for enrolment, deployment and history, and displayed by a **label**, which is mutable and
free to collide. The id is never the hostname, whatever `config --help` says; passing
`--machine-id "$(hostname)"` across several boxes silently merges them into one row.

**Org** — the tenant, and the boundary for data, permissions and billing. A user can belong to
several; the active one is chosen at login and saved. Another org's record reads as 404, never
403, so one org cannot probe another's existence.

## The review loop

**Audit** — a review of a defined *population* of sessions, with a stated goal and a cadence,
looking for failure patterns a single trace will not reveal. This word covers two unrelated
commands; see below.

**Finding** — an evidence-backed failure an audit found. In the cloud it is durable and
deduplicated **across runs** (it carries `occurrences` and `last_seen_at`, so a finding is a
pattern, not a hit), with `status` of `open` · `recurring` · `resolved` · `dismissed` ·
`muted` and the verbs `ack` · `mute` · `dismiss` · `resolve` · `reopen` · `assign`. `ack` is
**not** suppression — an acknowledged finding stays visible, just deprioritised; `mute` and
`dismiss` are the suppressing verbs.

**Issue** — the durable response record: who owns this, what was decided, is it closed.
States `firing` · `acknowledged` · `resolved`; sources `manual` · `alert` · `audit`;
severities `info` · `warning` · `critical`. It has its own triage vocabulary, separate from a
finding's.

**Alert** — a rule that fires when a known condition returns, and can open an issue directly.
It sits *across* the loop's output rather than inside it. Testing one really sends to its
channels; it is not a dry run.

## The enforcement chain

**Policy** — a small JavaScript function that runs before or after a tool call and returns
`allow`, `deny` or `instruct`. It is the only noun in the product evaluated *during* activity;
everything else is post-hoc. Five sources feed one evaluation: `builtin` (39 shipped in the
npm package), `custom` (an explicit path), `convention` (a filename in a policies directory),
`pack`, and `cloud`.

**Policy version** — one immutable snapshot of a policy's source. Publishing mints a new
version and **never edits in place**. Publishing also **deploys nothing**: the version sits
unused until a `fleet deploy` names it.

**Deployment** — one applied change to the set of policy versions a machine runs, numbered
monotonically. The number names an immutable set, which is what makes rollback meaningful.

**Effect** — how a deployed policy behaves on a machine: exactly `enforce` or `observe`, per
policy per machine, written in the ref grammar `id@v:effect`. Observe runs the policy for
real, records the verdict, and returns `allow` anyway. **Absent means enforce** — a bare
`--add` on a new policy enforces it, deliberately, so a manifest written before observe mode
existed cannot silently downgrade a machine.

**Carrier** — a machine currently running some version of a given policy. `fp policies publish
--json` returns `carriers` as machine id → the version live there, so you can see what a
publish left behind: a brand-new version and a fleet still on the old one.

**Guardrail** — a policy in its deployed, deciding role, seen from the outcome side:
evaluated and blocked totals, per-policy results over a window. `fp guardrails summary` and
`timeline` are the surface. This is where you find out whether a rollout changed anything.

**Drift** — intent versus delivery. A machine told to run generation N that last pulled M has
drifted. `fp fleet diff --json` computes `drifted` for you. Two different problems hide in
one word: a machine can be in sync and dead, or alive and behind.

**Pack** — policies not compiled into the build, published as a GitHub release: one entry
artifact plus a manifest, verified against the release's `SHA256SUMS` at install and
**re-verified before every import**, so a pack cannot change under a machine after it was
installed. Adding one with no tag installs the newest release and pins it.

## The machinery

**Harness** — the agent CLI a policy runs inside. Twelve are supported: `claude`, `codex`,
`copilot`, `cursor`, `opencode`, `pi`, `hermes`, `openclaw`, `factory` (binary `droid`),
`devin`, `antigravity` (binary `agy`), `goose`. They are not interchangeable — each has its
own settings files, its own scopes, and its own idea of what a verdict means.

**Hook** — the callback a harness invokes at a defined moment (`PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Stop`, …) and the mechanism by which a policy gets to decide anything.
Installed per harness, per scope (`user` · `project` · `local`). **`PreToolUse` is the only
event that blocks across all twelve**; on most harnesses `PostToolUse` is observation-only,
so a policy deployed in *enforce* on a `PostToolUse` event still stops nothing.

**Daemon** — `failproofaid`, a compiled service, one process per OS user, Linux and macOS
only. It exists so hooks are evaluated by one warm process instead of a cold start per tool
call — and once it exists it also pulls cloud-managed policy, collects transcripts, runs
scheduled audits and ships everything. Only the interactive `failproofai config` wizard
installs it. Once it is configured, enforcement **fails closed**: a daemon that cannot answer
denies every tool call on every harness, including `UserPromptSubmit`.

**Spool** — the on-disk queue of batches waiting to be delivered. The sweeper is unhurried on
purpose: batches older than 120 seconds, at most 64 per pass, on a 60-second cadence. `flush`
drops the age and the cap for one pass. Batches rejected with a definitive client status move
to a sibling `failed/` directory that `flush` **does not count** — which is why "Nothing
spooled" can be reported by a machine that is delivering nothing.

## Quality

**Evaluator** — an HTTP service **you own**. When a session finishes, the FailproofAI Cloud
server POSTs the whole transcript to it and you return scores. Nothing is uploaded to
FailproofAI; there is no registry and no plugin system.

**Eval dimension** — one named score an evaluator returns for a session (helpfulness,
groundedness, cost-efficiency, whatever you decide). The hard part of evaluation is choosing
two to four of these that actually mean something to the user; a written plan naming them,
with no code behind it, is a legitimate finished deliverable.

**Evaluation** — one scored judgement of one run: the dimensions an evaluator returned, plus
an outcome. A session's `status` column is its latest *evaluation* outcome, so a session that
was never evaluated shows blank — an unscored run, not a failed one.

## Words that mean two things

This is the section to read twice.

| Word | Sense 1 | Sense 2 |
|---|---|---|
| **Audit** | `failproofai audit` — scans **this machine's own** agent history, offline, no account. Produces report cards with no ids you can triage | `fp audits` / the dashboard — scans sessions **already delivered to the cloud**. Produces durable, assignable findings |
| **Observe** | a **deployment effect**: run the policy for real, record the verdict, return `allow` anyway. Applies to cloud and pack policies only | a **harness capability**: what the agent CLI does with a verdict, per event type. No policy setting changes it |
| **Event** | locally, a hook-activity row with a decision and its attribution | in the cloud, the daemon emits each hook as a **pair** — `hook_triggered` then `hook_completed`. Filter on `hook_completed` for decisions, `hook_triggered` for attempts |
| **Agent** | the AI doing the work | the identity string events are attributed to, and the thing a contract is written against |
| **Issue** | what the docs, the dashboard and this glossary call it | what the API, the CLI help and the path arguments call **incident** — `fp issues show` takes an `INCIDENT_ID`. One object, two names; grep for both |
| **Finding** | in the cloud, a triageable record with an id, a status and an assignee | locally, a regenerated report card with none of those. A local finding cannot be assigned because it does not exist between scans |
| **Machine id / label** | the id: a UUID, the server's key, stable, never the hostname | the label: a display string, mutable, free to collide |

Three more that are not synonyms, however they read:

- **Publishing is not deploying.** `fp policies publish` mints a version; `fp fleet deploy`
  puts it on machines. Two acts, two commands.
- **`disable` stops enforcement; `delete` (archive) does not.** If you want a policy to stop
  deciding, disable it.
- **Local-only is not half-installed.** A machine with hooks, policies and a daemon and no
  cloud connection is a complete, supported end state. What it gives up is the four nouns
  with no local implementation — trace, evaluation, issue, alert — plus finding triage and
  the whole publish → deploy → guardrails lifecycle.
