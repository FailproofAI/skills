---
name: failproofai-policy-author
description: |-
  The way to turn what an agent keeps doing wrong into enforcement — failproofai policies that fire on every tool call. Reach for it on vague phrasing: "my agent keeps force-pushing" — a complaint, not a policy request.

  Trigger when the user wants to:
  • act on an audit — turn `failproofai audit` findings into fixes, or ask which policies work;
  • stop a recurring behaviour — "write a policy that blocks X", or a Jev check;
  • enforce a rules file — make a CLAUDE.md / AGENTS.md real instead of advisory;
  • enable an existing builtin — usually the right answer, checked first;
  • work from FailproofAI Cloud — findings, hooks that fail or over-deny, backtesting a draft.

  Served by the `failproofai` CLI.

  NOT for publishing a finished policy pack to GitHub (`failproofai-policy-publish`); nor Cloud-managed policy versions, fleet rollout, telemetry, or org operations (`fp-cloud-cli`), what to evaluate (`failproofai-eval-brainstorm`), or repo invariants that belong in tests.
---

# failproofai Policies

A failproofai policy is **a small JavaScript function that runs before or after every tool
call** and returns allow, deny, or instruct. It is enforcement, not advice: it fires whether
or not the model remembers to behave. This skill decides what is worth enforcing, then writes
and proves it.

    what went wrong  →  is a builtin enough?  →  author  →  test both ways  →  plug in

Source pointers here are paths inside the failproofai package — under
`node_modules/failproofai/` in an installed project, at the repo root in a checkout. They are
grep anchors, not line numbers, so they survive refactors. Unusually for this collection the
skill does read the source: failproofai's loader conventions and audit detectors are not
documented anywhere else, and a policy that gets them wrong fails silently.

Five ways you get here. All converge on the same authoring core (*The authoring core*).

**1. Automatically, after an audit.** A `PostToolUse` policy fires when `failproofai audit`
runs and instructs the agent to come here. The findings are already sitting in the cache —
**start at *Triage an audit*** and triage them. This is the primary path: the audit knows what went wrong,
so it should not be on the user to notice and ask.

**2. The user describes a problem.** *"My agent keeps force-pushing."* *"It deleted my files
again."* *"How do I stop it committing to main?"* They are reporting a failure, not
requesting a policy — most users do not know policies exist. Translate the complaint into a
rule, then **go to *The authoring core***. Do not make them specify events or tools; infer from the behavior
and confirm at the end.

**3. The user asks for a policy outright.** *"Write a policy that blocks X."* Straight to *The authoring core*.

