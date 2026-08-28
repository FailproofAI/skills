# Policies from the operator's side

Enabling, installing, packaging, and what makes a policy stop running — on **this machine**.
Everything about policy *source* — the JS API, `match`, `allow`/`instruct`/`deny`, testing a
rule — belongs to **`failproofai-policy-author`**. Publishing a version and pushing it to
machines belongs to **`fp-cloud-cli`**; stay here for where a cloud-managed
policy lands on disk and how it behaves once it has. Anchors are grep targets in the
`failproofai` package.

## Five sources, one registry

All register into one `globalThis` registry (`policy-registry.ts`) and use the same JS API,
told apart only by the prefix the handler applies (`handler.ts`, grep `const prefix =`):

| Source | Prefix | Turned on by |
|---|---|---|
| Builtin | `failproofai/<name>` | **nothing, on a machine set up by this version** — one `alwaysOn` guard, plus `enabledPolicies` read only as a migration shim |
| Explicit custom | `custom/<name>` | `customPoliciesPaths` |
| Convention | `.failproofai-project/…`, `.failproofai-user/…` | nothing — presence is the switch |
| Pack | `pack/<id>@<version>/<name>` | `installed.json` `enabled` list |
| Cloud-managed | `cloud/<id>@<version>/<name>` | a fleet deploy, not this machine |

`failproofai policies` prints **four sections** — `Custom Policies`, `Convention Policies —
<scope>`, a `Pack — <id>@<version>` block per pack, and a read-only `Cloud-managed —
deployment <n>` block (`manager.ts`, grep `Cloud-managed — deployment`). There is no builtin
section, because this build registers no builtins of its own to list. Its header counts
**enabled pack policies only**: `<scopes> · <N> on`, or `<N> on · NOT ENFORCING` when packs
are installed and no agent CLI is wired, or `nothing installed`.

No command prints a pack's digest any more. `pack-cli.ts`'s `list()` still renders digest,
source, effect and health, and nothing reaches it: bare `pack list` is rewritten to
`policies` (which goes to `listHooks`), and `pack list <source>` is rewritten to `policies
show <source>` (which goes to the remote preview). Read `installed.json` if you need the
digest.

## The 39 builtins, and where they went

39 entries in `policy-catalog.ts`, 11 `defaultEnabled: true`, exactly 1 `alwaysOn`, and
**zero marked `beta` today** (`grep -c 'beta: true' src/hooks/policy-catalog.ts` → 0). The
docs-site builtin catalog lists the same 39 and gives no total. The 11 are `sanitize-jwt`,
`sanitize-api-keys`, `sanitize-connection-strings`, `sanitize-private-key-content`,
`sanitize-bearer-tokens`, `protect-env-vars`, `block-env-files`, `block-sudo`,
`block-curl-pipe-sh`, `block-push-master`, and `block-failproofai-commands`.

**Only that last one still enforces from the npm package.** It is `alwaysOn`: it bypasses the
enabled set entirely and registers on every evaluation regardless of config, an active pause,
or a config that failed to parse (`builtin-policies.ts`, grep `policy.alwaysOn ||`). Removing
it is **refused with an error**, not silently ignored (grep `rejectAlwaysOnPolicies`), and it
reads `LOCK` rather than `ON`. It has to ship compiled in because a pack may not declare
`alwaysOn` — a downloaded file no local command can switch off is the thing this guard exists
to prevent.

The other **38 arrive as a pack like anyone else's**: `FailproofAI/policies`, fetched from a
GitHub release, digest-verified, pinned to a concrete tag. **10 of the 38 are
`defaultEnabled`**, so a bare `failproofai policies add FailproofAI/policies` turns on 10.
Nothing ships from disk: `policy-pack/` is out of the package's `files` and `build`,
`installBundledPack()` is deleted, and `core`, `failproofai` and `official` are retired
spellings that throw *"ours is a pack like anyone else's now. Use FailproofAI/policies
instead."* Only *installing* needs the network — an installed pack keeps enforcing offline.

