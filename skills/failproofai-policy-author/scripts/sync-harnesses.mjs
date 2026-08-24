#!/usr/bin/env node
/**
 * Regenerate references/harnesses.md from the live failproofai source.
 *
 *   node sync-harnesses.mjs           rewrite the reference file
 *   node sync-harnesses.mjs --check   exit 1 if it is out of date (for CI)
 *
 * Three facts decide whether a policy does anything on a given agent CLI, and
 * all three live in source that moves:
 *
 *   1. Does failproofai even INSTALL that event for that CLI?  (`*_EVENT_MAP` /
 *      `*_HOOK_EVENT_TYPES` in src/hooks/types.ts)
 *   2. If it fires, does a DENY change the agent's behaviour, or is the verdict
 *      discarded?  (`ENFORCEMENT_CAPABILITY` in src/hooks/enforcement-capability.ts)
 *   3. What does the CLI call its tools and input keys before failproofai
 *      canonicalizes them?  (`*_TOOL_MAP` / `*_TOOL_INPUT_MAP` in types.ts)
 *
 * enforcement-capability.ts exists precisely because this used to be prose and
 * the prose drifted — CLAUDE.md documented Hermes `subagent_stop` as a working
 * gate for months while upstream discarded the return. Hand-maintaining a
 * second copy of that table in a skill reference would reproduce the same bug,
 * one layer out. So it is generated, and `--check` fails CI when it rots.
 *
 * Resolves the failproofai source from the repo checkout first, then from an
 * installed package, so it works inside the repo and from a user's project.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "references", "harnesses.md");
// Machine-readable twin of the matrix, for test-policy.mjs's --cli preflight.
// Emitted from the same parse so the runner's warnings and the reference an
// author reads can never disagree; markdown-scraping the table would let them.
const OUT_JSON = resolve(HERE, "harness-capability.json");
const check = process.argv.includes("--check");

// ------------------------------------------------------------------ resolve

/**
 * Walk up for a repo checkout, then fall back to node_modules.
 *
 * Searches from the CWD first and only then from this script's own location,
 * mirroring sync-builtins.mjs: a globally-installed skill (~/.claude/skills/…)
 * sits nowhere near the user's project, so walking up from the script alone
 * would never reach their node_modules.
 */
function findHooksDir() {
  for (const start of [process.cwd(), HERE]) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      for (const candidate of [
        join(dir, "src", "hooks"),
        join(dir, "node_modules", "failproofai", "src", "hooks"),
      ]) {
        if (existsSync(join(candidate, "enforcement-capability.ts"))) return candidate;
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

const hooksDir = findHooksDir();
if (!hooksDir) {
  console.error(
    "Could not find failproofai's src/hooks. Run this from inside a failproofai\n" +
      "checkout, or from a project with failproofai installed.",
  );
  process.exit(1);
}

const capSrc = readFileSync(join(hooksDir, "enforcement-capability.ts"), "utf8");
const typesSrc = readFileSync(join(hooksDir, "types.ts"), "utf8");

// -------------------------------------------------------------------- parse

/**
 * Body of `export const <NAME> …` between its first `open` bracket and the
 * matching close.
 *
 * Bracket-counted rather than "find the next `\n};`" because several of these
 * declarations are single-line (`INTEGRATION_TYPES`) — scanning for a
 * column-0 terminator silently runs past the end and swallows the *next*
 * declaration too, which reads as a successful parse and yields 24 CLIs.
 * Comments and string bodies are skipped so a `]` inside either does not end
 * the scan early.
 */
function bracketBody(src, name, open, close) {
  const start = src.indexOf(`export const ${name}`);
  if (start === -1) return null;
  const from = src.indexOf(open, start);
  if (from === -1) return null;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i);
      if (i === -1) break;
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(from + 1, i);
  }
  return null;
}

const objectBody = (src, name) => bracketBody(src, name, "{", "}");
const arrayBody = (src, name) => bracketBody(src, name, "[", "]");

