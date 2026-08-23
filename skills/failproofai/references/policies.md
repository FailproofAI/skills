# Policies from the operator's side

Enabling, installing, packaging and deploying. Everything about policy *source* — the JS API,
`match`, `allow`/`instruct`/`deny`, testing a rule, publishing a version — belongs to
**`failproofai-policy-author`**. Stay here for what turns a policy on and what makes it stop
running. Anchors are grep targets in the `failproofai` package.

## Five sources, one registry

All register into one `globalThis` registry (`policy-registry.ts`) and use the same JS API,
told apart only by the prefix the handler applies (`handler.ts`, grep `const prefix =`):

| Source | Prefix | Turned on by |
|---|---|---|
| Builtin | `failproofai/<name>` | `enabledPolicies` in a `policies-config.json` |
| Explicit custom | `custom/<name>` | `customPoliciesPaths` |
| Convention | `.failproofai-project/…`, `.failproofai-user/…` | nothing — presence is the switch |
| Pack | `pack/<id>@<version>/<name>` | `installed.json` `enabled` list |
| Cloud-managed | `cloud/<id>@<version>/<name>` | the dashboard, not this machine |

`failproofai policies` prints all five, including a `Pack — <id>@<version>` block per pack
and a read-only `Cloud-managed — deployment <n>` block (`manager.ts`, grep `Cloud-managed —
deployment`). Notes saying packs are missing from that listing are stale. `pack list` is
still the only place showing a pack's digest, source and effect.

## The 39 builtins

39 entries in `policy-catalog.ts`, 11 `defaultEnabled: true`, exactly 1 `alwaysOn`, and
**zero marked `beta` today** (`grep -c 'beta: true' src/hooks/policy-catalog.ts` → 0). The
docs-site builtin catalog lists the same 39 and gives no total. The 11 are `sanitize-jwt`,
`sanitize-api-keys`, `sanitize-connection-strings`, `sanitize-private-key-content`,
`sanitize-bearer-tokens`, `protect-env-vars`, `block-env-files`, `block-sudo`,
`block-curl-pipe-sh`, `block-push-master`, and `block-failproofai-commands`.

That last one bypasses the enabled set entirely — it registers on every
evaluation regardless of config, an active pause, or a config that failed to parse
(`builtin-policies.ts`, grep `policy.alwaysOn ||`). Removing it is **refused with an error**,
not silently ignored (grep `rejectAlwaysOnPolicies`), and it reads `LOCK` rather than `ON`.
Because of it a machine with nothing enabled still reports `1/39 on`.

Three sets get confused constantly:

| Set | Size | Answers |
|---|---|---|
| `defaultEnabled` | 11 (10 in the pack) | what seeds the picker / a bare pack install |
| `RECOMMENDED_POLICIES` | 14 | what guards a machine whose owner did not choose |
| `POLICY_PRESETS` | 4 bundles | category themes: `secrets`, `git`, `ship`, `infra` |

Recommended is hand-written, not derived: it adds `block-rm-rf`, `block-force-push` and
`block-secrets-write`, none of which are `defaultEnabled`. `Dangerous Commands`, `Database`,
`Packages & System` and `AI Behavior` are reachable by **no named preset**, so preset bundles
can never give you `block-rm-rf` or `block-sudo`.

## `policies --install` / `--uninstall`

```bash
failproofai policies --install block-sudo --cli claude codex --scope project
failproofai policies --install --custom ./security.policies.ts --cli claude --scope project
```

- **Additive, always** — `replace ? incoming : union(previous, incoming)` (`manager.ts`,
  grep `Default is additive`). Only the configure wizard passes `replace: true`, so
  `--install a b` produces a superset, never exactly `{a, b}`.
- `--install all` expands to every non-beta builtin and **cannot be mixed** with names.
- `--custom` is repeatable and additive. Only paths added this invocation are strictly
  validated; a carried path whose file vanished is dropped with a printed line, not an error
  (grep `Dropping custom policies path`).
- Off a TTY with no names the picker returns **whatever that scope already had, unchanged**,
  falling back to the 11 defaults only when nothing was enabled there (`install-prompt.ts`,
  grep `If stdin is not a TTY`). Unknown names are deliberately carried, not pruned, and
  `enabledPolicies` accepts `sanitize-jwt` and `failproofai/sanitize-jwt` alike.
- Scope is rejected, not degraded: Codex, Copilot, Cursor, OpenCode and Pi are
  **user|project only** and error on `--scope local`.
- **`--uninstall` with no policy names removes the hook entries entirely** — it is not a
  narrower operation. `--beta` there is documented as "remove only beta policies" while
  `betaOnly` is read *only by telemetry* (`grep -n betaOnly src/hooks/manager.ts` → four hits,
  all a doc comment or a tracked field), so `policies --uninstall --beta` silently uninstalls
  **every** hook entry for the selected CLIs.

## `policy add` / `policy remove`

Single-policy shortcut, exactly one name, default scope `user` (`bin/failproofai.mjs`, grep
`args[0] === "policy"`).

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

- **You cannot disable a user-scope policy from project or local.** `policy remove X --scope
  project` writes the file, prints `Disabled 1 policy(ies)`, and changes nothing observable
  while the user scope still enables `X`.
- `policyParams` is first-scope-wins **per policy, not per key**. A project scope setting only
  `allowPaths` for `block-rm-rf` discards the user scope's entire `block-rm-rf` params object,
  including keys the project never mentioned.

