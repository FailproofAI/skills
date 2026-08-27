# Audits

Two systems, one word. They share **no data, no storage, no auth, no schedule and no
binary**. Nothing in `~/.failproofai/audit/` is ever read by the cloud (the scheduled harm
digest is a separate, deliberately minimal payload), and no cloud finding, run or contract is
ever read by `failproofai audit`. A local audit on a connected machine and a cloud audit over
that same machine's sessions can disagree completely and both be correct.

Decide the half in one question: **is the evidence on this disk, or in the org's session
store?** SKILL.md has the comparison table; this file is the depth behind each column.

---

## Half one — `failproofai audit` (local, offline, account-free)

### The whole argument surface

`src/audit/cli.ts`, grep `runAuditCli`. Six accepted invocations, one of them hidden.
Everything else exits 1.

| Invocation | Scans? | Exits? | Notes |
|---|---|---|---|
| `failproofai audit` | yes, everything | **no** | parks on the dashboard until Ctrl+C |
| `audit --schedule [days]` | no | yes | writes config; 1–90, default 7; needs a TTY |
| `audit --no-schedule` | no | yes | sets `audit.auto=false` only |
| `audit --status` | no | yes | read-only; the only view of several silent failures |
| `audit --scheduled` | yes, headless | yes | **hidden**; the daemon's entry point, not yours |
| `audit --help` / `-h` | no | yes | deliberately omits `--scheduled` |

Every branch also rejects *co-occurring* arguments: `audit --status --json` dies with
"`audit --status` takes no other arguments (got: --json)". Dispatch order is `--scheduled`
first, then `--status`, `--no-schedule`, `--schedule`, then the catch-all rejection — the
source comment says outright that a `--schedule` typo must not silently start a 100-second
scan. `--schedule` is the only branch parsing a positional value, and the only place
`--flag=value` works: both `--email x` and `--email=x` are accepted (grep `"--email="`).

**Scan-shaping flags do not exist on the CLI but do exist in the engine.** `since`, `clis`,
`projects`, `policies`, `noCache` are real `RunAuditOptions`, reachable only from the
dashboard's rerun button via `POST /api/audit/run` (`app/api/audit/run/route.ts`, grep
`RunBody`). The CLI hard-codes `const opts: RunAuditOptions = {}`. "Audit just the last 7 days
from the terminal" is not a thing — say so instead of hunting a flag.

### What one bare run does, in order

The order is the gotcha: several behaviours sit on the wrong side of an early exit.

1. Acquire `~/.failproofai/run/audit.lock`; lost → message, exit **75**. Then telemetry.
2. Scan every adapter's history — all CLIs, all time, per-transcript cache on. Print summary.
3. **Zero events scanned → print "no agent sessions found yet." and `process.exit(0)`.** No
   cache write, no browser, no server. Same command, opposite terminal behaviour.
4. Write `~/.failproofai/audit/dashboard.json`. Failure is non-fatal — it prints "couldn't
   save the audit cache; the dashboard may show an empty state."
5. **Release the lock** — before the server starts, not in a `finally`.
6. `openWhenReady()` then `launch("start")`. No `process.exit()`. The shell never returns.

**Exit 75 is not a failure.** `EXIT_AUDIT_ALREADY_RUNNING` (EX_TEMPFAIL) means another audit
holds the lock; `--status` and the daemon both treat 0 and 75 as non-failed, so a wrapper that
treats nonzero as broken misreports a healthy machine. And the lock covers the **scan**, not
the process — leaving the dashboard open all day does not block the next scheduled run.

**The browser always opens**, no opt-out: `open-browser.ts` polls 8020 for 30s and on timeout
opens the URL anyway. `--no-open` and `--port` are both rejected; 8020 is hard-wired.
`launch("start")` also needs a built `.next/standalone/server.js`, so from a source checkout it
exits 1 *after* the scan already ran and cached.

**`audit` is not first-run exempt** (`first-run-gate.ts`, grep `FIRST_RUN_EXEMPT_SUBCOMMANDS` —
only `config`, `policies`, `policy`, `uninstall`, `backfill`), so on an unconfigured machine
with a TTY it can drop the user into the setup wizard before scanning anything. Nor is it
**fully offline, despite the help text**: `audit --help` says "Everything runs on this machine"
while the run posts `cli_audit_started`/`cli_audit_completed` to PostHog, because
`telemetry.enabled` defaults true. Suppress with `FAILPROOFAI_TELEMETRY_DISABLED=1`. The four
progress stages are a **time-driven animation** on an 1100ms timer, not phase events, and
"replaying through 30 builtin policies" is stale — the catalog holds 39.