**4. Findings live in FailproofAI Cloud.** The org runs [FailproofAI Cloud](https://app.befailproof.ai)
and wants its findings enforced — or wants to know which of their policies are actually
working. FailproofAI Cloud sees the whole fleet, so it answers things a local audit cannot: which
hooks are *failing* (and therefore enforcing nothing), and which are denying so often the
rule is probably mis-scoped. ***Sourcing findings from FailproofAI Cloud*** has the procedure.

**5. The user has a rules file agents keep ignoring.** *"Agents keep skipping what's in my
CLAUDE.md."* Prose rules are advisory — the agent reads them (maybe) and forgets them under
context pressure. Policies are enforcement. Extract the rules, classify what is enforceable,
and turn that subset into policies — ***Enforcing a rules file*** has the procedure and the classification table.

For 2, 3, 4 and 5, still check the audit cache if one exists — it often shows the behavior is
already happening and gives you real commands to use as test cases (*Verify it fires*).

The single most common mistake is writing a custom policy when a builtin already covers
the case and just needs enabling. Always check coverage before authoring.

## Establish context before you author

Two things decide what the right answer is, and both are usually knowable without asking.
Settle them first.

### Which path you are on — infer it, do not ask

The five entries above are not a menu to present back. Read what is already in front of you:

| Already in the conversation | Path |
|---|---|
| A `PostToolUse` instruction that sent you here | 1 — findings are already cached; go to *Triage an audit* |
| They named a policy, a finding, or a dashboard row | 1, **single-finding branch** — that one only, not a sweep |
| A past-tense complaint — "keeps", "again", "it deleted my…" | 2 — translate it into a tool call |
| "write a policy that…", an event name, a tool name | 3 |
| `fp` output, an issue id, "our fleet", "in prod" | 4 |
| A path to a CLAUDE.md / AGENTS.md, or "my rules file" | 5 |

If two apply, take the more specific one and say which in a single line. Asking *"which
of these five did you mean?"* spends a turn recovering what the transcript already says.

**Carry forward what they already told you.** Mode, scope and test cases are usually
implied rather than stated — *"it force-pushed to main and I lost work"* has already given
you the mode (`deny()`, work was destroyed), the scope (not just this repo), and the
should-deny case (`git push --force`). Confirm those in the closing report, not in an
opening questionnaire.

The one thing worth asking up front is the one you cannot infer and must not guess:
**whether to change anything outside this repo** (*Never widen scope on your own initiative*).

### Which harness you are authoring for

failproofai supports **12 agent CLIs and they do not enforce the same events.** This is not
a portability footnote — it decides whether the policy you are about to write does anything
at all. A `deny()` the host discards is worse than no policy: the user believes they are
covered. Four live examples:

- **Hermes** fires `PostToolUse` but never reads the verdict — a deny there is observation
  only, and the command still runs. Hermes has **no `Stop` event installed** at all, so a
  Stop policy never even executes.
- **OpenCode's `PermissionRequest` is a dead hook** — declared upstream and documented, but
  never invoked, so the policy does not run.
- **Goose, OpenCode and Antigravity** run `UserPromptSubmit` and throw the verdict away.
- **Hermes and OpenClaw are user-scope only** — no project config exists to scope a rule to.

`references/harnesses.md` is the full matrix — every (CLI, event) pair as **block**,
observe, unverified, or not-installed, with the evidence for each. It is generated from
failproofai's own `ENFORCEMENT_CAPABILITY` table, which exists precisely because this
knowledge lived in prose once and the prose drifted: Hermes `subagent_stop` was documented
as a working gate for months while upstream discarded its return, so every customer policy
on that event enforced nothing. Look it up; do not recall it.

Find out which CLIs are in play. These are the primary binary each integration's
`detectInstalled()` probes (`integrations.ts`, grep `binaryExists`) — note Factory's is
`droid` and Antigravity's is `agy`:

```bash
command -v claude codex copilot cursor-agent opencode pi hermes openclaw droid devin agy goose
failproofai policies --list        # what is enabled — but see the caveat below
```

**`policies --list` reports install state for Claude Code only.**
`hooksInstalledInSettings` (`manager.ts`, grep `hooksInstalledInSettings`) delegates
unconditionally to the Claude integration, so on a Codex- or Hermes-only machine it says
"not installed" while hooks are wired in and firing. Read that CLI's own config file before
repeating the verdict.

If several are installed, the policy must hold on all of them or you state which one it
covers. Authoring for whichever CLI you happen to be running inside, silently, is the bug.

### When failproofai guards your own session

If failproofai's hooks are installed for the CLI you are running in, as on any enrolled
machine, its guard `block-failproofai-commands` judges your own tool calls, and nothing
switches it off (`builtin-policies.ts`, grep `function blockFailproofaiCommands`). It denies:

- **every `failproofai …` command**, however launched (`npx`, a path to its bin,
  `$(failproofai --version)`): `policies --list`, `policies --install`, `policies add`,
  `publish` even with `--dry-run`, `jev status`/`setup`/`test`, `audit`, and the raw
  `npx -y failproofai --hook …`;
- **writing under any `.failproofai` path**, the project's `.failproofai/policies/` and
  `policies-config.json` as much as `~/.failproofai/`: with Write/Edit, or with any shell
  command that is not a plain read (`mkdir`, `cp` into it, `>` onto it, `node … .failproofai/…`).

It allows plain reads (`cat`, `ls`, `tail`, `grep`, `jq`; a `|` inside quotes on such a line,
a `jq` filter's too, reads as a pipe and denies, so write `grep -e a -e b`), copying state
*out* (`node` naming `~/.failproofai` is denied, so the readers below `cp` to `/tmp` first),
every `fp …` command, and `node "$SKILL_DIR/scripts/test-policy.mjs" --policy <file>` for a
file outside `.failproofai`.

So draft and test in a folder of your own (`policy-drafts/`), and end with the operator's half
as one block of exact commands, filled in:

```bash
# the operator's half: failproofai's guard denies these to the agent
cp policy-drafts/block-foo-policies.mjs .failproofai/policies/
failproofai policies --list
```

Add each builtin as its `policies add FailproofAI/policies --policy` line, and for a pack the
`publish --dry-run`, `publish` (or the local install), `policies add` and `jev status` lines
(*Jev*). A `policies-config.json` change goes in your reply as a diff, never as a file you
write, `policy-drafts/` included: `agent-config-tampering`, a no-override Jev check, reads a
written failproofai config as the agent changing its own guardrails and denies from 0.85 (a
drafted `policies-config.json` scored 0.79 live, a warning). A deny reading *"Running failproofai
CLI commands is blocked"* or *"Writing to failproofai's own state…"* is this guard, not Jev
and not your policy. Do not retry it in another spelling; hand it over.

## Audit-driven triage

**One finding, or all of them?** If the user names a single finding — by its policy name
(`git-commit-no-verify`), by description ("the one about `--no-verify`"), or by pointing at
a row in the dashboard — do **not** run the full triage. Handle just that one:

1. Look it up in the cache by name, or by matching its `displayTitle` / `examples[]`
   against what they described.
2. Read its `examples[]`. These are **real commands from their machine** — the single most
   valuable thing the audit gives you. They become the should-fire cases in *Verify it fires* (should-deny
   for a block-mode policy, should-instruct for oversight), which means the finished policy
   is proven against what actually happened rather than against invented input.
3. **Attribute it to a harness** — one command, and it decides whether the rest of this list
   is worth doing at all:

   ```bash
   # $SKILL_DIR is this skill's own folder — the directory you were told to read
   # this file from. Export it once; every node "$SKILL_DIR/…" below then works.
   export SKILL_DIR=/path/to/skills/failproofai-policy-author

   node "$SKILL_DIR/scripts/attribute-findings.mjs" --name <finding>
   ```

   A `DEAD` verdict means the policy cannot fire where the hits came from; stop and say so
   rather than shipping one (*Attribute every finding to a harness*). `PARTIAL` means it
   works on some harnesses only, and the report has to name which.
4. Pick the mode from the finding's severity class (*The authoring core*'s mode table): deny-class findings
   get `deny()`, warn-class get `instruct()` oversight. **State the choice in one line and
   offer the other mode** — "went with oversight since this has legitimate uses; say the
   word for a hard block." The user asked for enforcement; which flavor is their call.
5. Check whether a builtin covers it (*Check the builtins first*). If yes and it is off, that is a config line,
   not a policy.
6. Otherwise author it (*The authoring core*), test against those examples, report back.

Mention what else is unaddressed in one line at the end — do not expand into a full triage
they did not ask for.

Only run the full triage sweep below when they ask broadly: "what should I do about my audit",
"harden this repo", "fix these findings".

### Read the findings

There is **no machine-readable output flag**. `RunAuditOptions` declares `--json`, `--since`,
`--cli`, `--project`, `--limit` and more, and `runAuditCli` reads none of them. It parses six
arguments and no others — `--help`/`-h`, `--scheduled`, `--status`, `--no-schedule`,
`--schedule [days]`, `--email[=<addr>]` — so every declared option above is rejected
(`failproofai audit --json` errors). The six are about scheduling and delivery; **none of
them changes the output format**. The one programmatic path is the dashboard cache, which
every audit run writes:

```bash
cat ~/.failproofai/audit/dashboard.json
```

That is the **layout-4** path (`fp-home.ts`, grep `auditDashboardFile`). Machines that have
not run `failproofai update` since layout 3 still keep it at the old root path, and reading
the wrong one looks exactly like "no audit has ever run" — so fall back before concluding
that:

```bash
cat ~/.failproofai/audit/dashboard.json 2>/dev/null || cat ~/.failproofai/audit-dashboard.json
```

**The cache is the only source, and it can be arbitrarily old.** Check `cachedAt` before
trusting anything in it (from a copy: the guard denies `node` naming `~/.failproofai`):

```bash
cp ~/.failproofai/audit/dashboard.json /tmp/fp-audit.json
node -e 'const j=require("/tmp/fp-audit.json");
const age=(Date.now()-Date.parse(j.cachedAt))/864e5;
console.log(`cached ${j.cachedAt} (${age.toFixed(1)} days ago), ${j.result.results.length} findings`)'
```

More than a day or two old and the findings describe past behavior, not current — say so
rather than presenting it as the live picture.

**Refreshing it is awkward.** `failproofai audit` writes the cache and then starts a
dashboard server on port 8020 and opens a browser, so it never exits on its own. Prefer
asking the user to run it. If you must refresh unattended, the cache is written *before* the
server starts, so a timeout gets you fresh data without leaving a server running:

```bash
timeout 180 failproofai audit >/dev/null 2>&1 || true   # exits 124; cache is written
```

Do that only when the user has asked for fresh findings — it can take minutes on a long
history and it opens a browser tab.

If the file does not exist at all, the user has never run an audit. Ask them to, rather than
running it for them.

**The `AuditResult` is nested under a cache envelope.** The file is
`{schemaVersion, cachedAt, params, result}` — the findings are at **`.result.results[]`**,
not `.results[]`:

```bash
cp ~/.failproofai/audit/dashboard.json /tmp/fp-audit.json
node -e 'const j=require("/tmp/fp-audit.json");
for (const c of j.result.results.sort((a,b)=>b.hits-a.hits))
  console.log([c.name.replace("failproofai/",""),c.source,c.hits,c.projects,c.enabledInConfig].join(" | "))'
```

Each entry in `.result.results[]` is an `AuditCount`. The fields that matter for triage:

| Field | Use |
|---|---|
| `name` | Builtins are **canonical-prefixed** (`failproofai/block-rm-rf`); detectors are bare. Strip the prefix before matching against config |
| `source` | `"builtin"` = a real policy that *would have* fired; `"audit-detector"` = audit-only pattern |
| `hits`, `projects` | How much this actually happens — prioritize by this |
| `examples[]` | **Real payloads the agent actually produced.** These become your test cases |
| `enabledInConfig` | **Do not trust this** — see below. Always `false` for detectors |

**`enabledInConfig` is a stale snapshot.** It records the merged config as it was *at audit
time*, and the cache persists indefinitely — so a config emptied minutes after a run leaves
every finding still claiming `enabledInConfig: true`. Observed exactly that way in practice.

Always re-read the current config before classifying:

```bash
cat ~/.failproofai/policies/packs/installed.json 2>/dev/null  # packs, machine-wide
cat .failproofai/policies-config.json 2>/dev/null          # project scope
cat ~/.failproofai/policies-config.json 2>/dev/null        # global scope
```

With any pack installed, a builtin is on only if the FailproofAI pack's `enabled` list names
it (`null` is all), and `enabledPolicies` is ignored (`references/traps.md` §7). With none,
`enabledPolicies` is a **union** across project, local and global (`hooks-config.ts`, grep
`enabledSet`) — not precedence. A policy is on if *any* scope lists it.

**Scope matters more than it looks.** The audit spans every project on the machine, but a
project-scope config protects only one. If findings span many projects and enforcement lives
in a single project config, the honest conclusion is that most of those hits are still
unprotected — and the fix belongs in the **global** config, not a project one.

### Attribute every finding to a harness before triaging it

**A finding does not say which harness it came from, and that decides whether a policy can
work at all.** The audit scans all 12 CLIs and then aggregates: `AuditCount` carries `hits`,
`projects` and `examples[]` but **no `cli` field** (`src/audit/types.ts`, grep
`interface AuditCount`). So "47 hits" hides the split, and triaging it as one thing produces
policies that enforce nothing on the harness that actually misbehaved.

The attribution survives in the **per-transcript** cache, which the aggregate discarded:
`~/.failproofai/audit/cache/<sha1>.json` holds a `TranscriptAuditResult` with both `cli` and
`hitsByName`. Join them:

```bash
node "$SKILL_DIR/scripts/attribute-findings.mjs"            # all findings
node "$SKILL_DIR/scripts/attribute-findings.mjs" --name git-commit-no-verify
```

It cross-references each finding's events against the capability matrix and returns one of
four verdicts:

| Verdict | Meaning | What to do |
|---|---|---|
| `OK` | every harness with hits can block one of the policy's events | triage normally |
| `PARTIAL` | blocks on some, discarded or absent on others | author it, and **name the harnesses it does not cover**. Never report the finding as fixed |
| `DEAD` | no harness with hits can act on the verdict | **do not write the policy as specified.** Pick a different event, or say the behaviour is not interceptable there |
| `DETECT` | audit-only detector, no builtin behind it | Bucket C — you pick the event yourself, so pick one that blocks where the hits are |

A worked example of the failure this prevents: a `require-push-before-stop` finding whose
hits are all from Hermes reads like ordinary Bucket A work. It is `DEAD` — failproofai
installs **no `Stop` event for Hermes at all**, so the policy would never run. Enabling the
builtin would close the finding and change nothing.

**The tool axis looks like the same trap and is not.** Each harness renames its tools, and
failproofai canonicalizes only what is in that harness's map (*Write tool names in the
canonical vocabulary*). Hermes' `browser_*`, `skill_view`, `cronjob`, `memory`,
`session_search`, `clarify` and `process` are not mapped, so a policy filtering
`ctx.toolName === "Bash"` never sees them.

