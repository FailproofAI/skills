# The local lane

What a policy becomes once it is on one machine — where it lands, what turns it on, and the
handful of things that stop it running while the machine still looks protected. Grep anchors are
inside the `failproofai` npm package: `node_modules/failproofai/` in an installed project, the
repo root in a checkout.

Policy *source* — the JS API, `match`, the decision helpers — belongs to
`failproofai-policy-author`. Getting a policy onto *other* machines is `references/cloud-lane.md`.
This file is the middle: one machine, on disk.

## Five sources, one registry

Everything registers into the same `globalThis` registry (`policy-registry.ts`) and uses the same
JS API. They are told apart only by the prefix the handler applies (`handler.ts`, grep
`const prefix =`):

| Source | Prefix | Turned on by |
|---|---|---|
| Builtin | `failproofai/<name>` | `enabledPolicies` in a `policies-config.json` |
| Explicit custom | `custom/<name>` | `customPoliciesPaths` |
| Convention | `.failproofai-project/…`, `.failproofai-user/…` | **nothing — presence is the switch** |
| Pack | `pack/<id>@<version>/<name>` | `installed.json`'s `enabled` list — see `packs.md` |
| Cloud-managed | `cloud/<id>@<version>/<name>` | a fleet deploy, not this machine |

The local `policies` listing prints all five, including a `Pack — <id>@<version>` block per pack
and a read-only `Cloud-managed — deployment <n>` block (`manager.ts`, grep
`Cloud-managed —`).

## The filename convention

`CONVENTION_FILE_RE = /policies\.(js|mjs|ts)$/` — `custom-hooks-loader.ts`, grep
`CONVENTION_FILE_RE`.

Any file matching it inside `.failproofai/policies/` (project) or `~/.failproofai/policies/`
(user) auto-loads with no config and no flag. **Anything else is silently skipped.**

| Name | Loads? |
|---|---|
| `no-force-push-policies.mjs` | yes |
| `security-policies.ts` | yes |
| `policies.mjs` | yes |
| `no-force-push.mjs` | **no** |
| `no-force-push-policy.mjs` | **no** — singular |

Discovery is non-recursive and filters `isFile()`, which is the only reason `packs/` and
`cloud-policies/` can safely live under the same directory (`fp-home.ts`, grep
`does not recurse`).

**How silent this is:** `findSkippedPolicyFiles()` exists precisely to catch it, and has two
callers. One emits `hookLogWarn` to stderr at level `warn`, which is discarded unless
`FAILPROOFAI_HOOK_LOG_FILE` is set. The other is the interactive configure wizard. The `policies`
listing does not check at all. So on every non-interactive path, a misnamed policy is
indistinguishable from a working one.

This is not hypothetical: the failproofai repo itself shipped a `block-version-bumps.mjs` and the
guard never once ran. Check the filename before believing any other diagnosis.

`conventionPolicies` in `policies-config.json` is a descriptive mirror written by the listing
command. It is never authoritative — do not read it to decide whether a file loads.

## Three scopes, and their merge rules are opposites

Read in this order by `readMergedHooksConfig` (`hooks-config.ts`):

| Order | Scope | Path |
|---|---|---|
| 1 | project | `<root>/.failproofai/policies-config.json` |
| 2 | local | `<root>/.failproofai/policies-config.local.json` |
| 3 | user | `~/.failproofai/policies-config.json` |

`<root>` is found by walking **up** from cwd until a `.failproofai/` appears, stopping at `$HOME`
(grep `findProjectConfigDir`). A `.failproofai/` in a parent directory silently governs everything
below it.

| Field | Merge rule |
|---|---|
| `enabledPolicies` | **union across all three**, no subtraction anywhere |
| `disabledCustomPolicies` | union |
| `customPoliciesEnabled` | **first scope that defines it wins** |
| `customPoliciesPaths` / legacy `customPoliciesPath` | first scope defining either wins |
| `policyParams` | first scope naming a policy wins that policy's **whole object** |
| `llm` | first defined wins |