It replays those 39 **plus** 8 audit-only detectors (`detectors/index.ts`, grep
`AUDIT_DETECTORS`): `redundant-cd-cwd`, `prefer-edit-over-read-cat`, `prefer-edit-over-sed-awk`,
`prefer-write-over-heredoc`, `sleep-polling-loop`, `find-from-root`, `git-commit-no-verify`,
`reread-after-edit`. Detector rows are always `source: "audit-detector"`,
`enabledInConfig: false` — **they only count; they can never be enforced or emailed.**

### On-disk layout (layout 4)

| Path | Anchor | Notes |
|---|---|---|
| `~/.failproofai/audit/dashboard.json` | `fp-home.ts`, grep `auditDashboardFile` | single slot, 0600 |
| `~/.failproofai/audit/cache/<sha1>.json` | grep `auditCacheDir` | per transcript, 30-day TTL |
| `~/.failproofai/audit/schedule.json` | grep `auditScheduleFile` | next-due / last-run / exit |
| `~/.failproofai/audit/session.json` | grep `auditSessionFile` | the digest sign-in |
| `~/.failproofai/audit/machine.json` | grep `auditMachineFile` | class `identity`; survives sign-out |
| `~/.failproofai/run/audit.lock` | `audit-lock.ts`, grep `AUDIT_LOCK_MAX_AGE_MS` | 1-hour stale ceiling |

Source *comments* in `dashboard-cache.ts`, `cache.ts` and `audit_lane.rs` still name the
retired layout-3 paths (`~/.failproofai/audit-dashboard.json`, `~/.failproofai/cache/audit/`,
`~/.failproofai/state/audit-schedule.json`). Grep the `fp-home.ts` exports, not the prose.

Three behaviours that look like bugs and are not. The `/audit` page **silently empties after 7
days** while the file still exists — `readDashboardCache` enforces a TTL while
`readDashboardCacheMeta` deliberately bypasses it so `--status` can still say "last scan N days
ago"; the two surfaces disagree by design. An **empty scan never overwrites** the cache on
either path, so a stale dashboard can mean "the last run found nothing to scan" — e.g. a
service unit whose `HOME` resolves elsewhere — not "nothing ran". And Ctrl+C during a scan
**leaves the lockfile behind**, because the exit hook does not run under the default SIGINT
disposition; it is reclaimed only by the dead-pid rule or the 1-hour ceiling.

Cross-component hazard: the lock's `mkdir` must create `run/` at mode **0700**, because
`failproofaid` refuses to start if `run/` has any other mode — and on a daemon-configured
machine a daemon that will not start denies every tool call on all 12 CLIs.

### Scheduling, consent, and the ways it silently does nothing

`audit.auto` in `~/.failproofai/config.json` is **one switch meaning "scan on a timer AND mail
me"** (`fp-config.ts`, grep `reportsConsentedAt`). There is no scan-locally-on-a-timer option,
and turning it on requires an email-OTP sign-in — so `--schedule` on a non-TTY (CI, cron,
`ssh -T`) fails hard rather than degrading. Turning it on is only config; **the daemon
executes it** (`crates/failproofaid/src/audit_lane.rs`), spawning `<cli> audit --scheduled` via
`sh -c` at nice(19): 60s poll, 15-minute minimum attempt gap, 30-minute child timeout, next-due
persisted *before* the spawn. A laptop asleep past several due times wakes to exactly one scan,
never a catch-up burst — and a crash mid-scan costs that whole interval.

| Silent failure | Symptom | Only visible via | Fix |
|---|---|---|---|
| Upgraded from ≤1.0.0 with `auto=true` | scans forever, mails nothing | `--status`: "digests need a fresh opt-in" | re-run `--schedule` |
| Session expired, or signed out in the dashboard | scans continue, digests stop | `--status`: "digests are paused until you sign in" | sign in again |
| Daemon stopped / not installed | nothing ever runs | `--status` daemon row | `failproofai config` |
| Unit predates `FAILPROOFAI_CLI_CMD` | nothing runs, config says on | the daemon journal, once | `failproofai config` |
| Digest send failed | scheduled run still exits 0 | one stderr line in the journal | — |