**But the event still fires, and the tool still reaches you — under its raw name.** Verified
live: a policy matching `browser_open` denies correctly under `--cli hermes`, with `ctx.cli`
set. Canonicalization gates the **builtins**, not interception.

So an unmapped tool is never a dead end — it is a different match:

```js
// ctx.cli scopes it to the harness that emits this name
if (ctx.cli === "hermes" && ctx.toolName === "browser_open") return deny("…");
```

This matters because the opposite conclusion is the intuitive one, and it is the reason
findings on non-Claude harnesses get written off as unfixable. The right answer is almost
always "match the raw name", with only builtin coverage lost. Check the harness's table in
`references/harnesses.md` for what canonicalizes; assume anything absent arrives raw.

### Sort every finding into one of three buckets

Run the attribution above first — a `DEAD` finding is not Bucket A, B or C; it is
"unenforceable on the harness where it happened", and saying so is the correct output.

**Bucket A — a builtin covers it and is off.** Do not write code. Switch it on in the
FailproofAI pack: `failproofai policies add FailproofAI/policies --policy <name>`, after one
plain `policies add FailproofAI/policies` if it is not installed (`--policy` on a first
install enables only the names given). Not `enabledPolicies`: it stops counting once any pack
is installed, and a Jev check of your own needs one (`references/traps.md` §7). This is the cheapest and
most maintainable fix, and it is the right answer for most `source: "builtin"` findings.

**Bucket B — a builtin covers it and is already on.** No action. Report it so the user knows
the finding is historical, not ongoing.

**Bucket C — nothing genuinely covers it.** Author a custom policy (*The authoring core*).

### Do not trust `DETECTOR_TO_POLICY`

`src/audit/findings.ts`, grep `DETECTOR_TO_POLICY` maps every audit-only detector to some builtin, and its own
header comment explains why: so that "every finding looks like it has a failproofai fix."
Several of those mappings do not actually prevent the behavior. Judge coverage yourself:

| Detector | Maps to | Real coverage |
|---|---|---|
| `redundant-cd-cwd` | `warn-repeated-tool-calls` | **None** — unrelated heuristic. Bucket C |
| `prefer-edit-over-sed-awk` | `warn-repeated-tool-calls` | **None**. Bucket C |
| `prefer-edit-over-read-cat` | `block-read-outside-cwd` | **None** for in-cwd reads. Bucket C |
| `prefer-write-over-heredoc` | `block-env-files` | Only the `.env` subset. Bucket C for the rest |
| `find-from-root` | `block-read-outside-cwd` | Partial — that policy is about file reads, not `find` |
| `sleep-polling-loop` | `warn-background-process` | Partial |
| `git-commit-no-verify` | `warn-git-amend` | **None** — different command |
| `reread-after-edit` | `warn-repeated-tool-calls` | Partial — only if params are identical |

So most audit-only detectors are Bucket C. That is the gap this skill exists to fill.

### Present the triage before acting

Show the user the three buckets with hit counts **and the harness split**, then act. A hit
count on its own reads as one number to fix; `47 hits (claude 40, hermes 7 — DEAD on hermes)`
reads as the two different problems it actually is.

For Bucket A, propose the
command rather than running it silently — enabling enforcement changes what their agent is
allowed to do. For a single explicit request ("turn on block-rm-rf"), just run it, or, where
failproofai guards your session, hand the operator the command.

**Never widen scope on your own initiative.** These three are off-limits without the user
asking for them in the current request:

| Action | Why it needs asking |
|---|---|
| `failproofai policies --install` at **user scope** | Wires hooks into *every* project on the machine, not the one they are in |
| Editing `~/.failproofai/policies-config.json` | Global config; a deny there fires everywhere |
| Setting `customPoliciesPath` globally | Silently activates policy files across all projects |
| `failproofai policies add` | Packs, the FailproofAI one included, install machine-wide |

A question — *"what should I do about my findings?"*, *"is this protected?"* — asks for an
answer, not a change. Recommend the machine-wide fix in words and let them decide. Being
right about what should happen is not authorization to make it happen.

Project-scope edits inside the repo the user is working in are fine when they asked for a
fix. The line is **scope**: their repo, yes; their machine, ask first.

## The authoring core

**Arriving from a complaint?** Translate it into a concrete tool call first — a policy can
only match what actually crosses the wire. `references/patterns.md` has a mapping table for
the common complaints (force-push, deletion, secrets, generated files).

If the mapping is not obvious, ask for the command they actually saw, or pull it from the
audit cache — `examples[]` holds real invocations and doubles as your test cases (*Verify it fires*).

Two judgment calls to make before writing, and to state back to the user at the end:

- **Which of the three modes?** failproofai does not only block. Match the builtins:

  | Mode | Helper | Name it | When |
  |---|---|---|---|
  | block | `deny()` | `block-*` | irreversible, no legitimate use |
  | **oversight** | `instruct()` | `warn-*` | risky but sometimes right — *"STOP: … Confirm with the user before executing."* |
  | sanitize | raw deny object (blocks output; `message` inert — references/traps.md §9) | `sanitize-*` | secrets in tool output |

  Default to **oversight** when the action has any legitimate use. Blocking those just gets
  the policy disabled. See `references/patterns.md` for the exact voice the builtins use — copy it.

  Both flavors are harness-dependent. `deny()` only stops something on a **block** pair
  (*Pick an event the harness can actually enforce*), and `instruct()` is properly supported
  only on Claude Code, Devin and Antigravity, plus Hermes through its native plugin (what
  `failproofai config` and `failproofai update` install), where it blocks the first attempt in
  each model response with the instruction and lets the next response's retry through. It
  degrades to a stderr note on Goose, OpenClaw, Pi and Hermes' legacy shell hooks
  (`references/api.md`). Pick the mode, then confirm the pair.
- **Scope.** Project config protects one repo; user scope (`~/.failproofai/policies/`)
  applies everywhere. "My agent keeps doing X" usually means *everywhere*, not *here*.

  On **Hermes and OpenClaw there is no project scope at all** — their config is user-scope
  only, so any rule for them is machine-wide by construction and needs asking for
  (*Never widen scope on your own initiative*). `references/harnesses.md` lists the scopes
  each CLI supports.

### Measure builtin coverage against your real tool surface

`references/builtins.md` says what the 40 builtins catch. It does **not** say whether your
agents call the tools they filter on — and on a real fleet the answer is mostly no.

```bash
node "$SKILL_DIR/scripts/fleet-tool-coverage.mjs"
```

It reads `list tools` from the cloud and cross-references it against every harness's map.
Measured on a live fleet:

    140 distinct tools seen across the fleet.
      16 canonicalize on at least one harness — builtins can match these (11%)
      124 arrive RAW everywhere — no builtin can ever match them

**89% of that fleet's tool surface was outside every builtin's reach**, and not at the
margins: `execute`, `execute_code`, `process` and `computer_use` all run code without being
`Bash`, so `block-sudo`, `block-rm-rf` and `protect-env-vars` are blind to them. So are
`OUTLOOK_SEND_EMAIL`, `OUTLOOK_DELETE_CALENDAR_EVENT`, `mcp_jira_jira_delete_issue`,
`supermemory_forget`, and the whole `browser_*` family.

This changes the default answer to "is a builtin enough?". For anything a fleet reaches
through MCP, a gateway or a browser, it is **no** — and "the builtin is enabled" is not
evidence of coverage unless the tool it filters on is one the agents actually call.

Two hazards the same data exposes:

- **One tool, several spellings.** `mcp__composio__OUTLOOK_GET_MESSAGE` and
  `mcp_composio_OUTLOOK_GET_MESSAGE` are the same tool under two conventions, and
  `composio.GMAIL_*` is a third. Nine tools appeared under more than one name. A regex
  anchored on `mcp__` silently misses the `mcp_` half — match the distinctive middle, not
  the prefix.