/** String literals in an array body, ignoring commented-out lines. */
function stringList(body) {
  if (!body) return [];
  return body
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .flatMap((l) => [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** Flat `key: "value"` pairs, ignoring comments. Keys may be quoted. */
function flatMap(body) {
  const out = {};
  if (!body) return out;
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("//")) continue;
    const m = line.match(/^\s*(?:"([^"]+)"|([A-Za-z_][\w.]*))\s*:\s*"([^"]+)"\s*,?/);
    if (m) out[m[1] ?? m[2]] = m[3];
  }
  return out;
}

/**
 * Nested `Tool: { from: "to", … }` pairs, one level deep.
 *
 * Brace-counted rather than line-matched: OPENCODE_TOOL_INPUT_MAP's `Edit`
 * entry spans five lines, and a single-line regex drops it without erroring —
 * producing a reference that quietly under-reports which keys get canonicalized.
 */
function nestedMap(body) {
  const out = {};
  if (!body) return out;
  const re = /(?:"([^"]+)"|([A-Za-z_]\w*))\s*:\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
    }
    const inner = {};
    for (const p of body.slice(m.index + m[0].length, i - 1).matchAll(
      /(?:"([^"]+)"|([A-Za-z_]\w*))\s*:\s*"([^"]+)"/g,
    )) {
      inner[p[1] ?? p[2]] = p[3];
    }
    out[m[1] ?? m[2]] = inner;
    re.lastIndex = i;
  }
  return out;
}

/**
 * ENFORCEMENT_CAPABILITY → { cli: { provenance, events: {ev: {cap, note}}, notes: [] } }.
 *
 * Parsed from source text rather than imported so the trailing `//` evidence on
 * every row survives — the caveats ("CAP: default 8", "teammate mode only",
 * "DEAD HOOK") are the part a policy author actually needs, and an import would
 * drop all of them.
 */
function parseCapability(src) {
  const body = objectBody(src, "ENFORCEMENT_CAPABILITY");
  if (!body) throw new Error("ENFORCEMENT_CAPABILITY not found");
  const out = {};
  const lines = body.split("\n");
  let cli = null;
  let header = [];
  let pending = [];
  for (const line of lines) {
    const banner = line.match(/^\s*\/\/\s*──\s*(.+?)\s*─+/);
    if (banner) {
      header = [];
      pending = [];
      continue;
    }
    const open = line.match(/^\s{2}([a-z]+):\s*\{\s*$/);
    if (open) {
      cli = open[1];
      out[cli] = { provenance: header.join(" ").trim(), events: {}, notes: [] };
      header = [];
      pending = [];
      continue;
    }
    if (/^\s{2}\},\s*$/.test(line)) {
      if (cli && pending.length) out[cli].notes.push(pending.join(" ").trim());
      cli = null;
      pending = [];
      continue;
    }
    const comment = line.match(/^\s*\/\/\s?(.*)$/);
    if (comment) {
      if (cli) pending.push(comment[1].trim());
      else header.push(comment[1].trim());
      continue;
    }
    const row = line.match(/^\s*(\w+):\s*"(block|observe)"\s*,\s*(?:\/\/\s?(.*))?$/);
    if (row && cli) {
      if (pending.length) {
        out[cli].notes.push(pending.join(" ").trim());
        pending = [];
      }
      out[cli].events[row[1]] = { cap: row[2], note: (row[3] ?? "").trim() };
    }
  }
  return out;
}

const CLIS = stringList(arrayBody(typesSrc, "INTEGRATION_TYPES"));
const CANONICAL_EVENTS = stringList(arrayBody(typesSrc, "HOOK_EVENT_TYPES"));
const capability = parseCapability(capSrc);

/** Canonical events failproofai actually installs, per CLI. */
function installedEvents(cli) {
  if (cli === "claude") {
    return Object.fromEntries(CANONICAL_EVENTS.map((e) => [e, e]));
  }
  const U = cli.toUpperCase();
  const mapped = flatMap(objectBody(typesSrc, `${U}_EVENT_MAP`));
  if (Object.keys(mapped).length) {
    // native → canonical; invert so we key by canonical and keep the native name.
    const out = {};
    for (const [native, canon] of Object.entries(mapped)) out[canon] = native;
    return out;
  }
  // No EVENT_MAP means the CLI's own event names are already canonical.
  const native = stringList(arrayBody(typesSrc, `${U}_HOOK_EVENT_TYPES`));
  return Object.fromEntries(native.map((e) => [e, e]));
}

const installed = Object.fromEntries(CLIS.map((c) => [c, installedEvents(c)]));

/**
 * Which config scopes a CLI supports. Not cosmetic: Hermes and OpenClaw are
 * user-scope only, so "put it in the project config" — the default advice
 * everywhere else — is not an option there, and a project-scoped rule for them
 * has nowhere to live.
 */