Two traps around that table. The stopped-daemon warning after `--schedule` goes to **stderr**
(it vanishes if you pipe stdout) and is **suppressed when daemon status is "unknown"** — the
ordinary state on macOS without a cached sudo credential (grep `warnIfDaemonWontRun`). And a
hand-edited `interval_days` of `0`, a negative, a fraction below one day, or a non-number falls back to the
**default 7** — not to off, not to the 1-day floor (grep `readIntervalDays`); too-large clamps
to 90. Reading `--status`: "last result" is the dashboard-cache timestamp, so it reflects an
audit from *any* source; only "next scan" and "last scheduled" are scheduled-only facts.

### What the digest sends, and what it cannot

Only `reportHarm` inside `runScheduledAudit` ever sends. **An interactive `failproofai audit`
never emails anything** — never tell a user to run it to get their digest. The payload
(`report-harm.ts`, `harm-report.ts`, `machine-store.ts`) is a machine UUID minted only for this
and never the telemetry id, the hostname label, platform, window bounds, and per policy: name,
category, title, hit count, first/last seen, up to 3 redacted 80-char examples.

**Only `deny` and `sanitize` severities plus the hand-added `protect-env-vars` count as harm**
(grep `HARMFUL_SEVERITIES`, `ALSO_HARMFUL`). Every `warn-`/`prefer-`/`require-` policy and all
8 detectors are invisible to the email regardless of hit count — "I got no digest" is not "the
scan found nothing". Counts straddling the window boundary fall back to counting examples
(capped at 3), so digest numbers can undercount. Redaction is explicitly **not a guarantee**
(`redact-example.ts`) — pattern-based masking of secrets and home paths.

`session.json` is shared by the CLI and dashboard sign-in, so signing out in the dashboard ends
the session the scheduled audit reports under. Passing `--email` with a *different* address on
an already-signed-in machine is **refused**, not honoured.

---

## Half two — cloud audits (`fp`, server-side)

A cloud audit is a stored definition that runs on a server cadence over **sessions already
delivered to the org**, and emits findings. `fp` has shipped (`uv tool install fp-cloud-cli`)
and is what to resolve **first** — `command -v fp agenteye`. Everything below was checked
against `fp audits --help` and its subcommands' own help, not against the docs. `agenteye`
0.1.13 is the legacy package: still installable, still runs audits, and where the two differ
it is called out below. Notes elsewhere in this repo describing `fp` as unshipped, or
resolving `agenteye` first, are stale. The chain is SKILL.md's, with a run in it: session →
audit → **run** → finding → issue → policy, branching to an alert where prevention is
impossible.

### Defining and scheduling

`fp audits create NAME` — everything but the name has a server default; a bare create gives
you a **daily, LLM-backed audit over all activity, enabled**, and **queues its first run
immediately**. A name collision is rejected up front with exit 2. The documented "one-time
release investigation" cadence therefore needs an explicit `--disabled`.

| Knob | Bound / default |
|---|---|
| `--file` | full audit JSON to base it on, or `-` for stdin; flags layer on top |
| `--description` / `--enabled`/`--disabled` | free text; starts on unless you say otherwise |
| `--schedule-interval-secs` | 3600–604800, default 86400 |
| `--schedule-anchor` | fixed UTC ISO 8601 slot, default next 09:00 UTC |
| `--window-mode` | `since_last` (default) or `fixed` |
| `--lookback-window-secs` | 3600–7776000, default 604800 |
| `--scope` | JSON: `{"environments":["prod"],"agent_ids":["checkout-agent"]}` |
| `--sensitivity` / `--top-k` | `low`/`medium`/`high`; max findings a run keeps |
| `--llm` / `--no-llm`, `--ignore-error-type`, `--channels` | analysis on by default; excludes repeatable or CSV; channels a JSON array |

`since_last` continues after the last **fully analyzed** window and keeps an unanalysed window
open when analysis was skipped; `fixed` re-inspects a rolling lookback. Run failures do not
move the anchor. `edit` retains unspecified values; `delete` takes findings and run history too.
**The docs' cadence table recommends "Monthly" for governance review — unreachable**: the
interval caps at 604800 (7 days), in the docs and in the binary.

**Reference context ships, and is the surface people still think is missing.** `audits
context-show` / `context-set` / `context-refresh`, and the `--text` / `--text-file` / `--url`
brief options on create, are all present in `fp` and all absent from legacy `agenteye` 0.1.13
— notes calling them documented-but-unshipped were describing `agenteye`, and are true only
there. Two things to get right:

- **Attach context on create.** A new enabled audit is due immediately, so `--text`/`--url` in
  the same request is the only way to be sure the first run has it; a URL the guard refuses
  fails the whole create rather than leaving a half-made audit.
