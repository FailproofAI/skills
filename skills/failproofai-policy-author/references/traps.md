# Silent failure modes

## Contents

1. [The filename convention](#1-the-filename-convention)
2. [`customPoliciesEnabled` now works, first-scope-wins](#2-custompoliciesenabled-false-now-works--and-it-resolves-first-scope-wins)
3. [Everything is fail-open](#3-everything-is-fail-open)
4. [A deny does not prove *your* deny](#4-a-deny-in-your-test-does-not-prove-your-policy-denied)
5. [Validation is nil](#5-validation-is-essentially-nil)
6. [Unsatisfiable Stop gates loop](#6-a-stop-gate-that-cannot-be-satisfied-loops-forever)
7. [Builtins enabled by presence](#7-builtins-are-enabled-by-presence-not-by-a-flag)
8. [`ctx.params` always empty](#8-ctxparams-is-always-empty-for-custom-policies)
9. [Sanitizers block, not redact](#9-sanitizers-block-they-do-not-redact--and-deny-cannot-set-message-anyway)

Every item here is a documented, already-been-hit failure where a policy looks installed and
enforces nothing. Read this before reporting any policy as working.

## 1. The filename convention

`CONVENTION_FILE_RE = /policies\.(js|mjs|ts)$/` — `custom-hooks-loader.ts`, grep `CONVENTION_FILE_RE`.

A file in `.failproofai/policies/` named `block-foo.mjs` is **silently skipped**. Only names
ending in `policies.js`, `policies.mjs` or `policies.ts` load.

| Name | Loads? |
|---|---|
| `block-foo-policies.mjs` | yes |
| `security-policies.mjs` | yes |
| `policies.mjs` | yes |
| `block-foo.mjs` | **no** |
| `foo-policy.mjs` | **no** (singular) |

This is not hypothetical. From the source comment at custom-hooks-loader.ts — grep findSkippedPolicyFiles):

> This repo shipped `block-version-bumps.mjs` that way, so the guard written after a bad
> version bump had never once run.

`findSkippedPolicyFiles()` (custom-hooks-loader.ts — grep findSkippedPolicyFiles)) exists solely to catch this, but its warnings go
only to the hook log, which nobody reads. **Always check the filename before anything else.**

## 2. `customPoliciesEnabled: false` now works — and it resolves first-scope-wins

**This trap has been fixed upstream. The entry stays because the old behaviour is still
described in older notes, and because the resolution rule is itself a trap.**

For a long time this key was a silent no-op: `readMergedHooksConfig` hand-built its return
object and omitted the key, so the loader always saw `undefined` and convention policies
loaded regardless. That is no longer true — `hooks-config.ts` (grep `customPoliciesEnabled`)
now propagates it, `handler.ts` passes it through, and `custom-hooks-loader.ts` (grep
`conventionEnabled`, `opts?.customPoliciesEnabled !== false`) honours it.

Verified empirically: a sandbox project with a canary policy and `"customPoliciesEnabled":
false` produces **no output**; flipping the same config to `true` fires the canary.

So a repo with this flag set to `false` is **not** enforcing its convention policies — the
opposite of what this entry used to say. If a policy you just wrote does nothing, this is now
a real suspect, and the loader logs
`convention policies: DISABLED via customPoliciesEnabled:false`.

**The resolution is first-scope-wins, not any-scope-wins** (`hooks-config.ts`, grep
`customPoliciesEnabled`):

```ts
project.customPoliciesEnabled ?? local.customPoliciesEnabled ?? global_.customPoliciesEnabled
```

The first scope that *sets* the key decides, and the others are never consulted. This is the
opposite of `enabledPolicies`, which is a **union** across all three (§7). Two keys in one
file merging by opposite rules is worth checking rather than assuming.

Note the explicit `customPoliciesPath` config key is **not** gated by this flag
(custom-hooks-loader.ts — grep customPoliciesPath)) — only convention discovery is.

## 3. Everything is fail-open

| Failure | Result |
|---|---|
| File not found | zero hooks, logged only |
| Syntax error | zero hooks, logged only |
| Throw at import time | zero hooks, logged only |
| Throw inside `fn` | `{decision: "allow"}` |
| `fn` exceeds 10s | `{decision: "allow"}` |

Classified for telemetry as `module_not_found` / `syntax_error` / `runtime_error`
(custom-hooks-loader.ts — grep errorType)), then swallowed. Nothing fails loudly.

The consequence: **silence is not success.** A policy that was never loaded and a policy
that correctly allowed an action produce identical observable behavior. This is why the
verification step in SKILL.md's *Verify it fires* is mandatory, not optional.

## 4. A deny in your test does not prove *your* policy denied

Every enabled policy sees every matching event. When a test case blocks, some policy blocked
— not necessarily yours. A rule that matches nothing can sit behind a green suite
indefinitely.

Observed live: a heredoc case written to test a "no hardcoded localhost" policy passed,
but the deny came from the builtin `protect-env-vars` reacting to the word `export` in the
payload. The localhost rule was entirely unproven while reporting green.

```
cat <<EOF > a.js
export const API = "http://localhost:3000";
EOF
→ deny: "Command exports environment variable"      ← protect-env-vars, not your policy
```

**Always attribute the deny.** The reason string names the responsible policy's message, so
assert on it rather than on the fact that something blocked:

```js
if (got.decision !== "deny" || !got.reason.includes("<text unique to your policy>"))
  fail("blocked, but not by this policy");
```

Two cheap ways to avoid the trap:

- Write test payloads that avoid unrelated triggers — no `export`, no `sudo`, no `.env`, no
  `curl … | sh` unless that is what you are testing.
- Test against a config with `enabledPolicies: []` so nothing else can fire. This is what
  `test-policy.mjs --policy <file>` does — its sandbox config enables zero builtins, so any
  deny is necessarily yours.

## 5. Validation is essentially nil

`failproofai p -i -c <file>` (`manager.ts`, grep `Validated`) executes the file and counts
`customPolicies.add()` calls. It does **not** check:

- that the hook object has the right shape
- that `name` is unique (duplicates silently coexist)
- that `match.events` are real event names
- that `fn` returns a valid `PolicyResult`

`customPolicies.add()` is a bare array push with no validation
(`custom-hooks-registry.ts`, grep `add(hook`). "Validated 1 custom hook(s)" means "the file ran and
called add() once" — nothing more.

## 6. A Stop gate that cannot be satisfied loops forever

Denying at `Stop` forces another turn. If the condition can never become true in the current
environment, the agent retries, fails, and never exits. Before enabling any
`require-*-before-stop` builtin — or authoring a Stop policy — check the condition is
actually reachable **in the project you are working in**:

| Gate | Reachable only if |
|---|---|
| `require-commit-before-stop` | always (local git) |
| `require-push-before-stop` | a remote exists **and** credentials work |
| `require-pr-before-stop` | `gh` authenticated, remote is GitHub |
| `require-no-conflicts-before-stop` | base branch fetchable |
| `require-ci-green-before-stop` | CI configured **and** runs on push |

Cheap check:

```bash
git remote -v                       # no output → push/PR/CI gates cannot pass
git push --dry-run 2>&1 | head -2   # auth failure → same
gh auth status 2>&1 | head -3
```

**This does not generalise across projects.** A gate that loops in one repo is correct in
another. Evaluate per project rather than carrying a verdict over.

This bites in practice: a repo with no working push credentials cannot ever satisfy
`require-push-before-stop`, so enabling it there produces an agent that denies at Stop,
retries, and never exits. Check reachability in the project in front of you — the same gate
is correct in a repo that can push.

The same reachability rule applies to custom Stop policies — always `try/catch` external
calls and `return allow()` on failure, so an unavailable tool degrades to letting the turn
end rather than trapping it.

## 7. Builtins are enabled by presence, not by a flag

`enabledPolicies` is a `string[]`. Omission means off. There is no
`{"block-rm-rf": false}` form — to disable, remove the string.

Params live in a **sibling** `policyParams` object keyed by the same short name, not nested
inside the policy entry:

```json
{
  "enabledPolicies": ["block-read-outside-cwd"],
  "policyParams": {
    "block-read-outside-cwd": { "allowPaths": ["/tmp"] }
  }
}
```

A param set for a policy that is not in `enabledPolicies` does nothing.

## 8. `ctx.params` is always empty for custom policies

`PolicyContext` exposes `params`, and `policies-config.json` has a `policyParams` map — so it
looks like a custom policy can be configured from config. It cannot.

`POLICY_PARAMS_MAP` (`policy-evaluator.ts`, grep `POLICY_PARAMS_MAP`) is built **only** from `BUILTIN_POLICIES`
entries that declare a `params` schema. A custom hook has no schema, so it falls to the
else-branch at policy-evaluator.ts — grep without schema get empty params):

```ts
// Custom hooks and policies without schema get empty params
ctx = { ...baseCtx, params: {} };
```

Adding `policyParams: { "my-custom-policy": {...} }` to config does nothing — silently.

**Workaround:** hardcode the values as module constants in the policy file, or read your own
config file / env var inside `fn`. The file is real JS, so anything is available.

## 9. Sanitizers block, they do not redact — and `deny()` cannot set `message` anyway

Two layered surprises. First, the `message` field of `PolicyResult` is not settable through
the exported `deny()` helper — a sanitizer needs the raw object literal. Second, and bigger:
**the evaluator never consumes `message` at all** (verified live 2026-07-24 — the deny
response in `policy-evaluator.ts` is built from `reason` only). The builtins' own
`[REDACTED: …]` messages are dead code.

So a sanitize deny on `PostToolUse` blocks the *entire* tool output; the model sees the
block reason, never a redacted version. Protection holds — by omission — but do not tell a
user "the token is scrubbed and the rest passes through." Put anything the agent needs into
`reason`, and prefer `sanitize-api-keys.additionalPatterns` over authoring. See `api.md`.