- **Tool names are not always clean.** That fleet recorded a whole shell command as a tool
  name (`agentmail inboxes:messages list --inbox-id …`) and one corrupted entry
  (`memor……y_get`). Read the real values before anchoring a pattern on them.

### Check the builtins first

Read `references/builtins.md`. All 40 builtins with their categories, default state, events
and parameters. If one matches, enabling it beats writing a new file every time.

If the complaint is that a builtin is **noisy** — `block-kubectl` denying `kubectl get` — try
its `allowPatterns` param first where it has one: that trades nothing. The other fix is Jev:
the builtins marked *reviewable by* are cleared on the calls Jev judges harmless, once
`FailproofAI/jev-policies` is installed (the npm package ships no Jev checks, so without it
every builtin is hard) and Jev runs in **enforce** mode (*Jev*). The price: an agent with a shell can forge the user's
consent (`claude -p "…"`), and forged consent clears a reviewable deny — failproofai's
`docs/reference/jev-intent.mdx`.

Many builtins take `params` (allowlists, thresholds, protected branches) that go in the
`policyParams` map — a parameterized builtin often covers a case that looks custom.

Then check the project's **existing custom policies** — `ls .failproofai/policies/` and
read their `name`/`description` lines. Coverage is not only builtins: a hand-written policy
may already enforce exactly what you were about to author, and a duplicate means two
policies firing on every matching event.

This check runs **here**, and nothing downstream repeats it. The cloud composer does not
consider builtins and the backtest replays with none loaded (*Backtest it against real fleet
traffic*), so a duplicate scores just as well as an original and then never fires.

### Pick an event the harness can actually enforce

Read `references/api.md` for `PolicyContext`, the decision helpers, and the full event list.

Rules of thumb:
- Blocking an action before it happens → `PreToolUse`
- Redacting or reacting to output → `PostToolUse`
- Gating the end of a turn → `Stop` (but see `references/traps.md` §6 — unsatisfiable Stop gates — before using this in
  this repo)

Then check the event you picked against `references/harnesses.md` for the CLIs in play
(*Which harness you are authoring for*). The rule that falls out of that table:

> **`PreToolUse` is the only event that blocks on every harness that has it.** Every other
> event has at least one CLI where the deny is discarded.

So when a rule can be expressed as a `PreToolUse` gate, express it there. The `PostToolUse`
version of the same rule is real enforcement on Codex and Copilot and inert on the other
ten — and "the tool already ran" is true even where it blocks, because `PostToolUse` at best
replaces the *result* the model reads, never the side effect on disk.

Three outcomes when the lookup says your event does not block:

| Lookup says | Do |
|---|---|
| observe | Move the rule to `PreToolUse` if it can be expressed there. If it genuinely cannot (it needs the output), keep it and **say in the report that it is detection, not prevention** |
| not-installed | The policy never runs on that CLI. Either drop that CLI from the claim or pick a different event |
| unverified (`?`) | Do not round it up to "works". Ship it, and say enforcement is unproven on that harness |

`ctx.cli` (`policy-types.ts`, grep `interface PolicyContext`) carries the CLI id if a rule
must genuinely differ per harness — use it to narrow a rule, never to rescue a discarded
deny. No return value makes an `observe` row enforce.

### Write tool names in the canonical vocabulary

Every CLI has its own names, and failproofai canonicalizes them **before** `fn` runs
(`tool-name-canonicalize.ts`). So you write one policy, once:

- Match `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`.
- Read `command`, `file_path`, `content`, `old_string`, `new_string`, `pattern`.

Matching what the CLI actually sends is the mistake — Hermes' `terminal`, Copilot's
`powershell`, Antigravity's `run_command`, OpenCode's `filePath` never reach your policy
under those names. Per-CLI maps are in `references/harnesses.md`.

The exception is tools with no canonical form: a harness's own tools (Hermes' `browser_*`,
`cronjob`, `memory`, …), MCP tools (`mcp__*`), Skills, and anything a CLI added since the
maps were written. **These are still fully interceptable** — `PreToolUse` fires for every
tool a harness emits, and an unmapped one arrives under its raw name with `ctx.cli` set.
Canonicalization decides whether the *builtins* match, not whether you can see the call.
Match the raw name, scope it with `ctx.cli`, and expect the name to differ per harness.

`fp --json list tools` shows what a fleet actually emits — a policy matching a tool nobody
calls is dead on arrival, and a harness's own tools are exactly where that goes wrong.

### Write the file

Location: `.failproofai/policies/` in the project. Where the guard is on, draft it elsewhere
and hand over the `cp` (*When failproofai guards your own session*).

**The filename must end in `policies.js`, `policies.mjs`, or `policies.ts`.** A file named
`block-foo.mjs` is silently skipped and enforces nothing. Name it `block-foo-policies.mjs`.
This is the highest-frequency failure in the whole system — see `references/traps.md` §1.

See `references/patterns.md` for worked examples per event type.

### Jev: when no string decides it

Some concerns are not in the command. `prisma migrate deploy` is the same string against
localhost and against production; the difference is in `DATABASE_URL`, the branch, or what
the user asked for. A regex that blocks every migration gets disabled, and one that allows
them enforces nothing. **Jev** is failproofai's semantic evaluator: it asks a model yes/no
questions about the call in front of it. The regex always stays the floor.

| The concern turns on… | Write |
|---|---|
| a string in the call — a flag, a path, a tool name | a normal policy. Stop here |
| something a forged "the user asked for it" must never unlock — irreversible actions, privilege escalation, running code fetched from the internet, pushes to protected branches, credential access | a normal policy, **kept hard** even where a matching Jev check exists. failproofai keeps `block-sudo`, `block-curl-pipe-sh` and `block-push-master` hard for this reason |
| a string, but the regex is noisy on legitimate shapes | the regex plus `authority: "reviewable"` and `reviewedBy`, so Jev can clear the harmless calls |
| something no string decides — the target, the intent, whether the user asked | a **semantic check** (`semanticPolicies.add`) shipped in a **pack**, beside a regex floor wherever it must hold without Jev |

Jev reviews only `PreToolUse` and `PermissionRequest` calls the agent made, only where
`~/.failproofai/jev.json` exists and is not `off`, and **only the checks an installed pack
declares**. The npm package ships none (1.0.8+): FailproofAI's 16 are the
`FailproofAI/jev-policies` pack, and a machine with no pack declaring checks never starts a
review at all: no request, nothing cleared, whatever `jev status` says about the provider. Even then it **changes a decision only in
`enforce` mode**: `observe`, which `jev setup` gives you by default, records what Jev would have
done and applies the regex result, and so does every call Jev did not answer (a timeout, a
transport error, a 429, 402 or 5xx, a malformed reply). Everywhere else a reviewable policy is
its hard regex and a semantic check blocks nothing, so anything that must hold everywhere needs
a regex floor. Read `references/traps.md` §10 before writing either.

**Reviewable — let Jev clear a noisy block.** Two fields on the `customPolicies.add` you
already have:

```js
  authority: "reviewable",
  reviewedBy: ["production-infra-change"],   // semantic check names, not policy names
```

Jev clears the verdict only when **every** named check was asked about this call **and none
answered deny** — a warning, an override and "no concern" all count as not deny. So pick the
check by asking **"is there anything left that can deny?"**:

- Its `appliesTo` and precondition must cover every shape the regex fires on: a check never
  asked makes the block permanent. Tools no class knows (every `mcp__*`) are the exception:
  they are asked every check, whatever `appliesTo` says.
- It must model every one of those shapes, and asked is not modelled: a check asked whose
  probes do not all hold answers "no concern", which clears the floor with no warning. So list
  each shape the regex fires on, write its harmful case, and read every reviewer probe against
  it: the probes of the 16 `FailproofAI/jev-policies` checks are in `references/builtins.md`
  *Jev checks in FailproofAI/jev-policies*; your own pack's are in your file. A live floor on `rm`, `>` and
  `git reset --hard`, reviewed by `destructive-deletion`: `echo hi > app.py` answered
  `destroys` 0.91 but `irreplaceable` 0.34, so the unasked overwrite ran silently. That check asks about data that cannot be rebuilt; the floor was
  about any unasked overwrite. Keep a shape no reviewer models in a hard policy of its own,
  and keep a destructive floor hard unless every shape is modelled.