| Set | Size | Answers |
|---|---|---|
| `defaultEnabled` in `policy-catalog.ts` | 11 | nothing on its own — it reaches a machine only through the pack |
| `defaultEnabled` in the pack | 10 | what a bare `policies add FailproofAI/policies` turns on |
| Enforcing after `failproofai config` and nothing else | **1** | `block-failproofai-commands`, and that is the intended state |

`RECOMMENDED_POLICIES` (15 names) and `POLICY_PRESETS` (4 themed bundles) are **gone** —
`policy-presets.ts` is deleted along with the wizard's policy step. Nothing installs a
curated set on anyone's behalf any more, and no note should send a reader looking for one.
The listing header counts enabled *pack* policies, so a machine with hooks and no pack reads
`0 on` while the always-on guard is still denying; it is not counted and it is still there.

## `policies --install` / `--uninstall`

```bash
failproofai policies --install block-sudo --cli claude codex --scope project
failproofai policies --install --custom ./security.policies.ts --cli claude --scope project
```

This is the **wiring** lane, not the choosing lane. Choosing is `policies add` / `policies
remove`.

- **A name is resolved against installed packs FIRST, then the compiled set** (`manager.ts`,
  grep `A PACK first, then the compiled set`). A pack policy is switched on in
  `installed.json` and taken out of the list — and if every name you gave was a pack policy,
  the command **returns there**, having rewritten no settings file. This is the fix for
  `remove block-sudo` printing "Disabled 0" while `block-sudo` kept denying: the pack is
  where the switch is. A name two installed packs both declare is a hard error; disambiguate
  as `<pack-id>:<name>`.
- **`--install` with no names no longer opens a policy picker.** It wires hooks and leaves
  `enabledPolicies` exactly as it found it. `promptPolicySelection` survives in
  `install-prompt.ts` with no production caller; do not document it as a surface.
- **Names that are not in any installed pack pull the pack down.** On a machine with no pack,
  `installHooks` calls `addPack("FailproofAI/policies", { only: <your names> })` — so
  `policies --install block-rm-rf` reaches the network, and `--install all` installs ours with
  all 38 on. A fetch failure prints `Warning: could not fetch the policy pack (…)` and leaves
  the names in `enabledPolicies` for the migration shim.
- **Additive for `enabledPolicies`** — `replace ? incoming : union(previous, incoming)`
  (grep `Default is additive`). Only the configure wizard passes `replace: true`, and it
  passes back what it just read, so `--install a b` produces a superset, never exactly
  `{a, b}`.
- `--install all` expands to every non-beta builtin and **cannot be mixed** with names.
- `--custom` is repeatable and additive. Only paths added this invocation are strictly
  validated; a carried path whose file vanished is dropped with a printed line, not an error
  (grep `Dropping custom policies path`).
- Unknown names in an existing config are deliberately carried, not pruned, and
  `enabledPolicies` accepts `sanitize-jwt` and `failproofai/sanitize-jwt` alike.
- Scope is rejected, not degraded: Codex, Copilot, Cursor, OpenCode and Pi are
  **user|project only** and error on `--scope local`. Scope applies to hook entries and
  `enabledPolicies`; **a pack toggle is machine-level and ignores it.**
- **`--uninstall` with no policy names removes the hook entries entirely** — it is not a
  narrower operation. `--beta` there is documented as "remove only beta policies" while
  `betaOnly` is read *only by telemetry* (`grep -n betaOnly src/hooks/manager.ts` → four hits,
  all a doc comment or a tracked field), so `policies --uninstall --beta` silently uninstalls
  **every** hook entry for the selected CLIs.

## `policies add` / `policies remove`

**`policies` is the noun.** `policy`, `pack` and `p` are rewritten to it at
`bin/failproofai.mjs` before `SUBCOMMANDS` and every dispatch, so nothing anyone typed
before breaks and no branch below ever sees the old spelling. Write `policies`; treat the
other three as a compatibility note, not as commands. `pack list` → `policies`, `pack list
<source>` → `policies show <source>`, `pack build` → `publish`.