const scopes = Object.fromEntries(
  CLIS.map((c) => [
    c,
    stringList(arrayBody(typesSrc, c === "claude" ? "HOOK_SCOPES" : `${c.toUpperCase()}_HOOK_SCOPES`)),
  ]),
);
const toolMaps = Object.fromEntries(
  CLIS.map((c) => [c, flatMap(objectBody(typesSrc, `${c.toUpperCase()}_TOOL_MAP`))]),
);
const inputMaps = Object.fromEntries(
  CLIS.map((c) => [c, nestedMap(objectBody(typesSrc, `${c.toUpperCase()}_TOOL_INPUT_MAP`))]),
);

// ------------------------------------------------------------------- render

/**
 * One cell of the matrix.
 *
 *   block   — a deny is read at a call site that prevents or re-runs. Enforcement.
 *   observe — the event fires, the verdict is discarded. Instrumentation only.
 *   ?       — installed but never traced. enforcement-capability.ts is explicit
 *             that absent means UNKNOWN, never "block", so this must not render
 *             as either one.
 *   —       — failproofai does not install this event for this CLI at all.
 */
function cell(cli, event) {
  if (!installed[cli]?.[event]) return "—";
  const cap = capability[cli]?.events?.[event]?.cap;
  if (cap === "block") return "**block**";
  if (cap === "observe") return "observe";
  return "?";
}

/** Events worth a matrix row: installed on at least one non-claude CLI. */
const MATRIX_EVENTS = CANONICAL_EVENTS.filter((e) =>
  CLIS.some((c) => c !== "claude" && installed[c]?.[e]),
);

const SHORT = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor",
  opencode: "opencode",
  pi: "pi",
  hermes: "hermes",
  openclaw: "openclaw",
  factory: "factory",
  devin: "devin",
  antigravity: "agy",
  goose: "goose",
};

const out = [];
const p = (s = "") => out.push(s);

p("# Harness capabilities (what enforces where)");
p();
p("**Generated — do not hand-edit.** Regenerate with:");
p();
p("```bash");
p('node "$SKILL_DIR/scripts/sync-harnesses.mjs"   # $SKILL_DIR = this skill\'s folder');
p("```");
p();
p("A policy that returns `deny()` does not necessarily stop anything. Whether it does");
p("depends on **which agent CLI fired the hook** — the same policy is hard enforcement on");
p("one harness and a no-op on another. This file is the lookup you do *before* choosing an");
p("event, generated from failproofai's own source so it cannot drift away from the code.");
p();
p("Read `SKILL.md` → *Pick an event the harness can actually enforce* for how to use it.");
p();
p("## The three states");
p();
p("| Cell | Meaning | What to do |");
p("|---|---|---|");
p("| **block** | The verdict is read at a call site that prevents the action or forces another turn | Real enforcement. `deny()` works |");
p("| observe | The event fires and your policy runs, but the verdict is **discarded** | Never `deny()` here — the action proceeds and the user thinks they are protected |");
p("| ? | Installed, but never traced to a consuming call site | Treat as unproven. Say so; do not promise enforcement |");
p("| — | failproofai does not install this event for this CLI | The policy never runs at all |");
p();
p("`?` is not a hedge — it is the honest answer. enforcement-capability.ts only lists rows");
p("traced to source, vendor docs, or a recorded live probe, and its header is explicit that");
p("**absent means unknown, not \"block\"**. Do not round a `?` up.");
p();
p("## Matrix");
p();
p("Rows are canonical event names (what you put in `match.events`). Columns are the 12");
p("supported CLIs.");
p();
p(`| Event | ${MATRIX_EVENTS.length ? CLIS.map((c) => SHORT[c] ?? c).join(" | ") : ""} |`);
p(`|---|${CLIS.map(() => "---").join("|")}|`);
for (const e of MATRIX_EVENTS) {
  p(`| \`${e}\` | ${CLIS.map((c) => cell(c, e)).join(" | ")} |`);
}
p();
p("Claude-only events (`TaskCreated`, `Elicitation`, `WorktreeRemove`, `ConfigChange`, …)");
p("are omitted from the matrix — they are `—` everywhere else by construction. Their");
p("capability is listed under *claude* below.");
p();
/**
 * Events that block on every CLI that installs them.
 *
 * Computed, not asserted. The headline rule below ("PreToolUse is the only
 * one") is the single most load-bearing sentence in this file, and hardcoding
 * it would reintroduce exactly the drift the generator exists to prevent — if
 * a future release makes a second event universal, or breaks PreToolUse on one
 * harness, the prose has to move with it.
 */
