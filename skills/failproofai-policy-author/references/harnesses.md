# Harness capabilities (what enforces where)

**Generated — do not hand-edit.** Regenerate with:

```bash
node "$SKILL_DIR/scripts/sync-harnesses.mjs"   # $SKILL_DIR = this skill's folder
```

A policy that returns `deny()` does not necessarily stop anything. Whether it does
depends on **which agent CLI fired the hook** — the same policy is hard enforcement on
one harness and a no-op on another. This file is the lookup you do *before* choosing an
event, generated from failproofai's own source so it cannot drift away from the code.

Read `SKILL.md` → *Pick an event the harness can actually enforce* for how to use it.

## The three states

| Cell | Meaning | What to do |
|---|---|---|
| **block** | The verdict is read at a call site that prevents the action or forces another turn | Real enforcement. `deny()` works |
| observe | The event fires and your policy runs, but the verdict is **discarded** | Never `deny()` here — the action proceeds and the user thinks they are protected |
| ? | Installed, but never traced to a consuming call site | Treat as unproven. Say so; do not promise enforcement |
| — | failproofai does not install this event for this CLI | The policy never runs at all |

`?` is not a hedge — it is the honest answer. enforcement-capability.ts only lists rows
traced to source, vendor docs, or a recorded live probe, and its header is explicit that
**absent means unknown, not "block"**. Do not round a `?` up.

## Matrix

Rows are canonical event names (what you put in `match.events`). Columns are the 12
supported CLIs.

| Event | claude | codex | copilot | cursor | opencode | pi | hermes | openclaw | factory | devin | agy | goose |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `SessionStart` | observe | observe | observe | observe | observe | observe | observe | observe | observe | observe | — | observe |
| `SessionEnd` | observe | — | observe | observe | observe | observe | observe | observe | observe | observe | — | observe |
| `UserPromptSubmit` | **block** | **block** | **block** | **block** | observe | **block** | — | **block** | **block** | **block** | observe | observe |
| `PreToolUse` | **block** | **block** | **block** | **block** | **block** | **block** | **block** | **block** | **block** | **block** | **block** | **block** |
| `PermissionRequest` | **block** | **block** | **block** | — | observe | — | — | — | — | **block** | — | — |
| `PostToolUse` | observe | **block** | **block** | observe | observe | observe | observe | observe | observe | observe | observe | observe |
| `PostToolUseFailure` | observe | — | observe | — | — | — | — | — | — | — | — | — |
| `Notification` | observe | — | observe | — | — | — | — | — | observe | — | — | — |
| `SubagentStart` | observe | observe | — | — | — | — | — | — | — | — | — | — |
| `SubagentStop` | **block** | **block** | **block** | ? | — | — | observe | observe | observe | — | — | — |
| `Stop` | **block** | **block** | **block** | **block** | ? | observe | — | **block** | **block** | **block** | **block** | — |
| `PreCompact` | **block** | observe | observe | — | — | — | — | observe | **block** | — | — | — |
| `PostCompact` | observe | observe | — | — | — | — | — | — | — | — | — | — |

Claude-only events (`TaskCreated`, `Elicitation`, `WorktreeRemove`, `ConfigChange`, …)
are omitted from the matrix — they are `—` everywhere else by construction. Their
capability is listed under *claude* below.

## The one rule that follows from this table

**`PreToolUse` is the only event that blocks on every harness that has it.** Every other
row has at least one CLI where a deny evaporates. If a rule can be expressed as a
`PreToolUse` gate, express it there — a `PostToolUse` or `Stop` version of the same rule
is enforcement on some of the fleet and theatre on the rest.

## Per-CLI detail

Each row below carries the evidence from the source table. The caveats matter as much as
the verdict: several `block` rows only hold under conditions you have to check.

### `claude`

*Config scopes:* `user`, `project`, `local`