- Once the block clears, something must still be able to deny: a deny-mode reviewer, or a
  deny-mode check asked about the same call on its own (`block-read-outside-cwd` has only the
  instruct `read-outside-workspace`, but `secret-exposure` and `credential-exfiltration` still
  deny the read), or the policy only ever warned. Paired with instruct checks and nothing else,
  a block becomes a warning.
- A deny-mode check still stops denying, and so clears the floor, when an `exempt` probe
  holds and, with `userCanOverride: true`, when its evidence is 0.7 to 0.85 (a warning; it
  denies from 0.85), when the user asked for the operation (allowed) or when Jev judges the
  call a step of the user's task (softened to a warning). The user's request can be forged by
  an agent with a shell. Where the block must hold even then, the reviewer needs
  `userCanOverride: false` (among the jev-policies checks only `credential-exfiltration` and
  `agent-config-tampering`; while any deny-mode check with `false` warns, nothing on that call
  is cleared), or keep the policy hard.

Where `authority` and `reviewedBy` count: a local file honours them; in a pack entry
`failproofai publish` validates them and copies them into the manifest, which is what machines
read; a **cloud-managed policy is always hard** today.

**Semantic — a question set, not code.** No `fn`, no `match`: Jev answers the probes, and
the check fires only when every probe holds (its evidence is the lowest answer). A check that
does not fire answers "no concern", which clears any floor it reviews, so **every probe must be
true for the harmful call**, never for the harmless one. Put the "does it do X" probe first.

Each probe's `instructions` **states the harmful claim**: a sentence true for the harmful call
that says what `criteria.true` says. Never a question, never the harmless case. A push
guard's probe ending "Does the branch name appear verbatim anywhere in `user_said`?", under
`criteria.true` "NOT present", scored 0.45–0.73 live, hovering on the 0.7 fire line. Stated
as below, the same payloads scored 0.04 for the branch the user named and 0.93–0.98 for
branches they never mentioned:

```js
{ id: "branch_not_named",
  instructions: "The branch this command pushes to (the one it names, or `facts.current_git_branch` for a bare `git push`) does not appear anywhere in `user_said`.",
  criteria: { true: "The user never named that branch.", false: "The user named that branch." } }
```

When "the user did not ask" is the concern, make it a probe like that one, after the "does it
do X" probe ("the command pushes commits to a remote"). Do not leave it to `userCanOverride:
true`: that clears a fired check only when Jev scores `op_requested` ≥ 0.8 with `beyond_task`
< 0.5, or `task_step` ≥ 0.8 with `beyond_task` < 0.3 (which drops a warning but only softens a
deny; `decideV1`). Live Jev gave the push the user named explicitly `op_requested` 0.68 and
0.76 and `task_step` 0.56 and 0.69, so a lone "pushes to a remote branch" check warns on the
push that was asked for. The inverted probe fails the other way: "the branch appears in
`user_said`" scored 0.96 on the requested push and 0.04 on an unasked `git push origin main`,
which cleared its floor silently.

```js
import { semanticPolicies } from "failproofai";

semanticPolicies.add({
  name: "db-migration-on-production",   // what a reviewedBy names
  title: "Tried to run a schema migration against a production database",   // past tense
  appliesTo: ["shell"],                  // shell | write | read | network | other
  mode: "deny",                          // blocks at p ≥ 0.85, warns from 0.7; "instruct" only warns
  userCanOverride: true,                 // required; true = the user's request (real or forged) allows it and a task step softens it to a warning; false = neither
  probes: [
    { id: "applies_migration",
      instructions: "The command in `agent_request` APPLIES database schema migrations: `prisma migrate deploy`, `prisma db push`, `knex migrate:latest`, `alembic upgrade`, `rails db:migrate`, `flyway migrate`, `sequelize db:migrate`, or an equivalent, however the binary is spelled or pathed.",
      criteria: { true: "Running it would change a database schema.",
                  false: "It only creates, lists, checks or previews migrations (`migrate dev --create-only`, `status`, `--dry-run`, `alembic history`)." } },
    { id: "production_target",
      instructions: "The database it targets is production or shared, or cannot be told from the command, its flags, or the environment variables set inline on it (`DATABASE_URL=...`, `RAILS_ENV=...`, `--env`).",
      criteria: { true: "Production, shared, or unknown database.",
                  false: "Clearly local or throwaway: localhost, 127.0.0.1, a docker-compose service, a sqlite file, or an env named dev, test or local." } },
  ],
  guidance: "Run migrations against a local or staging database, or hand the command to a human to run against production.",
});
```

**On Hermes, write every probe about the command, never about the user's words.** Hermes
hands failproofai no prompt (`semantic/intent.ts`, `PROMPT_CHANNELS.hermes` is all null), so
`user_said` is always empty there, the task and `user_asked` questions are never asked, and
`userCanOverride` changes nothing. A probe like "the recipient is not named in `user_said`"
is true on every Hermes call and blocks the legitimate ones too. Judge what Jev can see: the
command in `agent_request` and `facts`. Hermes tools no class knows (`execute_code`,
`browser_*`, composio `OUTLOOK_*`, every MCP tool) are asked every check, one Jev request per
call. Name the sender or script outright in the first probe ("`chetak-send.sh` sends a
WhatsApp message"): Jev scored a bare mention 0.78, a warning instead of a deny, and 0.88
once the probe said so.

`precondition` is a **name**, not code — `always`, `protected_branch`, `in_git_repo`,
`has_paths`, `paths_outside_project`, `system_or_root_paths`. Probes should talk about what
Jev is shown: `agent_request`, `user_said`, and `facts` (`cwd`, `project_root`,
`current_git_branch`, `paths[]`). Set `userCanOverride: false` for anything a forged "the user
asked for it" must not unlock, the way `credential-exfiltration` does. A suspected prompt
injection needs no setting: it already turns any check that fired into a deny.

**`semanticPolicies.add` does something only inside a pack.** In `.failproofai/policies/` or
a cloud policy it registers into a list nothing reads; the hook log says so once per file
(`… never asked here`). **An installed pack's checks are the only questions Jev asks**: there
are no built-in ones to join. Several packs' checks are asked together, FailproofAI's first.
So a `reviewedBy` is honoured only for a check some installed pack declares: from a local
file it may name `FailproofAI/jev-policies`' 16 only where that pack is installed (otherwise
the policy stays hard); inside a pack that declares checks, `publish` accepts only its own.
The 16 names are reserved: another pack's check named like one is ignored, never asked. An
observe pack's checks (`publish --effect observe`) are never asked, and a pack added with
`--cli` has its checks asked only for those agents; a policy naming a check that is not asked
stays hard. Every installed pack shares one question budget of 27,591 characters.
`publish` holds a pack not from FailproofAI to the 9,101 left once `jev-policies` (18,490)
is counted, whether or not the author has it installed, so a pack can sit beside it; keep
a pack's questions under about 9k (the example check is 1,601; a two-check pack about
3,000). An entry over the budget on a machine is dropped at load: `failproofai policies add`
names it, and so does the hook log (`was dropped: its questions need`).
`references/patterns.md` has the two-tier entry file. Validate it, then release it:

```bash
failproofai publish db-guard.policies.mjs --dry-run --version 0.1.0   # validates, writes dist-pack/, publishes nothing
failproofai publish db-guard.policies.mjs --repo acme/db-guard --version 0.1.0
```

Always pass `--dry-run` to validate: without it, a publish with no `--repo` takes the
repository from the git origin, if there is one, and releases for real (with neither it is a
dry run). The dry run is the validator: it rejects a bad field, an unknown precondition, an
unknown `reviewedBy` name or a check over the ~9k budget, and prints
`N semantic policies for Jev (… characters of questions), asked by Jev wherever it installs`
and `Requires failproofai 1.0.8-beta.0 or newer`: a pack with checks gets that
`--min-cli-version` by default, since older CLIs cannot read the checks; pass a higher one
if you rely on something newer. Nothing in a pack is on by default: install with
`failproofai policies add <owner>/<repo> --all`, or set `defaultEnabled: true` on the policy.

**Installing a dry-run pack on this machine.** `policies add` takes only `owner/repo[@tag]`
fetched from `$FAILPROOFAI_PACK_BASE_URL/<owner>/<repo>/releases/download/<tag>/` (default
`https://github.com`); a path such as `./dist-pack/…` fails `unsafe owner "."`. So serve
`dist-pack/` as that layout. Name the pack with `--id` (a dry run otherwise calls it
`local/<folder>`) and the tag with `@` (it must be the version, `v` optional):