const universal = CANONICAL_EVENTS.filter((e) => {
  const hosts = CLIS.filter((c) => installed[c]?.[e]);
  return hosts.length > 1 && hosts.every((c) => capability[c]?.events?.[e]?.cap === "block");
});

p("## Canonicalization gates BUILTINS, not interception");
p();
p("The single most useful thing to know before reading the per-CLI tables, because it is the");
p("opposite of what they look like they say.");
p();
p("**`PreToolUse` fires for every tool a harness emits, mapped or not.** An unmapped tool is");
p("not invisible — it reaches your policy under its **raw** name, with `ctx.cli` set. Verified");
p("live: a policy matching `browser_open` (a Hermes tool that appears in no map) denies");
p("correctly under `--cli hermes`, and the reason surfaces as normal.");
p();
p("What canonicalization actually decides is whether the **builtins** match, since they filter");
p("on `Bash` / `Read` / `Write` / `Edit`. So:");
p();
p("| Tool is | Builtins | A custom policy |");
p("|---|---|---|");
p("| in the harness's map | fire normally | match the canonical name |");
p("| not in the map | **never match it** | matches the raw name, and works |");
p();
p("This is the fix for the most common dead end in audit triage — *\"the audit flagged");
p("something on a harness whose tool we do not canonicalize, so nothing can be done.\"*");
p("Something can be done: match the raw name. What you lose is only builtin coverage, and");
p("`ctx.cli` lets you scope the rule to the harness that actually emits that name.");
p();
p("## The one rule that follows from this table");
p();
if (universal.length === 1 && universal[0] === "PreToolUse") {
  p("**`PreToolUse` is the only event that blocks on every harness that has it.** Every other");
  p("row has at least one CLI where a deny evaporates. If a rule can be expressed as a");
  p("`PreToolUse` gate, express it there — a `PostToolUse` or `Stop` version of the same rule");
  p("is enforcement on some of the fleet and theatre on the rest.");
} else if (universal.length) {
  p(`**Events that block on every harness that installs them: ${universal.map((e) => `\`${e}\``).join(", ")}.**`);
  p("Every other row has at least one CLI where a deny evaporates. Prefer these; a rule on any");
  p("other event is enforcement on some of the fleet and theatre on the rest.");
} else {
  p("**No event blocks on every harness that installs it.** Every rule you write is");
  p("enforcement on some of the fleet and theatre on the rest — check the matrix per CLI and");
  p("say in your report which harnesses the policy actually covers.");
}
p();
p("## Per-CLI detail");
p();
p("Each row below carries the evidence from the source table. The caveats matter as much as");
p("the verdict: several `block` rows only hold under conditions you have to check.");
p();

for (const cli of CLIS) {
  const cap = capability[cli] ?? { events: {}, notes: [], provenance: "" };
  const inst = installed[cli] ?? {};
  p(`### \`${cli}\``);
  p();
  const sc = scopes[cli] ?? [];
  if (sc.length) {
    p(
      `*Config scopes:* ${sc.map((s) => `\`${s}\``).join(", ")}` +
        (sc.length === 1 && sc[0] === "user"
          ? " — **user scope only.** There is no project config; every rule you add here applies to every project on the machine, so it needs the user's say-so (*Never widen scope on your own initiative*)."
          : ""),
    );
    p();
  }
  if (cap.provenance) {
    p(`*Evidence:* ${cap.provenance}`);
    p();
  }
  const rows = Object.keys(inst)
    .filter((e) => cap.events[e] || CANONICAL_EVENTS.includes(e))
    .sort((a, b) => {
      const rank = (x) => (cap.events[x]?.cap === "block" ? 0 : cap.events[x]?.cap === "observe" ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  if (rows.length) {
    p("| Event | Native name | Deny does | Evidence / caveat |");
    p("|---|---|---|---|");
    for (const e of rows) {
      const c = cap.events[e];
      const verdict = c ? (c.cap === "block" ? "**block**" : "observe") : "?";
      const native = inst[e] === e ? "—" : `\`${inst[e]}\``;
      const note = (c?.note ?? "not traced — unverified").replace(/\|/g, "\\|");
      p(`| \`${e}\` | ${native} | ${verdict} | ${note} |`);
    }
    p();
  }
  for (const n of cap.notes) {
    if (n) p(`> ${n.replace(/\n/g, " ")}`);
  }
  if (cap.notes.length) p();

  const tm = toolMaps[cli] ?? {};
  const im = inputMaps[cli] ?? {};
  if (Object.keys(tm).length || Object.keys(im).length) {
    p("**Tool names this CLI sends** (failproofai canonicalizes them before your policy");
    p("sees them — always match the canonical name in the left column):");
    p();
    const byCanon = {};
    for (const [raw, canon] of Object.entries(tm)) (byCanon[canon] ??= []).push(raw);
    p("| You match | This CLI actually sends |");
    p("|---|---|");
    for (const [canon, raws] of Object.entries(byCanon).sort()) {
      p(`| \`${canon}\` | ${raws.map((r) => `\`${r}\``).join(", ")} |`);
    }
    p();
    // The rows above are the ONLY names canonicalized for this CLI. Saying so
    // per-CLI matters more than it looks: a policy filtering on `Bash` silently
    // ignores every tool missing from this table, which is how a finding from
    // one of them gets "fixed" by a policy that can never match it.
    p(
      "**That table is exhaustive.** Any other tool this CLI emits — its own extras, MCP",
    );
    p(
      "tools (`mcp__*`), Skills, anything added since — reaches your policy under its **raw**",
    );
    p("name. Filtering on a canonical name silently skips all of them.");
    p();
    if (Object.keys(im).length) {
      p("Input keys are canonicalized too:");
      p();
      p("| Tool | You read | This CLI sends |");
      p("|---|---|---|");
      for (const [tool, keys] of Object.entries(im)) {
        for (const [from, to] of Object.entries(keys)) {
          p(`| \`${tool}\` | \`${to}\` | \`${from}\` |`);
        }
      }
      p();
    }
  } else {
    p("Tool names and input keys arrive already canonical — no mapping needed.");
    p();
  }
}