*Evidence:* Closed source, but the shipped launcher embeds its minified JS as plaintext. Offsets are BYTE offsets into the shipped claude 2.1.220 launcher bundle. The hook RUNNER is event-agnostic (exit 2 -> blockingError @259223339); all asymmetry lives in the ~29 call sites that read or ignore it.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `ConfigChange` | — | **block** | slt @259171700 -> consumer @251465990 skips the reload. CAVEAT: source==="policy_settings" is force-unblocked (MDM immune) |
| `Elicitation` | — | **block** | oOt @259172011 -> $_o @253296308 -> MCP handler U_y @253294456 returns {action:"decline"} to the server |
| `ElicitationResult` | — | **block** | iOt @259172485 -> N_o @253296535 / Zbo @253568095 force {action:"decline"}. Vetoes the response, does NOT stop the agent |
| `PermissionRequest` | — | **block** | @255767400 runHooks reads permissionRequestResult -> buildDeny. NOTE exit 2 is IGNORED here (docs are wrong); we emit hookSpecificOutput.decision.behavior:"deny" which IS the honoured shape — do not "simplify" to exit 2 |
| `PostToolBatch` | — | **block** | @254577316 -> yields hook_stopped_continuation and RETURNS from the query generator. Tools in the batch already ran |
| `PreCompact` | — | **block** | MEe @259170280 blockedBy -> consumers @254317851 / @254328121 return early; compaction does not run |
| `PreToolUse` | — | **block** | @256826565 gan() -> behavior==="deny" short-circuits the permission pipeline; tool.call never reached (@256827907) |
| `Stop` | — | **block** | @254572503 blockingErrors -> stopHookActive + `continue` re-enters the loop. CAP: CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 8); discarded on end-turn paths (@254511900) |
| `SubagentStop` | — | **block** | @259180818 VEe emits SubagentStop when agentId set -> same consumer @254572503. Same cap + same end-turn discard |
| `TaskCompleted` | — | **block** | @254518449 -> same honoured consumer @254572503. GATE: teammate mode only (oy() @249372028) |
| `TaskCreated` | — | **block** | TaskCreate.call @256302400: blockingError -> task deleted (yAo) + tool throws |
| `TeammateIdle` | — | **block** | @254518714 -> same consumer @254572503. Same teammate-mode gate |
| `UserPromptExpansion` | — | **block** | producer @254678081, real consumer @254672418 `if("blocked" in C) return C.blocked`. Slash-command / MCP-prompt only |
| `UserPromptSubmit` | — | **block** | @262298150 blockingError -> {shouldQuery:false} early return; prompt never sent to the model |
| `CwdChanged` | — | observe | vtn @259173188 -> zop @259172968 reads only watchPaths/systemMessage |
| `FileChanged` | — | observe | Atn @259173298 -> same zop consumer |
| `InstructionsLoaded` | — | observe | nPt @259173437 — return value not assigned |
| `Notification` | — | observe | h9 @259174090 — return value not assigned |
| `PermissionDenied` | — | observe | @256829448 reads ONLY hookSpecificOutput.retry; also fires only for classifier==="auto-mode" |
| `PostCompact` | — | observe | xpt @259170833 builds a display message; `blocked` never read (contrast MEe/PreCompact directly above it) |
| `PostToolUse` | — | observe | OVERTURNED from "block". We emit hookSpecificOutput.additionalContext (policy-evaluator.ts:520-534) -> man's additionalContexts branch @256141810, never blockingError; and the tool already ran either way |
| `PostToolUseFailure` | — | observe | OVERTURNED. han @256143680 yields only cancelled / blocking_error / additional_context; consumer @256840799 just appends messages after the failed tool result. No stop channel exists |
| `SessionEnd` | — | observe | TFt @259174994 reads only !succeeded -> stderr passthrough; `blocked` never read |
| `SessionStart` | — | observe | @254090768 blockingError -> Pur() = hook_non_blocking_error; session proceeds. Only additionalContext has effect |
| `Setup` | — | observe | @254092164 -> same Pur() downgrade |
| `StopFailure` | — | observe | zpt @~259180670 discards the EM() return entirely. Docs concur: "output and exit code are ignored" |
| `SubagentStart` | — | observe | @254689000 -> same Pur() downgrade; the subagent launches anyway |
| `WorktreeRemove` | — | observe | Zor @259183361 only records whether some hook succeeded; a deny just logs |
| `WorktreeCreate` | — | ? | not traced — unverified |

> WorktreeCreate DELIBERATELY OMITTED: ODt @259182432 is a path PROVIDER, not a gate — with no stdout it throws "hook succeeded but returned no worktree path", so an ALLOW aborts creation exactly like a deny. Degenerate, not a capability. Fix the bug (emit a path on allow) before classifying it.