Two consequences that cause real confusion:

- **You cannot disable a user-scope policy from project or local.** Removing it at project scope
  writes the file, prints `Disabled 1 policy(ies)`, and changes nothing observable while the user
  scope still enables it. Union means union.
- **`policyParams` is first-scope-wins per policy, not per key.** A project scope setting only
  `allowPaths` for `block-rm-rf` discards the user scope's entire `block-rm-rf` params object,
  including keys the project never mentioned.

```json
{
  "enabledPolicies": ["block-sudo", "block-rm-rf"],
  "policyParams": { "block-sudo": { "allowPatterns": ["sudo systemctl status"] } }
}
```

**An unparseable config soft-fails to `{enabledPolicies: []}`** after a stderr warning (grep
`failed to parse config at`). One stray comma stops every builtin except the alwaysOn guard while
the machine still looks protected. `syncConventionPolicies` refuses to write over such a file, so
the damage does not compound.

Two display caveats in the listing (`manager.ts`, grep `statusHeads`): the per-scope status
columns render **the same merged chip in every column**, so a `User | Project` header pair is not
per-scope resolution — and the `Config:` footer names only the user file, whatever scope you were
editing.

## Installing

```bash
failproofai policies --install block-sudo --cli claude codex --scope project
failproofai policies --install --custom ./no-force-push-policies.mjs --cli claude --scope project
```

- **Additive, always** — `replace ? incoming : union(previous, incoming)` (`manager.ts`, grep
  `Default is additive`). Only the configure wizard passes `replace: true`, so `--install a b`
  produces a superset, never exactly `{a, b}`.
- `--install all` expands to every non-beta builtin and **cannot be mixed** with names.
- `--custom` is repeatable and additive. Only paths added this invocation are strictly validated;
  a carried path whose file has vanished is dropped with a printed line, not an error (grep
  `Dropping custom policies path`).
- Off a TTY with no names, the picker returns **whatever that scope already had, unchanged**,
  falling back to the 11 defaults only when nothing was enabled there (`install-prompt.ts`, grep
  `If stdin is not a TTY`). This is the path a harness takes.
- Unknown names are deliberately carried, not pruned. `enabledPolicies` accepts `sanitize-jwt`
  and `failproofai/sanitize-jwt` alike.
- Scope is rejected, not degraded: Codex, Copilot, Cursor, OpenCode and Pi are **user|project
  only** and error on `--scope local`.
- **`--uninstall` with no policy names removes the hook entries entirely** — it is not a narrower
  operation. And `--beta` there is documented as "remove only beta policies" while `betaOnly` is
  read *only by telemetry*, so `policies --uninstall --beta` silently uninstalls **every** hook
  entry for the selected CLIs.

`policy add` / `policy remove` is the single-policy shortcut — exactly one name, default scope
`user` (`bin/failproofai.mjs`, grep `args[0] === "policy"`). `remove` also accepts `--scope all`,
which is narrower than it reads: `removeHooks` opens with
`const configScope = scope === "all" ? "user" : scope`, so `all` widens only the loop that strips
hook entries from settings files. The `enabledPolicies` edit still lands in the **user** config
and never touches project or local.

## What a cloud deploy leaves on disk

Artifacts land in `~/.failproofai/policies/cloud-policies/`: `desired-state.json`, `active.json`
(an atomically replaced pointer), and flat `artifacts/<sha256>.mjs`. There is no
`deployments/<n>/` tree — any doc describing one is stale. The hook path re-verifies every
SHA-256 before import rather than trusting the daemon that wrote them.

Cloud-managed policies behave differently from everything else on the machine:

| | Local (builtin / convention / pack) | Cloud-managed |
|---|---|---|
| Owned by | this machine's config files | the deployment |
| Disabled locally | yes | **no** — a local uninstall cannot touch one |
| `disabledCustomPolicies` | honoured | ignored by design |
| Session pause | suspends it, packs included | **exempt** |
| Effect | per-pack, publisher-set | **per-policy, operator-set** |