One lane, split by a slash. A policy name matches `/^[A-Za-z0-9._-]+$/` and so can never
contain `/`; anything that does (or starts `github:`) is a pack source:

```bash
failproofai policies add                  # picker over every installed pack
failproofai policies add block-sudo       # one policy — no slash
failproofai policies add acme/guard       # a pack — the slash IS the routing rule
failproofai policies remove acme/guard    # a policy, or a whole pack
failproofai policies show acme/guard      # what it holds, before installing
```

Bare `policies add` / `policies remove` needs a terminal and **exits 1 without one** — the
no-TTY refusal is checked before the empty-state branch, so a script gets
`` `policies <action>` with no name needs a terminal to show you the list. `` plus the two
scriptable spellings. **The publishing half of this lane belongs to `failproofai-policy-publish`**;
what follows is the policy-name half.

Exactly one name, default scope `user` (`bin/failproofai.mjs`). Two or more positionals is a
hard error pointing at `policies --install <a> <b>`; an unknown flag is a hard error
(`--scope`, `--cli`, `--beta` are the whole set).

| | `add` | `remove` |
|---|---|---|
| Valid scopes | `user`, `project`, `local` | those **plus `all`** |
| `--beta` | passed through as `includeBeta` | **accepted and discarded** |

The remove quirk is deliberate and commented in place: remove always removes the named policy
whatever its beta flag, and emits `beta_only: false` unconditionally so dashboards do not see
ghost beta-removal events (`bin/failproofai.mjs`, grep `ghost "beta removal"`).

**`--scope all` on remove is narrower than it reads.** `removeHooks` opens with
`const configScope = scope === "all" ? "user" : scope`, so `all` widens only the loop that
strips *hook entries* from settings files. The `enabledPolicies` edit still lands in the
**user** `policies-config.json` and never touches project or local.

## Local config files and merge order

Read in this order by `readMergedHooksConfig` (`hooks-config.ts`):

| Order | Scope | Path |
|---|---|---|
| 1 | project | `<root>/.failproofai/policies-config.json` |
| 2 | local | `<root>/.failproofai/policies-config.local.json` |
| 3 | user | `~/.failproofai/policies-config.json` |

`<root>` is found by walking **up** from cwd until a `.failproofai/` appears, stopping at
`$HOME` (grep `findProjectConfigDir`). A `.failproofai/` in a parent directory silently
governs everything below it.

| Field | Merge rule |
|---|---|
| `enabledPolicies` | **union across all three**, no subtraction anywhere |
| `policyParams` | per-policy, **first scope naming the policy wins the whole object** |
| `customPoliciesPaths` / legacy `customPoliciesPath` | first scope defining either wins |
| `disabledCustomPolicies` | union |
| `customPoliciesEnabled`, `llm` | first defined wins |

- **You cannot disable a legacy builtin from project or local.** `policies remove X --scope
  project` writes the file and changes nothing observable while the user scope still enables
  `X`. This is the builtin lane only: if an installed pack carries `X`, the name resolves to
  the pack instead, is switched off in `installed.json` machine-wide, and the scope flag
  never enters into it.
- `policyParams` is first-scope-wins **per policy, not per key**. A project scope setting only
  `allowPaths` for `block-rm-rf` discards the user scope's entire `block-rm-rf` params object,
  including keys the project never mentioned.

`enabledPolicies` is a presence list; `policyParams` is a sibling map on the same names.
`failproofai policies` warns on `policyParams` keys **no installed pack declares** — in
either spelling, the bare `<name>` or the qualified `pack/<id>/<name>` the dashboard writes
— and stays silent when no pack is readable rather than calling every key a typo. Unknown
`enabledPolicies` entries are never warned about.