Tool names and input keys arrive already canonical — no mapping needed.

### `codex`

*Config scopes:* `user`, `project`

*Evidence:* openai/codex @fe01054a. Every verdict funnels through codex-rs/core/src/hook_runtime.rs.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PermissionRequest` | `permission_request` | **block** | tools/approvals.rs:220 Deny -> ReviewDecision::denied. CAVEAT only consulted when the call reaches the approval path (orchestrator.rs:168 Skip bypasses it) |
| `PostToolUse` | `post_tool_use` | **block** | FIXED: we now emit top-level {decision:"block",reason}. LIVE_PROBE codex 0.147.0 A/B (identical prompt+hook, only the shape differs): block shape -> `hook: PostToolUse Blocked` + codex_core::tools::router error=<reason>, and the reason REPLACES the tool result (the model never saw the real stdout); hookSpecificOutput -> `hook: PostToolUse Completed`, model read stdout verbatim. Result-replacement, not prevention — the tool already ran. NOTE the other codex rows below cite output_parser.rs / hook_runtime.rs / tools/registry.rs paths that DO NOT EXIST in 0.147.0 (hooks live at hooks/src/{engine,events}/…); they are unre-verified since fe01054a |
| `PreToolUse` | `pre_tool_use` | **block** | tools/registry.rs:528 PreToolUseHookResult::Blocked -> FunctionCallError::RespondToModel; handler never runs. CAVEAT hook_runtime.rs:202 an empty reason silently degrades to Continue |
| `Stop` | `stop` | **block** | events/stop.rs:303 Some(2) -> should_block + continuation_prompt; turn.rs:473-489 records it and `continue`s. CAVEAT turn.rs:490 a block with no prompt is warned + ignored |
| `SubagentStop` | `subagent_stop` | **block** | shared parse_completed (stop.rs:202) + same consumer turn.rs:473. CAVEAT hook_runtime.rs:345 — only ThreadSpawn subagents dispatch it; all other SubAgent sources never run the hook |
| `UserPromptSubmit` | `user_prompt_submit` | **block** | events/user_prompt_submit.rs:226 Some(2)+stderr -> should_stop; turn.rs:588 skips record_pending_input, turn.rs:237 returns. CAVEAT turn.rs:603 — a co-submitted accepted message lets the turn proceed |
| `PostCompact` | `post_compact` | observe | compact.rs:349-363 same structure; latent block needs {"continue":false} (-> compact.rs:216). Inert as we emit |
| `PreCompact` | `pre_compact` | observe | compact.rs:246-260 no Some(2) arm; latent block needs {"continue":false} (-> core/src/compact.rs:190 TurnAborted). Inert as we emit |
| `SessionStart` | `session_start` | observe | events/session_start.rs:243-322 has NO Some(2) arm — our exit-2 deny is logged as HookRunStatus::Failed. CLI blocks only on exit 0 + {"continue":false} (session_start.rs:273 -> turn.rs:233) |
| `SubagentStart` | `subagent_start` | observe | permanently unblockable: session_start.rs:273 guard excludes it, output schema has no `decision`, vendor doc says continue:false does not stop it |

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `write_stdin` |
| `Edit` | `apply_patch` |

### `copilot`

*Config scopes:* `user`, `project`

*Evidence:* Closed source; vendor build ships readable JS. Offsets are BYTE offsets into the @github/copilot-linux-x64 app.js (c71/ = 1.0.71, copilot/ = 1.0.68). CRITICAL: exit 2 is NEVER a deny channel on copilot, for any event (runtime.node@60056587 "Hook command exited with code 2 (warning)").

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PermissionRequest` | — | **block** | FIXED: we now emit the FLAT {behavior,message} copilot parses (normalizer CMn @179042 -> mapper h4t @2686538). Was inert — the Codex-shaped nested hookSpecificOutput.decision normalized to {} |
| `PostToolUse` | — | **block** | FIXED: we now emit top-level {decision:"block",reason}. Re-read in the SHIPPED 1.0.78 app.js: BOTH postToolUse call sites gate on vK = t => t?.decision==="block" && typeof t.reason==="string" -> "Tool result blocked by {policy hook\|hook}" / `Tool result blocked: ${reason}`. vK fails closed on a missing or non-string reason. Result-rewrite, not prevention — the tool already ran (vendor docs still say "Can block? No", which is true of the SIDE EFFECT, not of the result the model reads) |
| `PreToolUse` | — | **block** | 1.0.68 app.js@2878277 permissionDecision==="deny" -> resultType:"denied"; 1.0.71 moved to Rust, runtime.node@60059067 "Denied by preToolUse hook". Corroborated LIVE on 1.0.71 (session events success:false code:denied) + daily integration-suite probe |
| `Stop` | — | **block** | 1.0.71 app.js@2855430 agentStop: decision==="block" && string reason -> enqueueUserMessage(reason). We emit exactly that shape |
| `SubagentStop` | — | **block** | 1.0.71 app.js@1074101 subagentStop: decision==="block" && reason -> `continue` re-runs the subagent turn. CAVEAT skipped entirely for isSidekick subagents |
| `UserPromptSubmit` | — | **block** | FIXED: we now emit {decision:"block",reason} at exit 0 (gate V$t @2547438, consumer @2823018). Was inert — we sent exit 2 + stderr, which copilot logs as a warning for EVERY event and never treats as a deny |
| `Notification` | — | observe | 1.0.71 app.js@2746820 reads only additionalContext |
| `PostToolUseFailure` | — | observe | 1.0.68 app.js@2883424 and @3038111 destructure only additionalContext |
| `PreCompact` | — | observe | 1.0.71 app.js@2758186 and @2852753 — result unassigned at both call sites |
| `SessionEnd` | — | observe | 1.0.71 app.js@2627263 `.then(()=>{})` — return explicitly thrown away |
| `SessionStart` | — | observe | 1.0.71 app.js@2836633 reads ONLY additionalContext |