```bash
failproofai publish db-guard.policies.mjs --dry-run --id acme/db-guard --version 0.1.0
d=/tmp/packs/acme/db-guard/releases/download/0.1.0; mkdir -p $d && cp dist-pack/* $d
python3 -m http.server 8765 -d /tmp/packs &
FAILPROOFAI_PACK_BASE_URL=http://127.0.0.1:8765 failproofai policies add acme/db-guard@0.1.0 --all
# one agent only: append --cli hermes (or claude, codex, …) to scope the pack and its checks
```

The variable redirects every pack fetch, so run `policies add FailproofAI/policies` without it.
Re-publishing a fixed version and re-running `policies add <id>@<new-version>` replaces the
installed one; `failproofai policies remove <id>` uninstalls it and its checks stop being asked
at once.

**Verify both tiers.** `test-policy.mjs --policy` tests the floor alone: it runs in a sandbox
HOME with the legacy evaluator, so no `jev.json` or daemon brings Jev in — test that both ways
as below. Without `--policy` it runs against the real config, where a daemon can still answer
with Jev. Jev's half has no offline test: `failproofai jev test` checks the connection only
and never touches your policies. Roll out in observe mode first — `failproofai jev setup --provider
failproofai --mode observe` (FailproofAI Cloud) or `failproofai jev setup --provider <kind>
--key-stdin --mode observe < key-file` (your own key) — then read:

- `failproofai jev status` — the mode, how many enabled builtin and pack policies are
  reviewable (policies from your own files are not counted), and the last 24 hours' `cleared`
  and `would have cleared (observe)`;
- `~/.failproofai/state/semantic/verdicts.jsonl` — answers keyed `<check>.<probe>`, the only
  proof a probe was asked. For a local file, that and `jevCleared` in
  `~/.failproofai/hook-activity/current.jsonl` are the evidence.

Nothing is cleared and no check blocks until `failproofai jev setup --mode enforce`. Do not
report the semantic tier as live until `jev status` shows `enforce`. Where the guard is on,
`publish`, `policies add`, `jev setup` and `jev status` are the operator's to run; you can
still `tail` both files above.

### Verify it actually fires

Loading and execution are both fail-open — a broken policy is indistinguishable from a
working one unless you test it. Never report a policy as done without this step.

**The fast first pass is `fp policies test`.** No server, no fleet, **no auth** — it executes
the real file against one context you describe and prints what each registered policy
decided. It resolves `import { deny } from "failproofai"` with nothing installed in the
working directory (the CLI shims the module), so it runs in an empty repo. Needs `node` on
PATH. It is also the one `policies` subcommand an API key can drive; every other
`policies` / `fleet` / `guardrails` subcommand exits 2 under one, so CI cannot drive them.

```bash
fp --json policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",…}]}
```

Source may be a path, `@path`, `-` for stdin, or omitted to paste interactively. Its own
options come after the subcommand: `--tool` (default `Bash`), `--command`, `--file`,
`--event` (default `PreToolUse`), `--expect`. `--json` is a **global** and goes before the
command; `fp policies test … --json` is a usage error, exit 2. The JSON is
`{ok, decision, policies[], syntax, expected, met}`, and `decision` is **the strictest any
registered policy returned** — so it carries the same "which policy denied?" ambiguity as the
hook (below).

State its limits rather than letting a green line stand in for enforcement:

- **no `--cli` flag.** Every run is one shape; you cannot run the case as Hermes, Codex or
  Copilot, so it never proves that `terminal` or `powershell` reaches a policy matching `Bash`.
- **no capability check.** It will report `deny` just as happily for an event the target
  harness discards. Nothing is marked INERT.
- **no traffic.** One input at a time, and you chose it. How often the rule would fire
  across a real fleet, and how much of that lands on calls that actually failed, is a
  different question with a different tool (*Backtest it against real fleet traffic*).
- **it cannot prove the daemon feeds the policy the same context.** It proves the file
  parses, registers and decides for the input you typed. That is the whole claim.

So iterate with it — then prove it with the **bundled runner**, which is harness-aware and
stays the thing you run before reporting a policy done. Substitute `$SKILL_DIR` with the path
to this skill's own folder — the directory you were told to read this file from:

```bash
node "$SKILL_DIR/scripts/test-policy.mjs" \
  --policy policy-drafts/my-policies.mjs \
  --event PreToolUse --tool Bash \
  --input '{"command":"sudo rm -rf /tmp/x"}' --expect deny
```

Or a batch, which is what you want once there is more than one rule — `{{cwd}}` in an input
expands to the sandbox path:

```json
[{ "name": "blocks sudo", "event": "PreToolUse", "tool": "Bash",
   "input": {"command":"sudo ls"}, "expect": "deny" },
 { "name": "allows plain ls", "event": "PreToolUse", "tool": "Bash",
   "input": {"command":"ls"}, "expect": "allow" }]
```

```bash
node "$SKILL_DIR/scripts/test-policy.mjs" --policy <file> --cases cases.json
```

**Test as the CLI you are shipping to.** The hook's `--cli` flag **defaults to `claude`**
(`bin/failproofai.mjs`, grep `--cli`), so every test above silently runs as Claude Code —
including the ones you write for a Codex or Hermes shop. `--cli <name>` on the flag form,
or `"cli"` on a case, runs it as that harness instead: the payload takes that CLI's shape
and its tool names go through canonicalization, which is the only way to prove `terminal`
or `powershell` actually reaches a policy matching `Bash`:

```json
[{ "name": "hermes: blocked at the tool gate", "cli": "hermes",
   "event": "PreToolUse", "tool": "terminal",
   "input": {"command":"git commit --no-verify"}, "expect": "deny" }]
```

The runner also checks each should-deny case against the capability table and marks it
**INERT**, **NOT-INSTALLED** or **UNVERIFIED** when the harness will not act on the verdict.
Those still count as PASS — the policy did decide deny — which is exactly why they are
labelled. A green suite is not the claim; *the harness acts on it* is the claim.

With `--policy`, the file is copied into a throwaway directory that acts as both project and
HOME — so `customPoliciesEnabled: false`, the real project config, and user-scope policies
cannot affect the result. It also **renames the file if it violates the loader convention**
(*Write the file*) and says so. Omit `--policy` to test the current directory's real config instead.

Exit code is 1 if any `--expect` fails, so it drops straight into a script.

Underneath it is just the documented stdin protocol, if you need it by hand (a `failproofai`
command, so the operator's where the guard is on):

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"sudo rm -rf /tmp/x"},"session_id":"test","transcript_path":"/dev/null","cwd":"'"$PWD"'"}' \
  | npx -y failproofai --hook PreToolUse
```

(Inside a failproofai source checkout, `node scripts/dev-hook.mjs --hook …` is the
dev-only equivalent — `npx -y failproofai` is what every other project uses. Append
`--cli <name>` to either; without it you are testing as Claude Code.)

**Read stdout, not the exit code.** Both outcomes exit 0:

| Outcome | stdout |
|---|---|
| Denied (`PreToolUse`) | `{"hookSpecificOutput":{…,"permissionDecision":"deny","permissionDecisionReason":"…"}}` |
| Denied (`PermissionRequest`) | `{"hookSpecificOutput":{…,"decision":{"behavior":"deny","message":"…"}}}` |
| Instructed | `{"hookSpecificOutput":{…,"additionalContext":"Instruction from failproofai: …"}}` |
| Allowed | *(empty)* |

**Deny is not one shape.** `PreToolUse` uses `permissionDecision`; `PermissionRequest` uses
`decision.behavior`; `instruct` uses `additionalContext`; the non-Claude CLIs use flat
`{decision:"block"}` or `{permission:"deny"}`, and Factory signals deny by exit code 2 with
the reason on stderr. Grepping for a single key will under-report blocks — this exact
mistake produced a false FAIL during testing. `test-policy.mjs` handles all of them.

To test without touching the project's own config, build a throwaway project directory with
its own `.failproofai/policies/` and `policies-config.json`, and point the payload's `cwd`
at it. Project-scope discovery keys off that `cwd`, so the policy loads in isolation.
`test-policy.mjs --policy` builds that directory for you, and is the form the guard allows.

Test both directions: a payload that **should** be denied, and a near-miss that **should**
be allowed. A policy that denies everything passes the first test.

Two ways this test can lie to you:

- **Empty output proves nothing on its own.** It is the same result whether your policy
  allowed correctly, threw, timed out, or was never loaded. Always pair it with a
  should-deny case that actually produces output.
- **A deny does not prove *your* policy denied.** Every enabled policy sees the event, so
  another one may have fired — a rule matching nothing can hide behind a green suite. Assert
  on text unique to your policy's reason, or test with `enabledPolicies: []`. See
  `references/traps.md` §4; this happens more often than it sounds.

Use the `examples[]` from the audit finding as your should-deny cases — they are real
commands the agent ran, so they prove the policy catches what actually happened.

### Backtest it against real fleet traffic

Both tests above prove the file decides correctly on inputs **you** chose. Neither can tell
you what the rule does to a working day: how often it fires on traffic nobody curated, and
how much of that firing lands on calls that genuinely failed. The **policy backtest**
answers that — it replays a draft against the org's stored fleet events and scores it. Run
it on anything you are about to publish to a fleet: a rule that is correct on two handwritten
cases and fires 262 times across the window — 50 of them on anything real — is not shippable,
and only the replay says so.

**There is no CLI surface.** `fp policies` has eight subcommands — `list show publish enable
disable delete test compose` — and none of them backtests. Do not send the user looking for
one. It lives in the dashboard, at `https://app.befailproof.ai/<org>/policy-editor` (the
older `/<org>/policies` path redirects there, query preserved): paste or compose the `.mjs`
under *publish a version*, pick an agent, a window (24h / 7d / 30d, default 30d) and a sample
(default: everything in the window), then **run backtest**. It needs **`policies:write` and
`events:read` — both**. `policies:write` alone gets 403, because a replay runs caller-supplied
code over stored payloads and hands back whatever the policy returned as its reason. Demo orgs
are refused outright rather than shown a flattering number. `references/cloud.md` has the
procedure, the failure modes, and how to read a result that is measuring less than you asked for.

