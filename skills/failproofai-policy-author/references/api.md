# Policy API reference

## Contents

- [The policy object](#the-policy-object) · [Context](#context) · [Decisions](#decisions)
- [Events](#events) · [Filtering by tool](#filtering-by-tool)
- [Execution model](#execution-model) · [Configuration](#configuration)

> Source pointers below are paths inside the failproofai package. In a project that
> installed it, they live under `node_modules/failproofai/`; in a source checkout,
> at the repo root. The `grep` anchors work either way.

Everything here is exported from `src/index.ts` — that file is the entire public surface:

```ts
export { customPolicies, getCustomHooks, clearCustomHooks } from "./hooks/custom-hooks-registry";
export { allow, deny, instruct } from "./hooks/policy-helpers";
export type { PolicyContext, PolicyResult, CustomHook, PolicyDecision, PolicyFunction } from "./hooks/policy-types";
```

## The policy object

`CustomHook` — `src/hooks/policy-types.ts`, grep `interface CustomHook`:

```ts
export interface CustomHook {
  name: string;
  description?: string;
  match?: {
    events?: HookEventType[];
  };
  fn: (ctx: PolicyContext) => PolicyResult | Promise<PolicyResult>;
}
```

Registered with `customPolicies.add(hook)`. That is the whole registration surface — no
remove, no update, and **no validation of any kind** — `custom-hooks-registry.ts` (grep
`getRegistry`) is a bare array push.

## Context

`PolicyContext` — `policy-types.ts`, grep `interface PolicyContext`:

```ts
export interface PolicyContext {
  eventType: HookEventType;
  payload: Record<string, unknown>;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  session?: SessionMetadata;
  params?: Record<string, unknown>;
  cli?: IntegrationType;   // which agent CLI fired this; mirrors session.cli
}
```

- `ctx.toolInput` holds the tool's arguments — `command` for Bash, `file_path`/`content` for
  Write, `old_string`/`new_string` for Edit, `pattern` for Grep. These keys are already
  canonicalized across all 12 supported CLIs, so you write them once.
- `ctx.session?.cwd` is the working directory.
- `ctx.payload` is the raw hook payload if you need something not surfaced above.

## Decisions

`PolicyResult` — `policy-types.ts`, grep `interface PolicyResult`:

```ts
export interface PolicyResult {
  decision: "allow" | "deny" | "instruct";
  reason?: string;
  message?: string;
}
```

Helpers (`policy-helpers.ts`, the complete file):

```ts
export function allow(reason?: string): PolicyResult { ... }   // reason optional
export function deny(reason: string): PolicyResult { ... }     // reason required
export function instruct(reason: string): PolicyResult { ... } // reason required
```

- **`allow`** — let it through. Also the correct return when your policy does not apply.
- **`deny`** — block it. `reason` is shown to the agent and the user.
- **`instruct`** — let it through but inject guidance into the agent's next turn. Only
  properly supported on Claude Code, Devin and Antigravity; degrades to a stderr note on
  Hermes, Goose, OpenClaw and Pi. Fine for a local skill; do not rely on it if the policy
  will be distributed.

### The `message` field is currently inert — sanitize works by blocking, not replacing

The builtin sanitizers return `deny` plus a `message` that *looks like* a replacement —
`sanitizeJwt` in `builtin-policies.ts`:

```ts
return {
  decision: "deny",
  reason: "JWT token detected in tool output",
  message: "[REDACTED: JWT token removed by failproofai]",
};
```

**But the evaluator never consumes `PolicyResult.message`** (verified 2026-07-24: the deny
response in `policy-evaluator.ts` is built from `reason` alone; the only `.message` read in
that file is `err.message`). What actually happens on a sanitize deny: the tool output is
**blocked entirely** and the model sees the block reason instead. The secret is still
protected — by omission, not redaction — but the model also loses the rest of that output.
Do not promise users "the output is scrubbed and the rest passes through"; it is not.

Two practical consequences:
- Put everything useful into `reason` — it is the only channel that surfaces.
- For output scrubbing, check `sanitize-api-keys`'s **`additionalPatterns` param first**
  (`{regex, label}` entries) — builtin-first applies to sanitizers too. A custom sanitizer
  is only needed when the pattern-per-output-shape doesn't fit that param.

The `deny()` helper cannot set `message` anyway; if you do set it (future-proofing for when
the evaluator honors it), return the raw object literal.

## Events

`HookEventType` — `src/hooks/types.ts`, grep `HOOK_EVENT_TYPES`. The ones worth knowing:

**"Can block" is a property of the (event, CLI) pair, not of the event.** The column below
is the best case — the harnesses where the verdict is read at all. On other CLIs the same
event fires, your policy runs, and the deny is discarded. `references/harnesses.md` has the
per-CLI matrix and is generated from `ENFORCEMENT_CAPABILITY`; check it before promising
enforcement.

| Event | Fires | Can block? |
|---|---|---|
| `PreToolUse` | Before a tool runs | **Yes, on every CLI that has it** — the main enforcement point, and the only universal one |
| `PostToolUse` | After a tool returns | **Only on Codex and Copilot**, and even there it replaces the *result* the model reads — the tool already ran. Observation everywhere else, Claude Code included |
| `UserPromptSubmit` | On user input | Yes on 8 of 12; discarded on OpenCode, Antigravity and Goose; not installed on Hermes |
| `Stop` | Agent about to finish its turn | Yes on 8 — deny forces another turn. Discarded on Pi; **not installed on Hermes or Goose**; unverified on OpenCode |
| `SessionStart` / `SessionEnd` | Session boundaries | No — observation on every CLI that installs them (not Antigravity; `SessionEnd` also absent on Codex) |
| `SubagentStop` | Subagent returns | Claude, Codex and Copilot only; unverified on Cursor; not installed on 5. **Discarded on Hermes, Factory and OpenClaw** — this row is the one that was wrong in prose for months |
| `PermissionRequest` / `PermissionDenied` | Permission flow | Claude, Codex, Copilot, Devin. **OpenCode declares `permission.ask` but never invokes it** — the policy does not run |

Full list also includes `PostToolUseFailure`, `StopFailure`, `Notification`,
`SubagentStart`, `TaskCreated`, `TaskCompleted`, `PreCompact`, `PostCompact`, `FileChanged`,
`CwdChanged`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `Elicitation`,
`ElicitationResult`, `UserPromptExpansion`, `PostToolBatch`, `InstructionsLoaded`,
`TeammateIdle`, `Setup`.

## Filtering by tool

`CustomHook.match` publicly declares **only `events`**. Filter on the tool inside `fn`:

```js
fn: async (ctx) => {
  if (ctx.toolName !== "Bash") return allow();
  ...
}
```

An undocumented `match.toolNames` does work at runtime (`handler.ts`, grep `hook.match ??` passes `match`
straight through, and `policy-registry.ts`, grep `getPoliciesForEvent` filters on it), but it is absent from the
public type and could be typed away. Prefer filtering in `fn`.

## Execution model

- Custom policies run at **priority -1**, i.e. after all builtins.
- Each `fn` gets a **10-second timeout**. Timeout or throw → `{decision: "allow"}`.
- Namespaced as `custom/<name>`, `.failproofai-project/<name>` or `.failproofai-user/<name>`.

## Configuration

`.failproofai/policies-config.json` — `HooksConfig`, `policy-types.ts`, grep `interface HooksConfig`:

```ts
export interface HooksConfig {
  enabledPolicies: string[];                              // builtins, by short name
  llm?: LlmConfig;
  policyParams?: Record<string, Record<string, unknown>>; // keyed by short name
  customPoliciesPath?: string;
  customPoliciesEnabled?: boolean;                        // absent = enabled
}
```

Builtins are enabled **purely by presence** of the short name in `enabledPolicies` — there
is no per-policy enabled/disabled object, and omission means off.

Merged across three scopes, in precedence order: project `{cwd}/.failproofai/` → local →
global `~/.failproofai/` (`hooks-config.ts`, grep `readMergedHooksConfig`).