> ErrorOccurred is installed but has no canonical HookEventType, so it cannot be keyed here. It is observe: 1.0.71 app.js@2846297, result unassigned.

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `bash`, `powershell`, `list_bash`, `read_bash`, `stop_bash`, `write_bash`, `list_powershell`, `read_powershell`, `stop_powershell`, `write_powershell` |
| `Edit` | `edit`, `apply_patch`, `str_replace_editor` |
| `Glob` | `glob` |
| `Grep` | `grep`, `rg` |
| `LS` | `ls` |
| `Read` | `read`, `view`, `show_file` |
| `WebFetch` | `web_fetch` |
| `Write` | `write`, `create` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `path` |
| `Write` | `file_path` | `path` |
| `Write` | `content` | `file_text` |
| `Edit` | `file_path` | `path` |
| `Edit` | `old_string` | `old_str` |
| `Edit` | `new_string` | `new_str` |

### `cursor`

*Config scopes:* `user`, `project`

*Evidence:* Closed source; local install ships webpack-minified JS. Offsets are CHAR offsets into the shipped cursor-agent 2026.07.16-899851b bundle.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | `preToolUse` | **block** | 3143.index.js char 26967 permission==="deny" -> {type:"rejected"}; second MCP consumer char 42084 |
| `Stop` | `stop` | **block** | 1931.index.js char 881820 followup_message queued as the next user message. CAPS: loop_limit default 5 (index.js char 4123300); consumed ONLY on the status:"completed" path — user-abort (char 870298) and turn-error (char 883549) discard it |
| `UserPromptSubmit` | `beforeSubmitPrompt` | **block** | FIXED: we now emit {continue:false,user_message} (1931.index.js char 887883 — the only block key). Was inert: {permission:"deny"} validates as an unknown-key object and is dropped on this event |
| `PostToolUse` | `postToolUse` | observe | 3143.index.js char 26339 fireSuccessAsync reads only additional_context; validator accepts nothing else (index.js char 4126700) |
| `SessionEnd` | `sessionEnd` | observe | 1931.index.js char 724540 — result assigned to nothing |
| `SessionStart` | `sessionStart` | observe | 1931.index.js char 731566 consumes only env + additional_context; `continue` never read even though Cursor's own q() builds it |
| `SubagentStop` | `subagentStop` | ? | not traced — unverified |

> SubagentStop OMITTED: producer exists (index.js char 3769676 forwards followupMessage) and vendor docs describe loop-style follow-ups, but no code in the shipped install ever CONSTRUCTS a subagentStop request, so the consumer is outside the bundle. unknown.

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `Shell` |

