# Jev: semantic checks and reviewable policies

## Contents

1. [When to reach for Jev](#1-when-to-reach-for-jev)
2. [The two tiers](#2-the-two-tiers)
3. [Reviewable: letting Jev clear a regex deny](#3-reviewable-letting-jev-clear-a-regex-deny)
4. [Semantic checks: the shape](#4-semantic-checks-the-shape)
5. [Writing probes that fire on the harm](#5-writing-probes-that-fire-on-the-harm)
6. [A complete two-tier pack entry](#6-a-complete-two-tier-pack-entry)
7. [Where Jev fields count](#7-where-jev-fields-count)
8. [Packs: joining, reserved names, the question budget](#8-packs-joining-reserved-names-the-question-budget)
9. [Test it locally](#9-test-it-locally)
10. [The 16 built-in checks, and which builtins they review](#10-the-16-built-in-checks-and-which-builtins-they-review)

Needs failproofai **1.0.8-beta.0** or later. Source pointers are paths inside the failproofai
package (`node_modules/failproofai/` or a checkout's root); they are grep anchors. The
customer-facing pages are `docs/policies/authority.mdx`, `jev-byok.mdx`, `jev-cloud.mdx`,
`publish-a-pack.mdx` and `docs/reference/policy-sdk.mdx` (*Jev checks*).

## 1. When to reach for Jev

A regex policy matches strings. Some concerns are not in the string:

| The same command… | …is fine when | …is the incident when |
|---|---|---|
| `rm -rf build/` vs `rm -rf ~` | the user asked to clean the build | it slipped into a plan nobody asked for |
| `prisma migrate deploy` | `DATABASE_URL` points at localhost | it points at production |
| `kubectl get pods` vs `kubectl delete` | it only reads | it mutates a live cluster |
| `cat .env.example` vs `cat .env` | it is a template | it prints real keys into the agent's context |

A regex that blocks every such call gets disabled; one that allows them enforces nothing.
**Jev** (TypeSafe's classifier) answers typed yes/no questions about the call in front of
it, against what the human actually typed. Reach for it when the decision turns on the
target, the intent, or whether the user asked, not on a flag or a path.

| The concern turns on… | Write |
|---|---|
| a string in the call (a flag, a path, a tool name) | a normal policy. Stop here |
| something a forged "the user asked for it" must never unlock: privilege escalation, code fetched from the internet, a push to a protected branch | a normal policy, **kept hard**. failproofai keeps `block-sudo`, `block-curl-pipe-sh` and `block-push-master` hard for this reason (`docs/policies/authority.mdx`) |
| a string, but the regex is noisy on legitimate shapes | the regex, marked `authority: "reviewable"` with `reviewedBy`, so Jev can clear the harmless calls (§3) |
| something no string decides | a **semantic check** (`semanticPolicies.add`) shipped in a **pack**, beside a regex floor wherever the rule must hold without Jev (§4–§6) |

A noisy **builtin** is usually a parameter first: `block-kubectl` and friends take
`allowPatterns`, `block-rm-rf` and `block-read-outside-cwd` take `allowPaths`
(`builtins.md`). That trades nothing. Reviewability trades something (§3).

## 2. The two tiers

The regex tier is the floor. Jev judges above it, never instead of it
(`src/hooks/semantic/combine.ts`, header table):

- **A hard deny is final.** Every policy is hard unless it says otherwise. A hard deny stops
  the call without waiting for Jev.
- **Jev can deny or instruct on its own**, through a check that fires, for harm no regex
  describes.
- **Jev can clear**, but only the deny or instruction of a policy marked **reviewable**, and
  only through the checks that policy names (§3).
- **Jev failing is the regex result.** A timeout, a rate limit, a 402/5xx, a malformed
  reply, or a Jev version other than 1.13 falls back to the regex verdict for that call
  (`docs/policies/jev-byok.mdx`, *When Jev cannot answer*). So a concern with **no** regex
  floor is allowed whenever Jev does not answer.
- **Jev reads only gate events**: `PreToolUse` and `PermissionRequest`
  (`src/hooks/handler.ts`, grep `JEV_GATE_EVENTS`). A reviewable `PostToolUse` or `Stop`
  policy behaves as hard.
- **Nothing happens without a Jev config.** No `~/.failproofai/jev.json`, or `mode: "off"`,
  and hooks run the regex policies exactly as before. In `shadow` mode Jev is asked and
  recorded but the regex result applies. Only **`enforce`** changes a decision.
- **A partial picture withdraws clears, never adds them.** A call too big to send whole
  (`request-cut`) or a suspected prompt injection keeps every regex deny; Jev's own deny
  still applies (`combine.ts`, *One rule about a partial picture*).

Known tools with no side effects (`TodoWrite`, `Task`, `Skill`, …) are never sent to Jev.
A tool no class recognises, which includes every `mcp__*` tool, is asked **every** check
whatever its `appliesTo` says (`src/hooks/semantic/compile.ts`, grep `selectPolicies`).

## 3. Reviewable: letting Jev clear a regex deny

Two fields on the `customPolicies.add` you already have (`src/hooks/policy-types.ts`, grep
`interface CustomHook`):

```js
  authority: "reviewable",                     // absent or "hard" = hard
  reviewedBy: ["production-infra-change"],     // semantic CHECK names, not policy names
```

**The rule** (`docs/policies/authority.mdx`; `combine.ts`, *A check that fired without
consent keeps the floor*): the verdict is cleared only when **every** named check was
asked about this call and each one either found nothing, or recorded the user asking for
it, or had its deny softened to a warning because the call is a step of the user's task.
Then:

- a check that was **not asked** (its `appliesTo` or precondition did not select it, or the
  name is misspelled) keeps the block, permanently for that shape;
- a check that **fired** without the user asking keeps the block, even when it only warned;
- a **deny-mode** check that warned without consent withdraws **every** clear on that call;
- an unknown name, an empty or malformed `reviewedBy`, or `alwaysOn` makes the whole
  declaration hard.

**Why reviewable is dangerous.** The rule is not "can the reviewer keep this block". It is
**"once this block clears, is there anything left that can deny?"** Three ways it goes
quietly wrong:

1. **Asked is not modelled.** A check that is asked and does not fire answers "no
   concern", and no concern **clears**. Pair a floor with a check that does not model every
   shape the regex fires on and you have switched the policy off for exactly those shapes,
   with no warning. `warn-git-clean` stays hard for this reason: `git clean` names no path,
   so `destructive-deletion`'s `irreplaceable` probe has nothing to judge and answers low.
   List every shape the regex fires on, write the harmful case of each, and read every probe
   of every reviewer against it.
2. **Nothing left that can deny.** An `instruct` check can never answer deny. Paired with
   instruct checks and nothing else, a block becomes a warning at best, and before a tool
   call a warning does not stop the agent. `block-work-on-main` stays hard because its only
   matching check, `commit-on-protected-branch`, is instruct-only. The block survives a clear
   only if a deny-mode check still covers the call: the reviewer itself, or another deny-mode
   check asked about the same call on its own.
3. **Consent can be forged.** With `userCanOverride: true`, the user asking for the operation
   clears a fired check, and "a step of the user's task" softens its deny to a warning. An
   agent with a shell can make a harness submit a prompt (`claude -p "…"`, `codex exec`, …),
   and nothing can tell that from a human typing (`docs/reference/jev-intent.mdx`, *The risk
   this accepts*). Forged consent clears only reviewable policies, never hard ones. So
   anything a forged "the user asked" must not unlock stays hard, or is reviewed by a check
   with `userCanOverride: false`.

The builtins that ship reviewable, and what reviews each, are in §10.

## 4. Semantic checks: the shape

`semanticPolicies.add(decl)`: validated by `parsePackSemanticPolicy`
(`src/hooks/pack-manifest.ts`) at publish time and again at install/load.

| Field | Required | Rule |
|---|---|---|
| `name` | yes | `[A-Za-z0-9._-]{1,128}`, unique in the pack. What `reviewedBy` names; reported as `semantic/<name>` |
| `title` | yes | ≤120 chars, past tense ("Tried to …"). Also feeds the `user_asked` question |
| `appliesTo` | yes | non-empty, from `shell` (Bash) · `write` (Write, Edit, MultiEdit, NotebookEdit) · `read` (Read, Glob, Grep, LS) · `network` (WebFetch, WebSearch) · `other` (`src/hooks/semantic/facts.ts`, grep `classifyTool`) |
| `mode` | yes | `"deny"` blocks at evidence ≥ 0.85 and warns from 0.7; `"instruct"` only warns |
| `userCanOverride` | yes | boolean, **no default**. `true`: the user's request (real or forged) allows a fired check, and a task step softens its deny to a warning. `false`: neither |
| `probes` | yes | 1–6 of `{ id, instructions, criteria? }`. **Every** probe must hold for the check to fire |
| `probes[].id` | yes | `^[a-z][a-z0-9_]{0,31}$`, unique in the check; `exempt` and `user_asked` are reserved |
| `probes[].instructions` | yes | ≤600 chars |
| `probes[].criteria` | no | `{ true, false }`, ≤300 chars each, both halves or neither |
| `exempt` | no | one more probe (its `id` is ignored). When it holds (≥ 0.5) the check does not fire |
| `precondition` | no | a **name**, never code: `always`, `protected_branch`, `in_git_repo`, `has_paths`, `paths_outside_project`, `system_or_root_paths` (`src/hooks/semantic/precondition-names.ts`). Absent = asked on every call `appliesTo` covers |
| `guidance` | yes | ≤600 chars, shown to the agent when it fires. A deny-mode check only warns on moderate evidence, so do not say "blocked" |
| `alwaysOn` | — | refused: packs may not set it |

There is no `fn` and no `match`. On the wire each probe becomes one `noul` question
(`{ type: "noul", instructions, criteria }`, `src/hooks/semantic/types.ts`), keyed
`<check>.<probe>`; every question in a request is answered independently against the same
state, in one round trip.

**How a check decides** (`src/hooks/semantic/decide.ts`, grep `DEFAULT_THRESHOLDS_V1` and
`function decideV1`):

- evidence = the **minimum** over its probes. It fires at evidence ≥ 0.7 unless `exempt` ≥ 0.5;
- a fired `deny` check denies at ≥ 0.85, otherwise it warns; an `instruct` check warns;
- a suspected injection (the call contains text addressed to the reviewer) turns any fired
  check into a deny and withdraws every clear;
- with `userCanOverride: true`: `op_requested` ≥ 0.8 with `beyond_task` < 0.5 (and, for a
  shell command, **every** one of its targets named in what the user typed, or in the agent
  message they replied to) allows it; otherwise `task_step` ≥ 0.8 with `beyond_task` < 0.3
  drops a warning and softens a deny to a warning, except on a shell command where the user
  named some of its targets but not all. These task questions are asked only when a human
  message was recorded;
- consent never clears a shell command the scanner cannot fully read: `$'…'`, `$(…)`,
  backticks, heredocs, `eval` or `sh -c` strings, unclosed quotes and similar keep the regex
  floor, though Jev's own deny or warning still counts. Keep a probe's test commands plain.

**What Jev is shown**, so probes can refer to it by name (`src/hooks/semantic/envelope.ts`):
`agent_request` (the call, secrets redacted), `user_said` (what the human typed, harness text
removed), `agent_last_message` (agent-written; context for a "yes", never consent on its
own), and `facts`: `tool_name`, `tool_is_known`, `cwd`, `project_root` (pinned for the
session), `current_git_branch`, `permission_mode`, and `paths[]` with `as_written`,
`resolved` and `relation` (`inside_project`, `project_root`, `outside_project_in_home`,
`home_root`, `system`, `root`). Never ask Jev to count or resolve a path; point it at the fact.

## 5. Writing probes that fire on the harm

A check that does not fire answers "no concern", and no concern clears the floor it
reviews. So **every probe must be true for the harmful call**, never for the harmless one.

- **Put the "does it do X" probe first.** It is the one the beyond-the-task warning reads.
- **One dimension per probe.** The conjunction does the combining. The built-in set's own
  header records one broad "is this dangerous" question scoring far worse than five narrow
  ones on the same corpus (`src/hooks/semantic/policies.ts`, header).
- **State the harmful claim; do not ask a question.** `instructions` is a sentence true for
  the harmful call that says what `criteria.true` says. Measured on live Jev: a push guard
  phrased as a question ("Does the branch name appear verbatim anywhere in `user_said`?")
  under `criteria.true` "NOT present" hovered around the 0.7 fire line (0.45–0.73); stated
  as a claim, the same payloads separated cleanly (0.04 for the branch the user named,
  0.93–0.98 for branches they never mentioned):

  ```js
  { id: "branch_not_named",
    instructions: "The branch this command pushes to (the one it names, or `facts.current_git_branch` for a bare `git push`) does not appear anywhere in `user_said`.",
    criteria: { true: "The user never named that branch.", false: "The user named that branch." } }
  ```

- **Do not invert it.** "The branch appears in `user_said`" is true for the requested push,
  so the check fires on the one the user asked for and answers "no concern" on the
  unrequested one, clearing its floor silently.
- **Name the look-alikes in `criteria.false` or `exempt`.** Jev answers the question as
  written: build output, `--dry-run`, `status`, `.env.example`.
- **"The user did not ask" is usually a probe, not `userCanOverride`.** Consent clears a
  fired check only at `op_requested` ≥ 0.8, and a push the user named explicitly can score
  below that, so a lone "pushes to a remote" check warns on the push that was asked for.
  A probe like `branch_not_named` above decides it directly.
- **Budget matters.** Probe text is the cost (§8). `userCanOverride: true` also adds a
  `user_asked` question to the measured cost.

## 6. A complete two-tier pack entry

A pack entry: `semanticPolicies.add` does nothing anywhere else (§7). This exact file builds
with `failproofai publish db-guard-policies.mjs --dry-run --id acme/db-guard --version 0.1.0`
on 1.0.8-beta.0, and installs from a local mirror (§9).

```js
// db-guard-policies.mjs
import { customPolicies, semanticPolicies, deny, allow } from "failproofai";

// Tier 2: the Jev check. Questions, not code.
semanticPolicies.add({
  name: "db-migration-on-production",
  title: "Tried to run a schema migration against a production database",
  appliesTo: ["shell"],
  mode: "deny",
  userCanOverride: true,
  probes: [
    {
      id: "applies_migration",
      instructions:
        "The command in `agent_request` applies database schema migrations: `prisma migrate deploy`, " +
        "`prisma db push`, `knex migrate:latest`, `alembic upgrade`, `rails db:migrate`, or an equivalent, " +
        "however the binary is spelled or pathed.",
      criteria: {
        true: "Running it would change a database schema.",
        false: "It only creates, lists, checks or previews migrations (`status`, `--create-only`, `--dry-run`, `history`).",
      },
    },
    {
      id: "production_target",
      instructions:
        "The database it targets is production or shared, or cannot be told from the command, its flags, " +
        "or the environment variables set inline on it (`DATABASE_URL=...`, `RAILS_ENV=...`).",
      criteria: {
        true: "Production, shared, or unknown database.",
        false: "Clearly local or throwaway: localhost, 127.0.0.1, a docker-compose service, a sqlite file, or an env named dev, test or local.",
      },
    },
  ],
  guidance: "Run the migration against a local or staging database, or hand the command to a human to run against production.",
});

// Tier 1: the regex floor. Hard everywhere Jev is not configured, in enforce, or answering.
const APPLY = /\b(prisma\s+(migrate\s+deploy|db\s+push)|knex\s+migrate:latest|alembic\s+upgrade|rails\s+db:migrate)\b/;

customPolicies.add({
  name: "block-db-migrate",
  description: "Schema migrations need a human unless the target is clearly local",
  category: "Database",
  defaultEnabled: true,
  match: { events: ["PreToolUse"] },   // Jev reviews PreToolUse and PermissionRequest only
  authority: "reviewable",
  reviewedBy: ["db-migration-on-production"],   // a pack that declares checks may name only its own
  fn: async (ctx) => {
    if (ctx.toolName !== "Bash") return allow();
    const cmd = String(ctx.toolInput?.command ?? "");
    return APPLY.test(cmd)
      ? deny("Schema migrations need a human. Run it against a local database, or ask the user to run it.")
      : allow();
  },
});
```

Why it is shaped this way:

- **The check models every shape the floor fires on.** `appliesTo: ["shell"]` covers the
  only tool the floor matches, there is no precondition to miss, `applies_migration` names
  the same commands, and both probes are true for the harmful case.
- **Something is left that can deny.** The reviewer is deny-mode, so a production target Jev
  is sure of still blocks, and one it is only fairly sure of (0.7–0.85) withdraws every clear,
  so the floor stands.
- **Consent is the price.** With `userCanOverride: true`, a user (or a forged prompt) asking
  for the migration clears it. Set `false` if a production migration must block whatever
  the task says.
- **Its dry run** prints `1 semantic policy for Jev (1530 characters of questions), added to
  the built-in checks where it installs.` and `Requires failproofai 1.0.8-beta.0 or newer.`

## 7. Where Jev fields count

| Where the code lives | `semanticPolicies.add` | `authority` / `reviewedBy` |
|---|---|---|
| Your own file (`.failproofai/policies/`, `--custom`) | **never asked.** The hook log says `… never asked here` once per file (`src/hooks/custom-hooks-loader.ts`) | honoured. `reviewedBy` may name the 16 built-in checks or one an installed pack declares |
| A pack entry published with `failproofai publish` | written to the manifest's `semantic` array; asked on machines with Jev | validated at publish and copied into the manifest, which is what machines read |
| A **FailproofAI Cloud**-managed policy | never asked | **ignored: always hard.** Authority comes from the deployment, which does not set it yet |

So **Jev checks belong in packs, not in FailproofAI Cloud-managed policies.** Strip
`semanticPolicies.add`, `authority` and `reviewedBy` from anything headed for
`fp policies publish`; a Cloud policy never reads them, and leaving them in makes a version
that reads as Jev-aware and is not. Ship the semantic half as a pack (`failproofai-policy-publish`).

## 8. Packs: joining, reserved names, the question budget

(`src/hooks/semantic/pack-policies.ts`, header; `src/hooks/effective-reviewers.ts`.)

- **A pack's checks join the 16 built-in ones.** Only a pack installed from a FailproofAI
  repository (`FailproofAI/jev-policies`) replaces them. Checks from several packs add up.
- **The 16 built-in names are reserved.** Declared by a pack not from FailproofAI, that
  pack's version is never asked, so `publish` refuses one. Pick names of your own.
- **A name two packs declare differently is asked for neither**, and every policy naming it
  stays hard. Identical declarations are fine.
- **`reviewedBy` in a pack names the pack's own checks.** A pack that declares any may
  name only those; a pack with none is judged against the built-in names.
- **One question budget, shared.** One Jev request has room for 27,591 characters of
  questions and the 16 built-in checks spend 18,490 of it first, so a pack from outside
  FailproofAI has **9,101** (`MAX_PACK_QUESTION_CHARS`, `BUILTIN_QUESTION_CHARS`). `publish`
  refuses a pack over that. Installed packs share what is left: a check that does not fit
  beside others is dropped at load, named by `policies add` and by the hook log
  (`was dropped: its questions need`). The example above costs 1,530.
- **Count caps:** 24 checks per pack, 6 probes per check.
- **Observe and agent-scoped packs do not enforce Jev.** An `--effect observe` pack's checks
  are never asked, and a pack added with `--cli <agent>` has its checks asked only for those
  agents. A policy naming a check that is not asked stays hard.
- **`minCliVersion` ≥ 1.0.8-beta.0.** 1.0.7 ignores a pack's checks and 1.0.7-beta.x
  replaces the built-in checks with them. `publish` refuses a lower `--min-cli-version` and
  writes `1.0.8-beta.0` when you pass none (`src/hooks/pack-cli.ts`, grep `JEV_PACK_MIN_CLI`).

## 9. Test it locally

**The floor, first, without Jev.** `test-policy.mjs --policy` runs with the legacy evaluator in
a sandbox HOME, so it sees exactly the hard regex, `semanticPolicies.add` included and
ignored. Test both directions as usual:

```bash
node "$SKILL_DIR/scripts/test-policy.mjs" --policy db-guard-policies.mjs --cases cases.json
```

**The pack, second.** The dry run is the validator: it runs the loader's own rules and
publishes nothing. Always pass `--dry-run`; without it, a publish with no `--repo` takes the
repository from the git origin and releases for real.

```bash
failproofai publish db-guard-policies.mjs --dry-run --id acme/db-guard --version 0.1.0
```

**Install a dry-run pack on this machine.** `policies add` takes `owner/repo[@tag]`, never a
path, and fetches from `$FAILPROOFAI_PACK_BASE_URL/<owner>/<repo>/releases/download/<tag>/`
(default `https://github.com`). Serve `dist-pack/` as that layout:

```bash
d=pack-mirror/acme/db-guard/releases/download/0.1.0; mkdir -p "$d" && cp dist-pack/* "$d"
python3 -m http.server 8765 -d pack-mirror &
FAILPROOFAI_PACK_BASE_URL=http://127.0.0.1:8765 failproofai policies add acme/db-guard@0.1.0 --all
failproofai policies show acme/db-guard@0.1.0     # while the mirror is up
```

The variable redirects every pack fetch, so unset it before `policies add FailproofAI/policies`.

**Turn Jev on, in shadow.** Two routes (`docs/policies/jev-byok.mdx`, `jev-cloud.mdx`):

```bash
# Your own key (TypeSafe, OpenRouter, Vercel, Cloudflare, or a custom endpoint)
failproofai jev setup --provider typesafe --key-stdin --mode shadow < ~/typesafe.key
# FailproofAI Cloud: a machine key (events:add + policies:pull + jev:evaluate)
failproofai config --token <machine-key>          # turns Jev on in shadow when no jev.json exists
failproofai jev setup --provider failproofai --mode shadow
```

**Pass `--mode shadow` on the bring-your-own-key route.** Its default is `enforce`
(`src/hooks/semantic/jev-config.ts`, grep `DEFAULT_JEV_MODE`); only the FailproofAI Cloud
route starts in shadow.

**Then read what it did:**

- `failproofai jev test`: one live request to check the key, endpoint and answering Jev
  version. It never touches your policies.
- `failproofai jev status` (`--json`): provider, mode, `N of M enabled policies are
  reviewable` (policies from your own files are not counted), and the last 24 hours:
  evaluations, fallbacks and why, `cleared` and `would have cleared (shadow)`.
- `~/.failproofai/state/semantic/verdicts.jsonl`: one row per Jev evaluation, answers keyed
  `<check>.<probe>`. The only proof a probe was asked.
- `~/.failproofai/hook-activity/`: the decision log, with `jevCleared` naming what Jev cleared.

**Prompt wording is part of the test input.** Jev reads what the human typed:

- **Naming the operation reads as consent.** "Run `prisma migrate deploy`" gives Jev
  `op_requested` high, and with `userCanOverride: true` that clears the check whatever its
  probes say. You learn nothing about the probes. Use a **vague** prompt ("get the database
  up to date") to see the check decide on its own; then a prompt that names the operation to
  see the consent path.
- **No prompt at all** (a fresh session, a CLI with no prompt event) asks no task questions,
  so the consent path is not exercised either.
- A long pasted prompt is fine: its length never decides a verdict.

**Shadow, then enforce.** Nothing is cleared and no check blocks until
`failproofai jev setup --mode enforce`. Do not report the semantic tier as live until
`jev status` shows `enforce`. `--mode off` keeps the config and stops asking.

## 10. The 16 built-in checks, and which builtins they review

The checks every machine with Jev asks (`src/hooks/semantic/policies.ts`, grep
`SEMANTIC_POLICIES`; published as `FailproofAI/jev-policies`, which declares the same 16
with 20 probes and one `exempt`). Read a check's probe wording in that source before naming
it in `reviewedBy`; `failproofai policies show FailproofAI/jev-policies` lists names and modes.

| Check | Mode | User can override | `appliesTo` | Precondition | Probes |
|---|---|---|---|---|---|
| `destructive-deletion` | deny | yes | shell, write | — | `destroys`, `irreplaceable` |
| `production-infra-change` | deny | yes | shell | — | `mutates`, `not_local` |
| `git-history-rewrite` | deny | yes | shell | — | `rewrites_remote` |
| `push-to-protected-branch` | instruct | yes | shell | — | `pushes_protected` |
| `commit-on-protected-branch` | instruct | yes | shell | `protected_branch` | `creates_commit` |
| `secret-exposure` | deny | yes | shell, read, write | — | `touches_secrets` |
| `credential-exfiltration` | deny | **no** | shell, network | — | `sends_out`, `sensitive_payload` |
| `remote-code-execution` | deny | yes | shell | — | `download_and_run` + `exempt` |
| `privilege-escalation` | deny | yes | shell | — | `elevates` |
| `database-destruction` | deny | yes | shell | — | `destructive_sql`, `real_database` |
| `read-outside-workspace` | instruct | yes | shell, read | `paths_outside_project` | `reads_outside` |
| `agent-config-tampering` | deny | **no** | shell, write | — | `edits_agent_config` |
| `system-modification` | instruct | yes | shell | — | `modifies_system` |
| `env-secrets-dump` | instruct | yes | shell | — | `dumps_env` |
| `external-destructive-action` | deny | yes | other | — | `irreversible_external` |
| `external-data-egress` | instruct | yes | other | — | `egresses_private` |

The 15 builtins that ship **reviewable**, from `FailproofAI/policies` 2.0.0's manifest
(`docs/policies/authority.mdx`, *Built-in policies*). Every other builtin is hard.

| Builtin | Reviewed by |
|---|---|
| `protect-env-vars` | `env-secrets-dump`, `secret-exposure` |
| `block-env-files`, `block-secrets-write` | `secret-exposure` |
| `block-read-outside-cwd` | `read-outside-workspace` |
| `block-rm-rf` | `destructive-deletion` |
| `block-force-push`, `warn-git-amend` | `git-history-rewrite` |
| `warn-destructive-sql` | `database-destruction` |
| `warn-global-package-install` | `system-modification` |
| `block-kubectl`, `block-terraform`, `block-aws-cli`, `block-gcloud`, `block-az-cli`, `block-helm` | `production-infra-change` |

An older release of that pack carries no authority marks, so every policy in it is hard.
