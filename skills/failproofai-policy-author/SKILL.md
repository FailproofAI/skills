---
name: failproofai-policy-author
description: |-
  The way to turn what an agent keeps doing wrong into enforcement — failproofai policies that fire on every tool call. Reach for it on vague phrasing: "my agent keeps force-pushing", "it deleted my files again" — a complaint, not a policy request.

  Trigger when the user wants to:
  • act on an audit — turn `failproofai audit` findings into fixes, or ask which policies actually work;
  • stop a recurring behaviour, in plain words or as "write a policy that blocks X";
  • enforce a rules file — make a CLAUDE.md / AGENTS.md real instead of advisory;
  • enable an existing builtin — usually the right answer, checked before authoring;
  • work from Failproof AI Cloud — findings, plus which hooks fail or over-deny.

  Served by the `failproofai` CLI and the policy files it loads.

  NOT for reading telemetry or operating Failproof AI Cloud (that's `agenteye-cli`), designing evaluator scoring logic (`agenteye-evaluator`), fixing the bug an agent introduced, or repo invariants that belong in tests.
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

**4. Findings live in Failproof AI Cloud.** The org runs [Failproof AI Cloud](https://app.befailproof.ai)
and wants its findings enforced — or wants to know which of their policies are actually
working. Failproof AI Cloud sees the whole fleet, so it answers things a local audit cannot: which
hooks are *failing* (and therefore enforcing nothing), and which are denying so often the
rule is probably mis-scoped. ***Sourcing findings from Failproof AI Cloud*** has the procedure.

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
| `agenteye` output, an issue id, "our fleet", "in prod" | 4 |
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

Only run the full the full triage below sweep when they ask broadly: "what should I do about my audit",
"harden this repo", "fix these findings".

### Read the findings

There is **no machine-readable output flag**. `RunAuditOptions` declares `--json`, `--since`,
`--cli`, `--project`, `--limit` and more, but `runAuditCli` parses only `--help` — every
other argument is rejected outright (`failproofai audit --json` errors). The one programmatic
path is the dashboard cache, which every audit run writes:

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
trusting anything in it:

```bash
node -e 'const j=require(process.env.HOME+"/.failproofai/audit/dashboard.json");
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
node -e 'const j=require(process.env.HOME+"/.failproofai/audit/dashboard.json");
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
cat .failproofai/policies-config.json 2>/dev/null          # project scope
cat ~/.failproofai/policies-config.json 2>/dev/null        # global scope
```

`enabledPolicies` is a **union** across project, local and global
(`hooks-config.ts`, grep `enabledSet`) — not precedence. A policy is on if *any* scope lists it.

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

**The tool axis has the same trap.** Each harness renames its tools, and failproofai
canonicalizes only what is in that harness's map (*Write tool names in the canonical
vocabulary*). A tool outside the map arrives under its **raw** name — Hermes' `browser_*`,
`skill_view`, `cronjob`, `memory`, `session_search`, `clarify` and `process` are not mapped,
so a policy filtering `ctx.toolName === "Bash"` never sees them even though `PreToolUse`
fires. When a finding's hits come from a non-Claude harness, check that harness's table in
`references/harnesses.md` before choosing what to match on.

### Sort every finding into one of three buckets

Run the attribution above first — a `DEAD` finding is not Bucket A, B or C; it is
"unenforceable on the harness where it happened", and saying so is the correct output.

**Bucket A — a builtin covers it and is off.** Do not write code. Add the short name to
`enabledPolicies` in `.failproofai/policies-config.json`. This is the cheapest and most
maintainable fix, and it is the right answer for most `source: "builtin"` findings.

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
config diff rather than silently editing — enabling enforcement changes what their agent is
allowed to do. For a single explicit request ("turn on block-rm-rf"), just edit it.

**Never widen scope on your own initiative.** These three are off-limits without the user
asking for them in the current request:

| Action | Why it needs asking |
|---|---|
| `failproofai policies --install` at **user scope** | Wires hooks into *every* project on the machine, not the one they are in |
| Editing `~/.failproofai/policies-config.json` | Global config; a deny there fires everywhere |
| Setting `customPoliciesPath` globally | Silently activates policy files across all projects |

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
  only on Claude Code, Devin and Antigravity — it degrades to a stderr note on Hermes,
  Goose, OpenClaw and Pi (`references/api.md`). Pick the mode, then confirm the pair.
- **Scope.** Project config protects one repo; user scope (`~/.failproofai/policies/`)
  applies everywhere. "My agent keeps doing X" usually means *everywhere*, not *here*.

  On **Hermes and OpenClaw there is no project scope at all** — their config is user-scope
  only, so any rule for them is machine-wide by construction and needs asking for
  (*Never widen scope on your own initiative*). `references/harnesses.md` lists the scopes
  each CLI supports.

### Check the builtins first

Read `references/builtins.md`. All 39 builtins with their categories, default state, events
and parameters. If one matches, enabling it beats writing a new file every time.

Many builtins take `params` (allowlists, thresholds, protected branches) that go in the
`policyParams` map — a parameterized builtin often covers a case that looks custom.

Then check the project's **existing custom policies** — `ls .failproofai/policies/` and
read their `name`/`description` lines. Coverage is not only builtins: a hand-written policy
may already enforce exactly what you were about to author, and a duplicate means two
policies firing on every matching event.

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

The exception is tools with no canonical form: MCP tools (`mcp__*`), Skills, and anything a
CLI added since the maps were written. Those pass through unmapped, so match them by raw
name and expect the name to differ per CLI. `agenteye list tools` shows what a fleet
actually emits — a policy matching a tool nobody calls is dead on arrival.

### Write the file

Location: `.failproofai/policies/` in the project.

**The filename must end in `policies.js`, `policies.mjs`, or `policies.ts`.** A file named
`block-foo.mjs` is silently skipped and enforces nothing. Name it `block-foo-policies.mjs`.
This is the highest-frequency failure in the whole system — see `references/traps.md` §1.

See `references/patterns.md` for worked examples per event type.

### Verify it actually fires

Loading and execution are both fail-open — a broken policy is indistinguishable from a
working one unless you test it. Never report a policy as done without this step.

Use the bundled runner. Substitute `$SKILL_DIR` with the path to this skill's own folder —
the directory you were told to read this file from:

```bash
node "$SKILL_DIR/scripts/test-policy.mjs" \
  --policy .failproofai/policies/my-policies.mjs \
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

Underneath it is just the documented stdin protocol, if you need it by hand:

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

Test both directions: a payload that **should** be denied, and a near-miss that **should**
be allowed. A policy that denies everything passes the first test.

Two ways this test can lie to you:

- **Empty output proves nothing on its own.** It is the same result whether your policy
  allowed correctly, threw, timed out, or was never loaded. Always pair it with a
  should-deny case that actually produces output.
- **A deny does not prove *your* policy denied.** Every enabled policy sees the event, so
  another one may have fired — a rule matching nothing can hide behind a green suite. Assert
  on text unique to your policy's reason, or test with `enabledPolicies: []`. See
  `references/traps.md` *Sourcing findings from Failproof AI Cloud*; this happens more often than it sounds.

Use the `examples[]` from the audit finding as your should-deny cases — they are real
commands the agent ran, so they prove the policy catches what actually happened.

### Confirm the policy is actually live

The only reliable check is the one you already did in *Verify it fires*: run the hook and
look at stdout. Nothing else proves it.

What genuinely stops a policy from running: the filename convention (*Write the file*), a
load-time throw, `customPoliciesEnabled: false` in the first scope that sets it
(`references/traps.md` §2 — this used to be a no-op and **now actually disables** convention
policies), or hooks not being installed for the CLI at all. Verify with:

```bash
failproofai policies --list
```

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
ls .failproofai/policies/ && grep -h "name:\|description:" .failproofai/policies/*policies.mjs
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

## Sourcing findings from Failproof AI Cloud

Failproof AI Cloud is the observability half: failproofai enforces inside the loop, the
cloud records what happened across the whole fleet. Full procedure and verified commands
are in `references/cloud.md` — read it before running anything. The shape:

### Preflight

`agenteye whoami`. Exit 4 means not logged in, and **you cannot fix that** — login needs a
code emailed to the user. Ask them to run `agenteye login --email <them>` and stop. Note the
permissions it prints; they decide what you may do when closing out. Pass `--json` to every command.

### Ask all three questions

Failproof AI Cloud answers four different things, and they produce different work:

| Question | Command shape | Produces |
|---|---|---|
| What is enforceable? | `audits findings` → filter `kind == "policy"` | policies to write or builtins to enable |
| What enforcement is **broken**? | `query run` over `hook_completed` where outcome not in (ok, approved) | **hooks failing = enforcing nothing** |
| What is **too strict**? | same, outcome in (denied, blocked) | deny-mode rules that should be oversight |
| What is on the issues board? | `issues list` → branch on `source` | `audit`-born → follow to the finding; `alert` → metric breach, not policy work; `manual` → free text, classify like *Enforcing a rules file* |

`kind: policy` is Failproof AI Cloud's own classification — `improvement` and `failure` findings are
code and instrumentation work, not yours. The issues board is a **human attention queue**,
not a behaviour log: on a live deployment 0 of 11 issues were policy-actionable, because an
alert fires on a number (latency, error rate, score) while a policy gates a tool call. Read
it, classify it, and report what you skipped — do not manufacture enforcement for a metric.

The middle row is the one no local audit can answer. failproofai fails open (`references/traps.md` *Enforcing a rules file*),
so a policy that throws returns allow and nothing surfaces locally. Failproof AI Cloud records every
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

### Author as normal

Straight into *The authoring core* — builtins and their params first, then mode, then filename, then test both
directions. Failproof AI Cloud changes where the work comes from, not how a policy is written.
`agenteye list tools` is worth one call: a policy matching a tool the fleet never emits is
dead on arrival.

### Propose the close-out; do not run it

Print the `issues comment-add` and `audits resolve` commands and let the user run them.
Failproof AI Cloud's confirms **auto-skip on a non-TTY, which is how you run it**, so a wrong id
resolves someone else's finding on a shared board with no prompt — and triage needs
`audits:write`, which a read-only account lacks. See `references/cloud.md`.