### `opencode`

*Config scopes:* `user`, `project`

*Evidence:* sst/opencode @7565e035 (v1.18.9); every finding re-checked at tag v1.14.33.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | `tool.execute.before` | **block** | session/tools.ts:106-110 trigger runs BEFORE item.execute (:111) inside run.promise; a throw is an Effect defect that kills the fiber. Upstream test test/tool/code-mode.test.ts:428 proves the tool body never executed |
| `PermissionRequest` | `permission.ask` | observe | ☠ DEAD HOOK: permission.ask is DECLARED (packages/plugin/src/index.ts:261) and documented upstream, but NEVER INVOKED — the only two dispatch sites are hook["event"] (:255) and Plugin.trigger (:288), and permission.ask is not among the 13 names passed to .trigger(). The policy does not even run. See §5.3 for the copy hazard |
| `PostToolUse` | `tool.execute.after` | observe | session/tools.ts:121-125 sits after item.execute; a throw replaces the output with a tool-error the model sees, but the write/command already happened |
| `SessionEnd` | `session.deleted` | observe | plugin/index.ts:255 — same void dispatch |
| `SessionStart` | `session.created` | observe | plugin/index.ts:255 `void hook["event"]?.(…)` — fire-and-forget, return structurally unreadable |
| `UserPromptSubmit` | `message.updated` | observe | plugin/index.ts:255 same void dispatch; and message.updated is published from session.ts:631 AFTER the message is persisted. The real gate is chat.message, which we do not install (§4) |
| `Stop` | `session.idle` | ? | not traced — unverified |

> Stop OMITTED: session.idle's plugin return is definitively discarded (plugin/index.ts:255), so we instead call client.session.prompt(...) out-of-band (integrations.ts:886-897). That SDK route does start a fresh turn, but the composite (alive at idle? one-shot `opencode run`?) is unverified end to end. unknown.

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `bash` |
| `Edit` | `edit`, `apply_patch` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `LS` | `list` |
| `Read` | `read` |
| `TodoRead` | `todoread` |
| `TodoWrite` | `todowrite` |
| `WebFetch` | `webfetch` |
| `WebSearch` | `websearch` |
| `Write` | `write` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `filePath` |
| `Write` | `file_path` | `filePath` |
| `Edit` | `file_path` | `filePath` |
| `Edit` | `old_string` | `oldString` |
| `Edit` | `new_string` | `newString` |
| `Edit` | `replace_all` | `replaceAll` |

### `pi`

*Config scopes:* `user`, `project`

*Evidence:* @earendil-works/pi-coding-agent 0.80.10 installed (d.ts read directly); source cross-read at repo cced6a2 (0.82.1). Identical result shapes.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | `user_bash` | **block** | tool_call: ToolCallEventResult{block,reason} (types.d.ts:766) -> runner.emitToolCall returns on result.block -> agent-loop.ts:626 `if(beforeResult?.block) return createErrorToolResult(...)`; tool never executes. user_bash also maps here and is now FIXED too: the shim returns a full-replacement {result:BashResult} (types.d.ts:772) so the command is not run — {block,reason} had no matching field |
| `UserPromptSubmit` | `input` | **block** | FIXED: the shim now returns {action:"handled"} (InputEventResult, types.d.ts:629) so the prompt is never submitted. Was inert — {block,reason} matched no branch. CAVEAT: `handled` drops the prompt SILENTLY; Pi shows the user nothing, so the shim logs the reason to stderr |
| `PostToolUse` | `tool_result` | observe | tool_result: ToolResultEventResult{content,details,isError,usage} (types.d.ts:778) — no block field; mutation only |
| `SessionEnd` | `session_shutdown` | observe | session_shutdown: same — handler declared with no Result type (types.d.ts:848) |
| `SessionStart` | `session_start` | observe | on(event:"session_start", ExtensionHandler<SessionStartEvent>) — NO Result type param (types.d.ts:842); runner.emit() only consumes returns for session_before_* (runner.ts:787-813) |
| `Stop` | `agent_end` | observe | agent_end: handler has NO Result type (types.d.ts:857) — the turn cannot be retried. Our shim stashes the reason and injects it into the NEXT turn via before_agent_start.systemPrompt (index.ts:458). Real, but it is a next-turn instruction, not a gate |

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `bash` |
| `Edit` | `edit` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `Read` | `read` |
| `Write` | `write` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `path` |
| `Write` | `file_path` | `path` |
| `Edit` | `file_path` | `path` |