- **On `context-set` each half is independent.** `--text ""` clears the brief, `--clear-urls`
  drops the URL list and its snapshots, and whatever you omit is left alone. Omission used to
  mean "delete" for URLs but "keep" for the brief, so a routine `--text` edit silently threw
  away every reference page — if you meet that behaviour you are on an old build.

The brief caps at 8192 characters. URLs are public `https://` only, up to five, refused for
private, loopback and cloud-metadata addresses, validated on save and fetched in the
background so a slow site never blocks a run.

### Running

`fp audits run NAME` **queues** — success means queued, not finished. A disabled audit, or one
with a run in progress, is refused (exit 1) rather than double-queued. Poll `fp audits runs
NAME` (newest first, server returns the 50 most recent; a still-running row shows `-` for
`took`). Reading findings sooner gives you the previous run's results.

**A zero-finding run has four meanings and only one is "healthy":** analysis ran and found
nothing; model analysis was skipped; it failed; or it is disabled. In the last three the run
still *completes* with zero findings, and the deterministic credential/PII scan still reports
match counts in run statistics without opening any. Check whether model analysis actually ran
before calling the population clean. When it did not run, existing findings are **not**
retired — a skipped analysis is not evidence the failure disappeared.

Saturated capacity does not skip the population: the run stays queued and retries for up to a
quarter of its cadence (capped at six hours), then completes empty with a failure email. That
email uses the audit's recipients, falling back to the org's `alerts.email_default_recipients`;
**if org email or SMTP is not configured the failure is only logged**, so a broken audit can be
entirely invisible.

### Findings and triage

A finding is a stable failure mode carried across runs, with severity, kind (failure vs policy
violation vs improvement), occurrence count, evidence session ids, supporting queries and a
recommendation. `fp audits findings` defaults to `--limit 100` and, with no `--status`,
returns the **live set: open + recurring**.

| Verb | Status after | Suppresses later runs? | Confirms? |
|---|---|---|---|
| `ack` | **unchanged** | no — durable feedback that ranks it lower | no |
| `assign --to <email>` | unchanged (sets owner) | no | no |
| `mute --reason` | `muted` | **yes, durable** by fingerprint | yes (`--yes` skips) |
| `dismiss --reason` | `dismissed` | **yes** — same as mute, different label | yes |
| `resolve` | `resolved` | **no, deliberately** — a recurrence raises as new | yes |
| `reopen` | back in the live queue | clears suppression | — |

`ack` not changing status is what people get wrong: valid `--status` values are `open`,
`recurring`, `resolved`, `dismissed`, `muted` — **there is no `acknowledged` finding status**. (Issues do have an `acknowledged` state;
findings do not.)
Evidence survives dismissal, which is why `--reason` is worth writing. Before deciding, open
the trace: `fp events --session-id <id> --full --all`.

### Issues

The durable workflow object — assignment, comments, subscribers, state, activity timeline. It
also carries alert incidents and manually-opened problems, which is why it lives under audit
response. States are `firing`, `acknowledged`, `resolved`; `source` is `manual`/`alert`/`audit`.
**The CLI still calls them incidents**: every argument is `INCIDENT_ID`, `issues list` prints
"List incidents", the dashboard images are `incidents.png`. Same object. `issues assign`
**replaces** the assignee list; omitting `--assignee` clears it.

Resolving a finding and resolving an issue are different decisions at different times: the
issue when remediation is deployed and verified, the finding when the failure mode is addressed
for the audit population. The *generate a policy from this issue* button is dashboard-only,
and **nothing it drafts is published or deployed automatically**; a "no policy" candidacy
result is a real answer meaning use an alert, a workflow change, or a human. From a draft
onward the CLI does carry the whole lane — `fp policies compose` / `test` / `publish`, then
`fp fleet deploy` — so do not tell anyone the rest is dashboard work. Route authoring to
`failproofai-policy-author` and the publish-and-deploy half to `failproofai-policy-deploy`.

### Alerts

A trigger + an evaluation cadence + channels (email/Slack/webhook); firing opens an issue.
Severities `info`/`warning`/`critical`. Five trigger kinds — `metric_threshold`, `custom_sql`,
`evaluation_score`, `eval_compound`, `per_event` (the alerts doc lists only four; the binary's
`--trigger-kind` help lists five). `--eval-interval-secs` is 30–86400, plus `--min-breaches`
and `--eval-window` (a count of intervals).