`handler.ts`, grep `!cloudManaged && activePause`, is both pause rules in one line.

This is the point of the two lanes: a cloud-deployed policy is deliberately not something the
machine's own operator can switch off. To stop it you go back to the cloud lane —
`fp policies disable`, or deploy it away — and then confirm with `fp fleet diff`.

`--disconnect` removes `active.json` as well as the credential. **Deleting `credentials.json` by
hand does not**: that stops policy refreshing while every artifact already on disk keeps
enforcing indefinitely, with `--status` reporting the machine as unconnected (grep
`clearActiveCloudManagedPolicies`).

## `observe` on the machine

`observe` is not "logged and skipped". The policy runs for real under the same 10s timeout,
records what it *would* have decided, then returns `allow` (grep `observeOnly`). The record lands
on the hook-activity row as `observed: [{policyId, version, decision, reason}]`; without it, the
row is indistinguishable from one where the policy never matched.

Two consequences for a promotion decision:

- **Absent effect always means `enforce`**, so a manifest written before observe mode existed
  cannot silently downgrade a machine.
- **A timeout is recorded as an allow in both modes**, so an observe measurement of a slow policy
  under-reports what enforcing would have done. If p95 is anywhere near the budget, the observe
  numbers are a floor, not an estimate.

Rollback on the machine side is a **new deployment with a higher number**, never a revert to a
lower one. The reconciler refuses any desired state below the highest the *server* has offered
this process session (`crates/failproofaid/src/cloud_policies.rs`, grep
`deployment rollback from`). It anchors server-side deliberately: anchoring on the local
`active.json` made that file an attacker-controlled permanent denial of service — one write with
a high number and every real deployment is refused forever.

## Fail-closed, and why a blocked agent cannot fix it

Two different mechanisms, often confused:

- **Daemon.** Once `daemon.configured === true` in `~/.failproofai/config.json`, the daemon is the
  only evaluator — no in-process fallback, because a fallback is a second policy engine reachable
  by breaking the first. Both `unreachable` and `protocol-mismatch` force a machine-wide deny
  (`bin/failproofai.mjs`, grep `is the ONLY evaluator`). An unreadable `config.json` reads as *not*
  configured and therefore does **not** fail closed — a deliberate inversion so a truncated file
  does not deny every tool call.
- **Pack.** Narrower and additive — see `packs.md`.

**Every recovery message names commands the agent cannot run.** `block-failproofai-commands`
denies every `failproofai` invocation from a tool call, unconditionally, and it is the one policy
that registers regardless of config, an active pause, or a config that failed to parse. A human
has to open a terminal. Do not retry the blocked action: fail-closed means the system could not
establish it was safe.

## Consent

The line is **scope**, and it holds on both lanes.

| Action | Needs asking? |
|---|---|
| A policy file inside the repo the user asked you to fix | no |
| `policies --install … --scope project` in that repo | no |
| `policies --install` at **user scope** | **yes** — wires hooks into every project on the machine |
| Editing `~/.failproofai/policies-config.json` | **yes** — a deny there fires everywhere |
| Setting `customPoliciesPath` globally | **yes** — silently activates policy files across all projects |
| `fp fleet deploy` to a machine the user named | no, if they asked for the rollout |
| `fp fleet deploy` across machines they did not name | **yes** |
| `fp policies disable` / `delete` | **yes** — both change what every carrier enforces |

A question — "should this be enforced?", "is this protected?" — asks for an answer, not a change.
Recommend the wider fix in words and let them decide. Being right about what should happen is not
authorization to make it happen.

Two harnesses have no project scope at all: their config is user-scope only, so any rule for them
is machine-wide by construction and needs asking for. `failproofai-policy-author`'s
`references/harnesses.md` lists the scopes each CLI supports.