```json
{
  "enabledPolicies": ["block-sudo", "block-rm-rf"],
  "policyParams": { "block-sudo": { "allowPatterns": ["sudo systemctl status"] } }
}
```

**An unparseable config soft-fails to `{enabledPolicies: []}`** after a stderr warning (grep
`failed to parse config at`); `syncConventionPolicies` refuses to write over such a file so
the damage does not compound. What one stray comma costs you now: the migration shim (every
legacy builtin off), every `policyParams` object, and every entry in
`disabledCustomPolicies` — so policies you deliberately switched off come back **on**. Packs
are unaffected: their selection lives in `installed.json`, not here. The listing's `Config:`
footer names only the user file, whatever scope you were editing.

## Convention policies and the filename trap

Any file matching `/policies\.(js|mjs|ts)$/` in `.failproofai/policies/` (project) or
`~/.failproofai/policies/` (user) auto-loads with no config and no flag. Discovery is
non-recursive and filters `isFile()` — the only reason `packs/` and `cloud-policies/` can
safely live under the same directory (`fp-home.ts`, grep `does not recurse`).

**`block-force-push.mjs` is skipped and enforces nothing. It must be
`block-force-push-policies.mjs`.** This repo shipped `block-version-bumps.mjs` that way and
the guard never once ran (grep `findSkippedPolicyFiles`). How silent: that function has two
callers — `warnSkippedPolicyFiles` on the hook path, which emits `hookLogWarn` to **stderr at
level `warn`, discarded unless `FAILPROOFAI_HOOK_LOG_FILE` is set**, and
`configure-wizard.ts`. The interactive wizard is the only surface that tells a human;
`failproofai policies` does not check at all (`grep -n findSkippedPolicyFiles
src/hooks/manager.ts` → nothing). `conventionPolicies` in `policies-config.json` is a
descriptive mirror written by that command, never authoritative.

## Policy packs

How every policy that is not the always-on guard reaches a machine, ours included: the pack
`FailproofAI/policies`, effect `enforce`, 38 policies, 10 on by default, cut by `failproofai
publish` like anyone else's. There is no vendored copy and no offline install — `policy-pack/`
is out of the package's `files` and `build`, and `installBundledPack()` is deleted.

```bash
failproofai policies                                     # what is installed here
failproofai policies show acme/finance                   # manifest only, no code fetched
failproofai policies add FailproofAI/policies --category sanitize,git
failproofai policies add github:acme/finance@v1.2.0 --policy block-refunds
failproofai policies remove acme/finance                 # the ID, never the source string
```

**Put the pack id immediately after `remove`.** It reads `rest[0]` and nothing else, so
`policies remove --scope user acme/finance` routes to the pack lane correctly and then takes
`--scope` as the id. `add` is flag-aware and skips every value-taking flag; `remove` is not.

`--policy` and `--only` are the same switch — teach `--policy`. Category slugs are
`slugifyCategory()`: lowercase, non-alphanumeric runs collapsed to `-`, giving `sanitize`,
`environment`, `dangerous-commands`, `infra-commands`, `git`, `database`, `packages-system`,
`ai-behavior`, `workflow`. An unknown slug or an unknown policy name now **throws and names
what the pack actually has**; it used to install the defaults in silence.

Three release assets — `failproofai-pack.mjs`, `failproofai-pack.json`, `SHA256SUMS` —
installed under `~/.failproofai/policies/packs/` with content-addressed
`artifacts/<sha256>.mjs` and an `installed.json` pointer written last and atomically.
**The digest is verified at install and re-verified immediately before every import**
(`pack-manifest.ts`, grep `failed integrity verification`), which buys two things: a pack
cannot change under a machine after install, and a repo that retags or force-pushes an asset
stops loading rather than silently running something else. It is **not a signature** — whoever
controls the release controls `SHA256SUMS` too, and signing was deliberately deferred
(`pack-store.ts`, grep `The trust this does and does not give you`).