**Enforceability is judged before precision.** This is the part that changes what you write.
On most integrations a post-call deny is discarded (*Pick an event the harness can actually
enforce*), so a reactive catch can score **100% precision and ship completely inert** — it
fires on exactly the right calls, at a hook that does nothing with the verdict. The judge
therefore checks "did any of these fires land on a hook this integration can block?" **before**
it looks at precision at all, and a draft catching every failure on an observe-only hook comes
back `observe-only`, **not shippable**. The remedy is a `PreToolUse` preflight — predict the
failure from `ctx.toolInput` before the call — **not a deeper reactive catch**; moving the same
rule to `PostToolUseFailure` makes it more inert, not less, because that hook blocks on no
integration at all.

The numbers, and what each one is:

| Number | Counts |
|---|---|
| `fired` | calls the policy acted on |
| `matched` | calls its filter applied to, whatever it then decided — the denominator |
| fired on real failures | fires that landed on a call that genuinely failed |
| hit working calls | fires on calls that succeeded — the number an operator lives with |
| **fires that can block** | of `fired`, how many landed on a (cli, event) pair verified to block |
| precision | `100 × real / fired` |
| fires per catch | `fired / real` — interruptions per prevented failure ("5.2× noise") |

`fires that can block` at **0** with `fired > 0` means inert. Absent is not zero: an older
result that never carried the field is *not verified*, and reading it as inert condemns every
historical replay.

Three runs on the project's own seeded corpus (7542 synthetic events), which is what the three
outcomes look like in practice:

| Draft | fired | on real failures | verdict |
|---|---|---|---|
| preventive rule on a mostly-succeeding tool | 262 | 50 — 19% precision, 5.2× noise | `drowns` |
| post-call catch, correct but inert | 19 | 19 — 100% precision, **0 can block** | `observe-only` |
| `PreToolUse` gate on a wholly-broken tool | 22 | 22 — 100% precision, enforceable | `shippable` |

The verdict vocabulary is closed; these eleven are all of it:

| Verdict | Means |
|---|---|
| `shippable` | fires predominantly on real failures, at a hook that blocks |
| `narrow` | ≥80% precision but <60% recall — publishable, will not cover everything. Say so |
| `drowns` | <80% precision — an operator disables it, and then you have nothing |
| `observe-only` | fires on real failures at a hook this integration cannot block — inert |
| `detects-only` | the model stood by an observe-only draft — deploy it as an alert, not a gate |
| `no-catch` | fired, and hit no real failure |
| `matched-no-fire` | watched the right calls, acted on none — usually the wrong event |
| `never-fires` | matched nothing at all — usually the wrong tool name |
| `unreplayable` | matches only `Stop` / `UserPromptSubmit`, which a tool-call replay never synthesises. The zero is not a verdict on the policy |
| `failed` | the run itself broke — read the failure kind, do not read the zero |
| `empty` | no replayable traffic in the window |

**What a green verdict does not prove.** Three declared gaps, and they decide how much of the
verdict to believe:

- **It has never heard of the builtins.** The composer does not consider them and the replay
  loads none, so a draft that simply duplicates an existing builtin can score `shippable` and
  then never fire in production, because the builtin already decided. **Builtins-first
  (*Check the builtins first*) runs before any backtest, not after it** — a replay cannot tell
  you the rule was already enforced.
- **It measures aim, not outcome.** The recorded agent never reacts: its behaviour is fixed in
  the transcript, so a deny in the replay stopped nothing and everything after it in that
  session still happened. 67% precision does not mean 67% of failures prevented. Say "would
  have fired on", never "would have prevented".
- **A policy that throws still looks like a policy that allowed.** Fail-open is the whole
  system (`references/traps.md` §3) and the replay inherits it — a 2s timeout there is an allow
  too. `evalErrors > 0` on the result is the only place it surfaces; read it before the fire count.

The backtest and an `observe`-mode deployment are complements, not substitutes: the replay
answers *what would this have done to calls already made* in seconds, blind to the agent
reacting; shipping with `effect: observe` answers *what is it doing to calls being made now*,
slowly and exactly. Publishing that finished policy as a reusable GitHub pack belongs to
`failproofai-policy-publish`; Cloud fleet rollout belongs to `fp-cloud-cli`.

### Confirm the policy is actually live — then hand off

The only reliable check is the one you already did in *Verify it fires*: run the hook and
look at stdout. Nothing else proves it.

What genuinely stops a policy from running on **this machine**: the
filename convention (*Write the file*), a load-time throw, `customPoliciesEnabled: false` in
the first scope that sets it (`references/traps.md` §2 — this used to be a no-op and **now
actually disables** convention policies), or hooks not being installed for the CLI at all.
Verify with:

```bash
failproofai policies --list        # the operator's, where the guard is on
```

**That is where this skill stops.** The split is clean, and both halves are shipped work:

| Half | The question it answers | Skill |
|---|---|---|
| author | *what is the rule, and does it decide correctly?* | this one |
| publish | *how does this tested policy become a versioned GitHub pack others can install?* | `failproofai-policy-publish` |
| cloud rollout | *which fleet machines run a Cloud policy version, and what did it block?* | `fp-cloud-cli` |

Everything past a proven local file is the deploy half: minting a version with
`fp policies publish` (which **deploys nothing** on its own, and unlike the dashboard does
not refuse Jev fields: strip `semanticPolicies.add`, `authority` and `reviewedBy` first, since
a cloud policy never reads them), choosing `enforce` vs
`observe`, `fp fleet deploy`, rollback, and reading `fp guardrails` to see the rule fire on
real traffic. Those are shipped commands — if you find yourself about to say deployment is
"dashboard work" or "not exposed by the CLI", that is wrong, and it tells the reader to stop
looking for something that exists. Route GitHub pack publication to
**`failproofai-policy-publish`** and Cloud deployment to **`fp-cloud-cli`** rather than
improvising: `fp fleet deploy --add <policy>` with no `:effect` on the ref defaults to
**enforce**, not observe, which is not a default to discover by experiment.

## Enforcing a rules file (CLAUDE.md / AGENTS.md / system prompts)

Prose rules are advisory: the agent reads them at session start and drops them under
context pressure. Policies fire on every tool call regardless of what the model remembers.
This path converts the enforceable subset of a rules file into policies — and is honest
about the rest.

### Extract

Read the file. Pull out every rule stated as *behavior* — quote each verbatim and note its
section heading. Skip background prose, architecture notes, and anything descriptive.

### Classify

Sort each rule using the classification table in `references/rules-files.md`: hard rules
become a `block-*` deny or a builtin; ordering rules become a PreToolUse gate on the action
they guard; preferences become a `warn-*` nudge; repo invariants belong in the **test suite**,
not a policy; and style or judgment stays prose.