### `hermes`

*Config scopes:* `user` — **user scope only.** There is no project config; every rule you add here applies to every project on the machine, so it needs the user's say-so (*Never widen scope on your own initiative*).

*Evidence:* hermes-agent @5771a6e. agent/shell_hooks.py _parse_response is EVENT-GATED: it returns a verdict only for pre_tool_call and pre_verify.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | `pre_tool_call` | **block** | pre_tool_call — the only tool gate; the tool does not run |
| `PostToolUse` | `post_tool_call` | observe | post_tool_call — not in _parse_response's gate |
| `SessionEnd` | `on_session_end` | observe | on_session_end — call site discards the return |
| `SessionStart` | `on_session_start` | observe | on_session_start — not gated in |
| `SubagentStop` | `subagent_stop` | observe | OVERTURNED from CLAUDE.md's "✅ block". Not in _parse_response's gate, AND the call site (tools/delegate_tool.py) discards the return. Customers with a SubagentStop deny had ZERO enforcement |

> Stop: NOT KEYED — `pre_verify` is a real turn-end gate upstream but we do not install it, so no canonical Stop event ever fires for hermes.

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `terminal`, `bash` |
| `Edit` | `patch` |
| `Grep` | `search_files` |
| `Read` | `read_file` |
| `TodoWrite` | `todo` |
| `WebFetch` | `web_extract` |
| `WebSearch` | `web_search` |
| `Write` | `write_file` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `path` |
| `Write` | `file_path` | `path` |
| `Edit` | `file_path` | `path` |

### `openclaw`

*Config scopes:* `user` — **user scope only.** There is no project config; every rule you add here applies to every project on the machine, so it needs the user's say-so (*Never widen scope on your own initiative*).

*Evidence:* openclaw/openclaw @f8ed8ecf (v2026.7.2) + our own shipped shim openclaw-plugin/index.js, which returns undefined for 5 of the 8 hooks.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | `before_tool_call` | **block** | before_tool_call -> shim returns {block:true, blockReason} |
| `Stop` | `before_agent_finalize` | **block** | before_agent_finalize -> shim returns {action:"revise", reason}; the turn re-runs |
| `UserPromptSubmit` | `before_agent_run` | **block** | before_agent_run -> shim returns {outcome:"block", reason} |
| `PostToolUse` | `after_tool_call` | observe | void upstream AND our shim returns undefined |
| `PreCompact` | `before_compaction` | observe | before_compaction — same |
| `SessionEnd` | `session_end` | observe | void upstream AND our shim returns undefined |
| `SessionStart` | `session_start` | observe | void upstream AND our shim returns undefined |
| `SubagentStop` | `subagent_ended` | observe | subagent_ended cannot veto upstream; our shim also returns undefined |

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `exec` |
| `Edit` | `edit` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `Read` | `read` |
| `WebFetch` | `web_fetch` |
| `WebSearch` | `web_search` |
| `Write` | `write` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `path` |
| `Write` | `file_path` | `path` |
| `Edit` | `file_path` | `path` |

### `factory`

*Config scopes:* `user`, `project`