**The artifact is imported once before `installed.json` is written**, and the install is
refused if the manifest declares a name the artifact does not register, or the reverse
(`verifyArtifactRegisters`). A refusal leaves the machine exactly as it was. This closes the
worst pack failure there was: a one-name typo between the two files installed reporting
"2/2 enabled" and then converted into a machine-wide deny, because a declared policy that
never registers is precisely what the fail-closed guard denies for.

Selection resolution, five outcomes (`pack-store.ts`, grep `resolveSelection`):

| Reason printed | When |
|---|---|
| `everything in the pack` | `--all` |
| `your selection` | `--policy` and/or `--category`, unioned, on a first install |
| `what you added, plus what was already on` | the same flags on a pack already installed |
| `your existing selection` | no flags, already installed — an upgrade carries your picks |
| `the pack's defaults` | no flags, first install — the author's `defaultEnabled` set |

- **Selection flags MERGE; the interactive picker REPLACES.** `--category git` on an
  installed pack means "*also* turn Git on" — the command's first word is `add`. The picker
  sets `merge: false` because its list is the complete answer, which is what makes unticking
  able to switch something off at all. An empty pick is a real answer, carried explicitly:
  the pack is installed and enforcing nothing.
- **A bare `policies add <owner>/<repo>` on a TTY asks twice before installing** — which
  agents to guard, then which policies (pre-ticked from the *manifest*; the entry artifact is
  never downloaded for a preview). Selection flags or a non-TTY skip both prompts, and only
  then is "a bare add takes `defaultEnabled`" — 10 of 38 for ours — the whole story.
- **`--all` silently overrides `--policy` and `--category`** — the early return sits above
  both blocks, nothing warns. Unknown *flags* are still ignored just as quietly on this lane:
  `--onlyy block-refunds` installs the defaults, because bin's unknown-flag rejection sits
  below the source-routing branch.
- **`remove` then `add` resets your selection to the pack's defaults** — removal deletes the
  `installed.json` record, so the carry-forward branch no longer sees a prior install.
  Upgrading in place carries it; a remove/re-add does not, and nothing warns. The
  content-addressed artifact is deliberately left on disk.
- A tagless source resolves through the `releases/latest` **redirect** (same host as the
  assets, no rate limit, follows `FAILPROOFAI_PACK_BASE_URL`) and pins the tag, printed as
  `(newest release; pinned to <tag>)`. GitHub redirects only for a published, non-prerelease
  release, so a repo whose newest release is a draft or prerelease either pins an older
  stable tag **without telling you** or errors. Name a tag when it matters; re-running the
  same tagless command later can install something else.
- An id is bound to the repo it first came from (`pack id X is already installed from Y`),
  and the inverse bites: a pack whose entry bytes are byte-identical to an installed one
  under a different id **absorbs and deletes that record**, printing `Replaced <ids> — same
  artifact, so it was taken as this pack renamed`.
- Effect is **publisher-set**, whole-pack, with no CLI override. The `failproofai policies`
  pack section renders `observe` per row, so an observe pack cannot read as `on`.
- Packs may not declare `alwaysOn`; the check is `"alwaysOn" in raw`, so even
  `"alwaysOn": false` refuses the install.

Env: `FAILPROOFAI_PACK_DIR` (pack root), `FAILPROOFAI_PACK_BASE_URL` (mirror — covers asset
URLs *and* the latest redirect), `FAILPROOFAI_NO_DOWNLOAD` (refuse to fetch; installed packs
keep enforcing). Installs send **no `Authorization` header at all**, by design — which is why
a private repo publishes to nobody. **Publishing a pack of your own is
`failproofai-policy-publish`'s** (`failproofai publish`), as is the full source grammar.

## Cloud-managed vs local

| | Local (builtin / convention / pack) | Cloud-managed |
|---|---|---|
| Owned by | this machine's config files | the deployment |
| Disabled locally | yes | **no** — `--uninstall <name>` cannot touch one |
| `disabledCustomPolicies` | honoured | ignored by design |
| Session pause | suspends it, packs included | **exempt** |
| Effect | per-pack, publisher-set | per-policy, operator-set |