p("## Writing one policy for all of them");
p();
p("The canonicalization above is the point: **you write canonical names once.** Match");
p("`Bash`, `Read`, `Write`, `Edit`, `Grep` and read `command`, `file_path`, `content`,");
p("`old_string`, `new_string` — failproofai maps every CLI's own vocabulary onto those");
p("before `fn` runs. Matching `terminal` (Hermes) or `run_command` (Antigravity) or");
p("`powershell` (Copilot) is the mistake: those names never reach your policy.");
p();
p("Unknown tools pass through unmapped — MCP tools (`mcp__*`), Skills, and any tool a CLI");
p("adds after this table was written. Match those by their raw name, and expect the name to");
p("differ per CLI.");
p();
p("When a policy genuinely has to differ per harness, `ctx.cli` carries the CLI id");
p("(`policy-types.ts`, grep `interface PolicyContext`). Use it to *narrow* a rule, not to");
p("resurrect a discarded deny — no return value makes an `observe` row enforce.");
p();

const rendered = out.join("\n") + "\n";

const data = {
  _generated: "sync-harnesses.mjs — do not hand-edit",
  clis: CLIS,
  // Raw tool name -> canonical, per CLI. Carried so fleet-tool-coverage.mjs can
  // answer "how much of what my agents actually call can a builtin even match?"
  // without needing the package source on the machine.
  toolMaps,
  toolInputMaps: inputMaps,
  // canonical event -> cli -> "block" | "observe" | "unverified" | "not-installed"
  events: Object.fromEntries(
    CANONICAL_EVENTS.map((e) => [
      e,
      Object.fromEntries(
        CLIS.map((c) => [
          c,
          !installed[c]?.[e]
            ? "not-installed"
            : (capability[c]?.events?.[e]?.cap ?? "unverified"),
        ]),
      ),
    ]),
  ),
};
const renderedJson = JSON.stringify(data, null, 2) + "\n";

if (check) {
  const stale = [
    [OUT, rendered, "references/harnesses.md"],
    [OUT_JSON, renderedJson, "scripts/harness-capability.json"],
  ].filter(([path, want]) => (existsSync(path) ? readFileSync(path, "utf8") : "") !== want);
  if (stale.length) {
    console.error(
      `${stale.map(([, , label]) => label).join(" and ")} out of date. ` +
        "Run: node scripts/sync-harnesses.mjs",
    );
    process.exit(1);
  }
  console.log("references/harnesses.md and scripts/harness-capability.json are up to date.");
} else {
  writeFileSync(OUT, rendered);
  writeFileSync(OUT_JSON, renderedJson);
  const blocks = CLIS.reduce(
    (n, c) => n + Object.values(capability[c]?.events ?? {}).filter((e) => e.cap === "block").length,
    0,
  );
  console.log(
    `Wrote ${OUT}\n  ${CLIS.length} CLIs · ${MATRIX_EVENTS.length} shared events · ${blocks} blocking (cli, event) pairs`,
  );
}