*Evidence:* droid 0.175.1 (the shipped droid binary, ELF not stripped, embedded JS readable). Anchors below are unique grep-able strings in that bundle.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreCompact` | — | **block** | grep `[Compaction] PreCompact hook blocked compaction`: exit 2 or 3 -> returns the uncompacted conversation |
| `PreToolUse` | — | **block** | grep `throwing ToolExecutionControlError`: exit 2 -> throw $SH(stderr); also hookSpecificOutput.permissionDecision==="deny" -> throw $SH, continue===false -> throw LSH, exit 3 -> AgentAbortError. We emit exit 2 + stderr |
| `Stop` | — | **block** | grep `[Agent] Stop hook blocking with decision: block`: {decision:"block",reason} sets the continue flag; grep `[Agent] Stop hook blocking with exit code 2` shows exit 2 is a FALLBACK too (CLAUDE.md says otherwise — harmless, we emit the JSON) |
| `UserPromptSubmit` | — | **block** | executeUserPromptSubmitHooks: `if(B.exitCode===2\|\|B.continue===!1){ … return {prompt,hookContext,blocked:!0} }` — the turn never starts |
| `Notification` | — | observe | `await MR("Notification",{…})` — return unassigned |
| `PostToolUse` | — | observe | exit 2 -> ADD_MESSAGE(role:"system", visibility:"llm_only") with the postToolUseFeedbackPrefix — feedback, not a block; tool already ran. (continue===false / exit 3 WOULD stop, but we emit neither) |
| `SessionEnd` | — | observe | executeSessionEndHooks: `for(let r of n) if(r.exitCode!==0) TH("[Session] SessionEnd hook failed")` — logs only |
| `SessionStart` | — | observe | applySessionStartHookResults consumes only the env file + additionalContext; `if(L.exitCode!==0) TH("[Session] SessionStart hook failed")` just logs |
| `SubagentStop` | — | observe | `await MR("SubagentStop",{…})` — the awaited result is not assigned to anything. Hermes-class: our SubagentStop deny is discarded |

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `Execute` |
| `Edit` | `Edit` |
| `Glob` | `Glob` |
| `Grep` | `Grep` |
| `LS` | `LS` |
| `Read` | `Read` |
| `Task` | `Task` |
| `TodoWrite` | `TodoWrite` |
| `WebFetch` | `FetchUrl` |
| `WebSearch` | `WebSearch` |
| `Write` | `Create` |

### `devin`

*Config scopes:* `user`, `project`

*Evidence:* devin 3000.2.17 is a STRIPPED Rust ELF — no readable call sites. Tier is LIVE_PROBE: 11 recorded runs against the real binary with an isolated --config, each verified by side effect (marker file) AND by absence of the reason in ~/.local/share/devin/cli/{transcripts,sessions.db}.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PermissionRequest` | — | **block** | probe L17: {"decision":"block"} -> marker absent, run aborted; L16: {"decision":"approve"} flipped a rejection into an execution, proving the channel is live. ⚠⚠ CONDITIONAL — see §5.1: never fires under --permission-mode dangerous (L8) and never for auto-approved read-only tools (L18, where a secret leaked) |
| `PreToolUse` | — | **block** | probe L9: "Error: A tool was rejected by the user", RAN_MARKER absent — and it overrode --permission-mode dangerous |
| `Stop` | — | **block** | probe L11 + transcript orchid-pillow.json /steps/8,/steps/10: the reason is injected as a USER message and the agent takes extra turns |
| `UserPromptSubmit` | — | **block** | probe L10: "Prompt blocked: <reason>"; no PreToolUse/Stop hook fired; no model turn |
| `PostToolUse` | — | observe | probe L12: marker created, session finished normally, reason absent from transcript AND sessions.db |
| `SessionEnd` | — | observe | probe L14: session ended normally, reason absent |
| `SessionStart` | — | observe | probe L13: session ran normally, reason absent from transcript and DB |

> Static corroboration (strings @82817071): "Ignoring pre_stop decision type:", "Ignoring permission decision type:", "Blocked by hook", "Denied by hook", "Prevented by hook" — agent-ext/src/hooks/event_handler.rs.

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `exec` |

### `antigravity`

*Config scopes:* `user`, `project`