`handler.ts` grep `!cloudManaged && activePause` is both pause rules in one line — and the
pause *does* suspend packs, though `docs/policies/rollback.mdx` lists only "builtin, custom,
and convention". Artifacts live in `~/.failproofai/policies/cloud-policies/`:
`desired-state.json`, `active.json` (atomically replaced pointer), flat
`artifacts/<sha256>.mjs`. There is no `deployments/<n>/` tree — `crates/CLOUD_POLICIES.md`
still documents one and is stale. The TS hook path re-verifies every SHA-256 before import
rather than trusting the daemon that wrote them.

`--disconnect` removes `active.json` as well as the credential. **Deleting
`credentials.json` by hand does not** — that stops policy refreshing while every artifact
already on disk keeps enforcing indefinitely, with `--status` reporting the machine as
unconnected (grep `clearActiveCloudManagedPolicies`).

**What lands here is CLI-drivable.** The lane is `fp policies` → `fp fleet` → `fp
guardrails`: compose, test, publish, deploy, then watch what enforcement did. Any note in
this repo saying assignment, promotion or rollback is "dashboard work" or "not exposed by the
cloud CLI" is stale, and believing it stops an agent looking for commands that ship.
**`fp-cloud-cli` owns that Cloud deployment lane in depth** — go there for the full grammar. Three
facts belong on this side of the boundary, because they decide what a machine ends up
enforcing:

- **Publishing deploys nothing.** `fp policies publish <policy-id> <source>` mints a new
  version and leaves it unused; no machine picks it up until an `fp fleet deploy` names it.
- **`disable` stops enforcement; `delete` does not.** `fp policies disable <policy-id>`
  removes the policy from every deployment carrying it. `delete` archives it — already-
  deployed artifacts on disk keep running. To actually stop a policy, disable it or deploy it
  away, then confirm with `fp fleet diff`.
- **Every `policies` / `fleet` / `guardrails` subcommand except `policies test` exits 2 under
  an API key.** They need a user session. CI cannot drive a deploy; a human or a session token
  has to.

`fp policies test` is the exception and the only piece of the lane that is genuinely local —
no server, no fleet, no auth, just `node` on PATH. It resolves `import { deny } from
"failproofai"` with nothing installed in the working directory, because the CLI shims the
module itself:

```bash
fp policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",...}]}
```

State its limit honestly: it proves the policy parses, registers and decides for the input
you gave it. It cannot prove the daemon feeds it the same context.

## Observe, enforce, roll back

Effects are exactly two, `enforce` and `observe`, set per policy per machine on the deploy
ref — `id`, `id@version`, `id:effect`, `id@version:effect`:

```bash
fp fleet deploy <machine-id> --add no-force-push:observe
fp fleet deploy <machine-id> --add no-force-push:enforce
fp fleet rollback <machine-id> 3
```

**A bare `--add` on a policy the machine does not already run enforces it.** There is no
observe-by-default anywhere in this system; write the effect. One ref per flag — they are
**not** comma-split — and `--set` replaces the whole set and cannot be combined with
`--add`/`--remove`. Read the JSON field, not the exit code: a no-op exits 0 with
`applied: false` and a declined prompt exits 0 with `cancelled: true`. `fp fleet diff` is the
only surface that shows intent against delivery, and the gap is the point — a machine that
has not collected its latest deployment is not enforcing what the fleet says it is.

`observe` runs the policy for real under the same 10s timeout, records what it *would* have
decided, then returns `allow` (grep `observeOnly`). The record lands on the hook-activity row
as `observed: [{policyId, version, decision, reason}]`; without it the row is
indistinguishable from one where the policy never matched. **Absent effect always means
`enforce`**, so a manifest written before observe mode existed cannot silently downgrade a
machine. A timeout is recorded as an **allow** in both modes, so an observe measurement of a
slow policy under-reports what enforcing would have done.