Two classes here are easy to get wrong. Repo invariants ("configs must use the launcher
form") are about file *states*, and policies see tool *calls* — recommend a test, don't
force a policy. And workflow rules enforce best at the **action they gate** (`gh pr create`,
`git commit`), not as Stop gates — tighter feedback, no loop risk (`references/traps.md` §6).

### Check coverage — builtins AND existing custom policies

Rules files are exactly where hand-written policies come from, so the rule you are about to
enforce may already be enforced. Check `references/builtins.md` (with params — *Check the builtins first*), then
read the project's existing custom policies:

```bash
ls .failproofai/policies/ && grep -h -e name: -e description: .failproofai/policies/*policies.mjs
```

A rule already covered goes in the report as covered — writing a duplicate policy means two
policies fire on every matching event forever.

### Present the extraction before enforcing

Show the table — rule → class → action — before writing a batch. Turning a page of prose
into enforcement changes what the user's agents are allowed to do everywhere in the
project; that is a decision they confirm, not a side effect (*Present the triage* discipline).

The table is **not optional and not summarizable into prose**: even when the user
explicitly asked you to enforce the file, your report opens with the table. It is the one
artifact that lets them audit your classification at a glance — prose bullets hide a
misclassified rule; a table row does not.

### Author and verify

Route the uncovered enforceable subset through *The authoring core*. In each generated file, cite provenance
so the policy can be traced back and re-synced when the md changes:

```js
// derived-from: CLAUDE.md § "Workflow rules" — "Never push a branch that is
// missing commits from main" (extracted 2026-07-24)
```

### Report the honest split

End with four lists: **enforced now** (new policies + enabled builtins), **already
covered** (by what), **nudged** (instruct-only), **left as prose** (and why). A rules file
never converts 100%. Claiming it does means something above was misclassified.

Name the harness the "enforced now" list is true for. If more than one CLI is installed and
a rule lands on an event some of them only observe (*Pick an event the harness can actually
enforce*), that rule belongs in a fifth list — **enforced on some harnesses** — with the
CLIs named. "Enforced" with no harness attached is the claim `ENFORCEMENT_CAPABILITY` was
written to stop people making.

## Sourcing findings from FailproofAI Cloud

FailproofAI Cloud is the observability half: failproofai enforces inside the loop, the
cloud records what happened across the whole fleet. Full procedure and verified commands
are in `references/cloud.md` — read it before running anything. The shape:

### Preflight

`fp --json whoami`. **It exits 0 either way** — branch on the `.logged_in` field, never on
the exit code. Logged out it prints `{"logged_in": false, "auth_mode": "none"}`, and **you
cannot fix that** — login needs a code emailed to the user. Ask them to run
`fp login --email you@example.com` and stop. Note the permissions it prints; they decide what
you may do when closing out. Global options go **before** the command: `fp --json whoami`,
not `fp whoami --json` (exit 2).

### Ask all three questions

FailproofAI Cloud answers four different things, and they produce different work:

| Question | Command shape | Produces |
|---|---|---|
| What is enforceable? | `audits findings` → filter `kind == "policy"` | policies to write or builtins to enable |
| What enforcement is **broken**? | `query run` over `hook_completed` where outcome not in (ok, approved) | **hooks failing = enforcing nothing** |
| What is **too strict**? | same, outcome in (denied, blocked) | deny-mode rules that should be oversight |
| What is on the issues board? | `issues list` → branch on `source` | `audit`-born → follow to the finding; `alert` → metric breach, not policy work; `manual` → free text, classify like *Enforcing a rules file* |

`kind: policy` is FailproofAI Cloud's own classification — `improvement` and `failure` findings are
code and instrumentation work, not yours. The issues board is a **human attention queue**,
not a behaviour log: on a live deployment 0 of 11 issues were policy-actionable, because an
alert fires on a number (latency, error rate, score) while a policy gates a tool call. Read
it, classify it, and report what you skipped — do not manufacture enforcement for a metric.

The middle row is the one no local audit can answer. failproofai fails open (`references/traps.md` §3),
so a policy that throws returns allow and nothing surfaces locally. FailproofAI Cloud records every
hook outcome, so a failing hook is a query away — and a hook failing hundreds of times is a
live gap that outranks any new policy you might write. Report it first.

### Get the actual commands

`audits finding <id>` needs the **full UUID** from `--show-id`; the short id in the table is
rejected, despite the CLI docs. Its `evidence.queries` are runnable and often carry the exact
regex. For raw payloads: `events --full --session-id <id>` — `--full` is the only way to get
`payload` and it is expensive, so always bound it to one session.

If an evidence query returns nothing, do not assume the finding is wrong — say in your report
that the policy came from the finding's description rather than observed payloads. That is a
real difference in confidence and the user should know which one they got.

### Turn one issue into an enforceable policy

An issue names a *behaviour*. A policy matches a *tool call*. Getting from one to the other
is four lookups, and **skipping them is how a plausible policy that never fires gets
shipped.** Never infer the tool from the issue title.

```bash
fp --json issues list                       # breach_summary names the session
fp --json events --full --session-id <id>   # the only source of real payloads
```

| Step | Where it comes from | Why it matters |
|---|---|---|
| 1. The **harness** | `payload.agent_id` — `hermes-northwind` → hermes | decides whether the event can block at all |
| 2. The **real tool** | `payload.tool_name` | the issue's wording is not the tool |
| 3. The **input key** | `payload.input` keys | an unmapped tool's keys are raw too |
| 4. **Enforceability** | `references/harnesses.md` for that (harness, event) | a deny on an observe pair changes nothing |

**A worked case, from a real board** (names illustrative). The issue read *"Agent creates
Jira issues in wrong project space (SANDBOX vs ACME)."* That fleet **does** emit
`mcp_jira_jira_create_issue`, so the obvious policy gates that tool. It would never have
fired: the payload shows the write went through **`execute_code`** running a Python
`JiraClient`, on `hermes-northwind`. So the
real shape is `ctx.toolName === "execute_code"`, reading `ctx.toolInput.code` — a **source
string**, with the project key inside it — scoped by `ctx.cli === "hermes"`.
`references/patterns.md` carries the finished policy.

The dashboard will attempt those four lookups for you: open the issue's hand-off link,
`https://app.befailproof.ai/<org>/policy-editor?from_issue=<issue-id>`, and it drafts a policy,
replays it, and redrafts up to twice — about 20–30s, streamed phase by phase. Two things to
know before you trust it. It **first asks whether a policy can address the finding at all**,
and that check rejects a policy-shaped finding roughly half the time when the headline
describes a **cross-call effect** ("retried 14 times", "burned the run budget") — even once
where the finding itself named the `PreToolUse` remedy. That is a framing failure, not a
verdict: restate the finding with the enforceable action in the title and it becomes eligible.
And the redraft rounds do not widen coverage — shown what it missed, a draft gets *less*
precise, not more. Read the verdict, keep the best round, and finish the work by hand.

Two things that bite while reading payloads:

- **Events arrive duplicated.** The same `tool_use` appeared 2–4× per call on a live fleet
  (their own board carries an "event-level 4× ingestion duplication" issue). Dedupe on
  `payload.tool_call_id` before counting anything, or every frequency you quote is inflated.
- **`payload.summary` is often empty** for `tool_use`; the name lives at `payload.tool_name`.

### Author as normal, and test on the real payload

Straight into *The authoring core* — builtins and their params first, then mode, then filename, then test both
directions. FailproofAI Cloud changes where the work comes from, not how a policy is written.

Two calls are worth making first. `fp --json list tools` — a policy matching a tool the fleet
never emits is dead on arrival — and `scripts/fleet-tool-coverage.mjs`, because on a real
fleet only ~11% of the tool surface is builtin-reachable (*Measure builtin coverage*).

**Use the captured payload as the test case.** You already fetched it; feed the real `code` /
`command` string to `test-policy.mjs --cli <harness>` as the should-deny case, and a real
*legitimate* payload from the same session as the should-allow. That is the difference
between "this regex looks right" and "this blocks what actually happened and permits what
actually worked".

**Then backtest it before it goes anywhere near a fleet** (*Backtest it against real fleet
traffic*). You are already working from cloud data, so the corpus this needs exists — and a
policy sourced from one issue is exactly the kind that fires far more widely than the issue
suggested.

### Propose the close-out; do not run it

Print the `issues comment-add` and `audits resolve` commands and let the user run them.
FailproofAI Cloud's confirms **auto-skip on a non-TTY, which is how you run it**, so a wrong id
resolves someone else's finding on a shared board with no prompt — and triage needs
`audits:write`, which a read-only account lacks. See `references/cloud.md`.