*Evidence:* agy 1.1.8. Two independent kinds of evidence: live probes, plus the embedded FileDescriptorProto (binary @80315228, exa.hooks_pb) which is AUTHORITATIVE about which fields a response can even carry.

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | — | **block** | probe [1]: `touch PROBE_RAN` never ran; agent reported the tool "blocked with … PROBE: denied". Proto: PreToolHookResult{decision, reason, allow_tool, deny_reason} |
| `Stop` | — | **block** | probe [4]: {"decision":"continue",reason} re-entered the loop AND the agent obeyed the reason (STOP_GATE_PROOF created). Proto: StopHookResult{decision, reason} |
| `PostToolUse` | — | observe | probe [2]: agy logged `unknown field "decision"` (protojson unmarshal failure) 5x and continued. Proto: PostToolHookResult is an EMPTY MESSAGE — nothing is consumable |
| `UserPromptSubmit` | `PreInvocation` | observe | PreInvocation. probe [3]: our {"decision":"deny"} caused `failed to call custom pre-invocation hook … unknown field "decision"`; 4 invocations ran unimpeded. Proto: PreInvocationHookResult carries ONLY inject_steps. (instruct works — probe [5] injectSteps honoured) |

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `run_command` |
| `Edit` | `edit_file`, `replace_file_content` |
| `Glob` | `find_by_name` |
| `Grep` | `grep_search` |
| `LS` | `list_dir` |
| `Read` | `read_file`, `view_file` |
| `WebFetch` | `read_url_content` |
| `WebSearch` | `search_web` |
| `Write` | `write_to_file` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Bash` | `command` | `CommandLine` |
| `Bash` | `cwd` | `Cwd` |
| `Write` | `file_path` | `TargetFile` |
| `Write` | `content` | `CodeContent` |
| `Edit` | `file_path` | `TargetFile` |
| `Read` | `file_path` | `TargetFile` |
| `Read` | `file_path` | `AbsolutePath` |
| `Read` | `file_path` | `File` |

### `goose`

*Config scopes:* `user`, `project`

*Evidence:* block/goose, read AT TAG v1.43.0 (the installed version) as well as HEAD 0b234bdc. Two dispatchers: emit() is fire-and-forget (crates/goose/src/ hooks/mod.rs:295 — the return only feeds a warn! log); emit_blocking() (:364) consumes exit 2 or {"decision":"block","reason"} via deny_reason(:429).

| Event | Native name | Deny does | Evidence / caveat |
|---|---|---|---|
| `PreToolUse` | — | **block** | v1.43.0 agent.rs:1080 emit_blocking -> HookDecision::Deny -> returns Err(ErrorData "Tool call denied by policy hook `<plugin>`: …"); the tool is never dispatched |
| `PostToolUse` | — | observe | v1.43.0 agent.rs:~593 with_post_tool_hook uses emit() — verdict discarded, and it is post-hoc |
| `SessionEnd` | — | observe | goose-cli/src/session/mod.rs:529 and :1294 emit_hook -> emit() — verdict discarded |
| `SessionStart` | — | observe | v1.43.0 agent.rs:1595 emit_hook -> emit() — verdict discarded |
| `UserPromptSubmit` | — | observe | v1.43.0 agent.rs:1609 and :1935 use emit() — verdict discarded |

> Goose HAS a blocking Stop event we do not install — see §4. CLAUDE.md and the policy-evaluator comment both claim "Goose has NO Stop event"; that is false at v1.43.0 (agent.rs:1956, :2840 emit_stop_hook_blocking).

**Tool names this CLI sends** (failproofai canonicalizes them before your policy
sees them — always match the canonical name in the left column):

| You match | This CLI actually sends |
|---|---|
| `Bash` | `shell` |
| `Edit` | `edit` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `LS` | `tree` |
| `Read` | `view`, `read_image` |
| `Task` | `delegate` |
| `TodoWrite` | `todo__todo_write` |
| `Write` | `write` |

Input keys are canonicalized too:

| Tool | You read | This CLI sends |
|---|---|---|
| `Read` | `file_path` | `path` |
| `Read` | `file_path` | `source` |
| `Write` | `file_path` | `path` |
| `Edit` | `file_path` | `path` |
| `LS` | `file_path` | `path` |

## Writing one policy for all of them

The canonicalization above is the point: **you write canonical names once.** Match
`Bash`, `Read`, `Write`, `Edit`, `Grep` and read `command`, `file_path`, `content`,
`old_string`, `new_string` — failproofai maps every CLI's own vocabulary onto those
before `fn` runs. Matching `terminal` (Hermes) or `run_command` (Antigravity) or
`powershell` (Copilot) is the mistake: those names never reach your policy.

Unknown tools pass through unmapped — MCP tools (`mcp__*`), Skills, and any tool a CLI
adds after this table was written. Match those by their raw name, and expect the name to
differ per CLI.

When a policy genuinely has to differ per harness, `ctx.cli` carries the CLI id
(`policy-types.ts`, grep `interface PolicyContext`). Use it to *narrow* a rule, not to
resurrect a discarded deny — no return value makes an `observe` row enforce.