**`fp alerts test NAME` really sends** to the configured channels. It confirms first (`--yes`
skips, and so does `--json`), then reports which channels it dispatched to — but the server
calls success at dispatch, so a green result is not proof of delivery. Warn the user before
running it, and test the rule before depending on it for production response.

### Agent contracts

One contract per `agent_id`, stored at **org level, not per audit**. Every model-backed audit
whose scope includes that agent uses it, and **every run stores the exact contract snapshot it
used**, so later edits never rewrite the basis of earlier findings. Body under 5,000 chars,
conventionally **Purpose · Outputs · Done when · Cadence · Must not**.

**There are still no contract commands in either binary** — neither `fp --help` nor
`fp audits --help` carries a `contract` entry, grep `contracts` over the installed
`agenteye_cli` package returns nothing, and the endpoints are absent from
`docs/reference/http-api.mdx`. The only programmatic route is the API, documented solely in
`docs/audits/agent-contracts.mdx`:

```bash
curl -X POST "https://app.befailproof.ai/v1/audits/contracts" \
  -H "Authorization: Bearer $FAILPROOFAI_KEY" -H "Content-Type: application/json" \
  -d '{"agent_id":"nightly-reconciler","enabled":true,"body":"# Purpose\n..."}'
```

`GET /v1/audits/contracts` and `GET .../{id}` need `audits:read`; writes need `audits:write`.
**`PUT` is a full replacement** requiring both `agent_id` and `body` — a partial update
discards what you omit. Delete is API-only and permanent; the dashboard offers pause instead.

A contract that seems ignored is almost always an **`agent_id` mismatch against telemetry** —
check its "last matched" field. Agents with no contract are still audited, just not judged
against org-specific intent. Context states *expected behaviour only*: it cannot tell the
analysis what conclusion to reach or which evidence to examine.

---

## Where the two halves get confused

| Mistake | Reality |
|---|---|
| "Run `failproofai audit` to see my org's findings" | it never touches the cloud; it scans this disk |
| "`fp audits` will show my local audit result" | it never sees `~/.failproofai/audit/` |
| "Scheduling is scheduling" | local = `audit.auto` + this box's daemon; cloud = a server anchor |
| "Findings are findings" | local emits policy/detector *hit counts*; cloud emits findings with ids and triage state |
| "`--since` narrows the scan" | local CLI takes no arguments; cloud uses `--lookback-window-secs` |
| Env prefix | local is `FAILPROOFAI_*`; `fp` is `FP_*` — and `fp` also honours `FAILPROOFAI_HOME`, so the two namespaces are **not** cleanly separated. Only legacy `agenteye` reads `AGENTEYE_*` |
| Flag placement | `fp` globals come **before** the command: `fp --json audits runs <name>`; after it, exit 2 |

**The env prefix follows the binary, and the infix is dropped.** `fp` reads `FP_HOME`,
`FP_JSON`, `FP_TOKEN`, `FP_API_KEY`, `FP_ORG`, `FP_DASHBOARD_URL`, `FP_INSECURE`,
`FP_ANALYTICS_DISABLED` and `FP_CLI_DEV` — plus `FAILPROOFAI_HOME`, which is exactly why the
old "local is `FAILPROOFAI_*`, cloud is `AGENTEYE_*`" split no longer holds. It reads **no**
`AGENTEYE_*` variable at all. Do not derive the names mechanically: a straight `AGENTEYE_` →
`FP_` substitution gives you `FP_CLI_TOKEN` and `FP_CLI_JSON`, which nothing reads. It is
`FP_TOKEN` and `FP_JSON`.

What does **not** move with the binary is the wire and the spool, and `fp` still uses all of
it: the `X-AgentEye-Org` / `X-AgentEye-Client` / `X-AgentEye-Signature` headers, the
`ae_session` cookie, the OpenAPI title "AgentEye API", and the local daemon's `AGENTEYE_HOME`
and `~/.agenteye/events` spool. Those are literals — renaming one breaks the request, not the
branding. `AGENTEYE_KEY` (collector ingest) and `AGENTEYE_API_KEY` (dashboard admin) are two
further credentials again; `FP_API_KEY` was named deliberately not to collide with either, so
never reuse one in place of another. The cloud CLI's own session now lives at
`~/.failproofai/fpcli/cli-auth.json` (mode 0600) — inside the local home, not a second tree.

Unverified here: cloud **run internals** — retry window, capacity behaviour, the deterministic
PII scan, failure-email fallback — come from `docs/audits/run.mdx` and could not be checked
against a server. The contract endpoints were verified only as *documented*; no live call was
made.