`enabledPolicies` is a presence list; `policyParams` is a sibling map on the same names.
`failproofai policies` warns on `policyParams` keys that are not builtin names (typo
detection) but never on unknown `enabledPolicies` entries.

```json
{
  "enabledPolicies": ["block-sudo", "block-rm-rf"],
  "policyParams": { "block-sudo": { "allowPatterns": ["sudo systemctl status"] } }
}
```

**An unparseable config soft-fails to `{enabledPolicies: []}`** after a stderr warning (grep
`failed to parse config at`). One stray comma silently stops every builtin except the alwaysOn
guard while the machine still looks protected; `syncConventionPolicies` refuses to write over
such a file so the damage does not compound. Two display caveats in the listing (`manager.ts`,
grep `statusHeads`): the per-scope status columns render **the same merged chip in every
column**, so a `User | Project` header pair is not per-scope resolution — and the `Config:`
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

Undocumented on the docs site (`grep -rn "failproofai pack" docs/policies/` finds nothing) but a
first-class subcommand, and how the 38 non-alwaysOn builtins now ship
(`policy-pack/failproofai-pack.json`, id `failproofai/builtins`, effect `enforce`).

```bash
failproofai pack list
failproofai pack add FailproofAI/policies --category secrets,git
failproofai pack add github:acme/finance@v1.2.0 --only block-refunds
failproofai pack remove acme/finance          # the ID, never the source string
```

Three release assets — `failproofai-pack.mjs`, `failproofai-pack.json`, `SHA256SUMS` —
installed under `~/.failproofai/policies/packs/` with content-addressed
`artifacts/<sha256>.mjs` and an `installed.json` pointer written last and atomically.
**The digest is verified at install and re-verified immediately before every import**
(`pack-manifest.ts`, grep `failed integrity verification`), which buys two things: a pack
cannot change under a machine after install, and a repo that retags or force-pushes an asset
stops loading rather than silently running something else. It is **not a signature** — whoever
controls the release controls `SHA256SUMS` too, and signing was deliberately deferred
(`pack-store.ts`, grep `The trust this does and does not give you`).

Selection resolution, in order (`pack-store.ts`, grep `resolveSelection`):

| Reason printed | When |
|---|---|
| `everything in the pack` | `--all` |
| `your selection` | `--category` and/or `--only`, unioned |
| `your existing selection` | no flags, already installed — an upgrade carries your picks |
| `the pack's defaults` | no flags, first install — the author's `defaultEnabled` set |

- **`--all` silently overrides `--only` and `--category`** — the early return sits above both
  blocks, nothing warns. Unknown flags are ignored just as quietly: `--onlyy` installs the
  pack's defaults instead.
- A bare `pack add owner/repo` takes `defaultEnabled` — **10 of 38** for the builtins pack,
  fewer than Recommended's 14. Adding the builtins pack is not equivalent to setup.
- `pack remove` prints "re-adding it works offline". It does not: `addPack` always hits the
  network and throws under `FAILPROOFAI_NO_DOWNLOAD`. The only disk-sourced install is
  `installBundledPack()`, reading `policy-pack/` from the npm package.
- **`remove` then `add` resets your selection to the pack's defaults** — removal deletes the
  `installed.json` record, so the carry-forward branch no longer sees a prior install.
  Upgrading in place carries it; a remove/re-add does not, and nothing warns.
- A tagless source resolves `releases/latest` once and pins the tag, printed as `(newest
  release; pinned to <tag>)`. Re-running the same command later can install something else —
  not reproducible in a Dockerfile.
- **`pack list` exits non-zero whenever any recorded pack failed to load**, having printed the
  listing fine. Exit 0 is not "listing worked".
- Effect is **publisher-set**, whole-pack, with no CLI override — and `pack list`'s per-policy
  chip is derived purely from selection, so it reads `on` inside an observe pack. Effect
  appears once, in the header rows; the `failproofai policies` pack section does render
  `observe` per row.
- Packs may not declare `alwaysOn`; the check is `"alwaysOn" in raw`, so even
  `"alwaysOn": false` refuses the install.

Env: `FAILPROOFAI_PACK_DIR` (pack root), `FAILPROOFAI_PACK_BASE_URL` (mirror — covers asset
URLs *and* the latest redirect), `FAILPROOFAI_NO_DOWNLOAD` (refuse to fetch; installed packs
keep enforcing).

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
unconnected (grep `clearActiveCloudManagedPolicies`). Deployment routes are root-only
administrative endpoints and are **not exposed by the cloud CLI**: assigning, promoting and
rolling back are dashboard work.

## Observe, enforce, roll back

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
deployment is refused forever. Roll back the specific version rather than pausing; a pause
widens exposure for every local policy in scope and misses cloud-managed ones anyway.

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
tools (`pack-failclosed.ts`). Its four carve-outs:

- Only `module_not_found`, `syntax_error`, `runtime_error`, `path_missing` trigger it —
  **`load_timeout` is deliberately excluded** as transient.
- An `observe` pack that fails to load never denies; that would deny for something which, had
  it loaded, would have allowed. `UserPromptSubmit` **instructs, never denies**.
- Skipped entirely during a session pause, so a paused session gets no signal at all.
- A pack whose author marked nothing `defaultEnabled` installs completely inert, reports
  success, and can never trigger this check — an empty taken set means no missing guards.

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

Finally, the `fp sessions` / `fp events` verification steps in the deploy and fleet docs are
**unverified** — that binary's source is not in this repo and the shipped artifact is
`agenteye`. Resolve with `command -v agenteye fp` before quoting them.