Rollback is a **new deployment with a higher number**, never a revert to a lower one. The
reconciler refuses any desired state below the highest the *server* has offered this process
session (`crates/failproofaid/src/cloud_policies.rs`, grep `deployment rollback from`). It
anchors server-side on purpose: anchoring on local `active.json` made that file an
attacker-controlled permanent denial of service — one write with a high number and every real
deployment is refused forever. `fp fleet rollback <machine-id> <generation>` is the same rule
from the other end: it mints a **new** generation carrying the old set rather than rewinding
the counter, and a generation naming a policy since disabled or deleted cannot be reinstated
at all. Roll back the specific version rather than pausing; a pause widens exposure for every
local policy in scope and misses cloud-managed ones anyway.

## Fail-closed: two different mechanisms

**Daemon.** Once `daemon.configured === true` in `~/.failproofai/config.json` the daemon is
the only evaluator — no in-process fallback, because a fallback is a second policy engine
reachable by breaking the first. Both `unreachable` and `protocol-mismatch` force a
machine-wide deny, distinguished only in the message (`bin/failproofai.mjs`, grep `is the ONLY
evaluator`). The gate reads `config.json`, **not** the `daemonConfigured` field on
`HooksConfig` in `policy-types.ts` — that field is declared and never read. An unreadable
`config.json` reads as *not* configured and therefore does **not** fail closed, a deliberate
inversion so a truncated file does not deny every tool call.

**Pack.** Narrower and additive: when a pack the machine was told to *enforce* will not load,
`missingGuards()` registers a synthetic `pack/failproofai-pack-unavailable` at priority 1
(above builtins at 0), matching only the union of the missing policies' declared events and
tools (`pack-failclosed.ts`). Its five carve-outs:

- Only `module_not_found`, `syntax_error`, `runtime_error`, `path_missing` trigger it —
  **`load_timeout` is deliberately excluded** as transient.
- An `observe` pack that fails to load never denies; that would deny for something which, had
  it loaded, would have allowed. `UserPromptSubmit` **instructs, never denies**.
- Skipped entirely during a session pause, so a paused session gets no signal at all.
- A pack whose author marked nothing `defaultEnabled` installs completely inert, reports
  success, and can never trigger this check — an empty taken set means no missing guards.
- **A pack narrowed with `--cli` does not deny on the agents it was never scoped to**
  (`outOfScope`). Absent or empty `clis` still means every agent — and so does an
  *unreadable* one: a `clis` of `"codex"` is a truthy string with a `.length` and an
  `.includes`, and the check is `Array.isArray`, so a malformed scope over-denies rather
  than silently guarding nothing.

Pack *loading* fails open (bad manifest → zero packs and a logged reason); a pack the machine
was told to *enforce* fails closed. Same subsystem, opposite directions, split on whether an
expectation was recorded. Cloud-managed load failure fails open and degrades one layer; before
that fix, one corrupt byte was a machine-wide lockout on Claude and Factory but a
warning-then-allow on Copilot, Cursor, Goose, Pi and Hermes, which read the decision off
stdout and ignore the exit code.

**Every recovery message names commands the agent cannot run.** `block-failproofai-commands`
denies every `failproofai` invocation from a tool call, unconditionally — a human must open a
terminal. Do not retry the blocked action: fail-closed means the system could not establish it
was safe.

Finally, on the binary: `fp` has shipped (`uv tool install fp-cloud-cli`) and is what to
resolve **first** — `command -v fp agenteye`. Notes in this repo putting `agenteye` first, or
calling `fp` unshipped, are stale. `agenteye` is the legacy binary and carries no `policies`,
`fleet` or `guardrails` command at all, so where only it answers the cloud lane above really
is unavailable — that is an upgrade, not a missing flag. To confirm from the cloud side that a
deploy changed behaviour, `fp guardrails summary` is the direct answer; `fp sessions` and
`fp events` are the indirect one.
