#!/usr/bin/env node
/**
 * How much of what your agents ACTUALLY call can a builtin policy match?
 *
 *   node fleet-tool-coverage.mjs                 query the fleet via fp
 *   node fleet-tool-coverage.mjs --file t.json   use a saved `list tools` response
 *   node fleet-tool-coverage.mjs --json          machine-readable
 *
 * WHY THIS EXISTS
 *
 * The builtins filter on canonical Claude names — `Bash`, `Read`, `Write`,
 * `Edit`, `Grep`. failproofai canonicalizes each harness's own vocabulary onto
 * those, but only for the names in that harness's map; everything else reaches a
 * policy under its RAW name (`tool-name-canonicalize.ts`, the `return raw`
 * fallback). Nothing is invisible — but nothing outside the maps is covered by a
 * builtin either.
 *
 * That distinction sounds academic until it is measured. On a real fleet the
 * first run of this script found 140 distinct tools, 16 of them canonicalized:
 * 89% of production tool calls were outside every builtin's reach, including
 * `execute_code` and `execute` (code execution that is not `Bash`), the whole
 * `browser_*` family, `computer_use`, and mail/calendar/Jira/Slack mutations
 * behind `mcp__*` and `composio.*`.
 *
 * So run this before concluding a builtin covers a behaviour. `failproofai
 * policies` tells you what is enabled; this tells you what it can actually see.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Usage: fleet-tool-coverage.mjs [--file <tools.json>] [--json] [--bin <name>]

Cross-references the tool names your fleet actually emits against what each
harness canonicalizes, so you can see how much of the surface a builtin can
match at all.

  --file <p>  a saved \`fp --json list tools\` response (skips the query)
  --bin <n>   cloud CLI binary (default: whichever of fp / agenteye resolves)
  --json      machine-readable output
`.trim());
  process.exit(0);
}

// ------------------------------------------------------------------- tables

const capPath = join(HERE, "harness-capability.json");
if (!existsSync(capPath)) {
  console.error(`Missing ${capPath}. Regenerate with: node ${join(HERE, "sync-harnesses.mjs")}`);
  process.exit(2);
}
const cap = JSON.parse(readFileSync(capPath, "utf8"));
const toolMaps = cap.toolMaps;
if (!toolMaps) {
  console.error("harness-capability.json predates toolMaps. Re-run sync-harnesses.mjs.");
  process.exit(2);
}
const CLIS = cap.clis;
// Claude's tool names are already canonical, so they do not appear as keys in
// its empty rename map. Values across the other harness maps give us the
// canonical vocabulary and let direct names such as Bash count as reachable.
const canonicalNames = new Set(
  Object.values(toolMaps).flatMap((mapping) => Object.values(mapping)),
);

// ------------------------------------------------------------------- input

/**
 * Two cloud CLIs can be on PATH: `fp` (current, dist `fp-cloud-cli`) and the legacy
 * `agenteye` 0.1.13. Prefer `fp`; resolve rather than hardcode — see references/harnesses.md.
 */
function resolveBin() {
  if (args.bin && args.bin !== true) return String(args.bin);
  for (const b of ["fp", "agenteye"]) {
    try {
      execFileSync("command", ["-v", b], { shell: "/bin/bash", stdio: "ignore" });
      return b;
    } catch { /* keep looking */ }
  }
  return null;
}

let tools;
if (args.file && args.file !== true) {
  tools = JSON.parse(readFileSync(resolve(String(args.file)), "utf8")).values;
} else {
  const bin = resolveBin();
  if (!bin) {
    console.error(
      "Neither `fp` nor `agenteye` is on PATH. Install the cloud CLI, or pass a saved\n" +
        "response with --file (produce it with: fp --json list tools > tools.json).",
    );
    process.exit(2);
  }
  try {
    // Globals MUST precede the subcommand on this CLI — `list tools --json` is a
    // usage error, not a slightly-off invocation.
    const raw = execFileSync(bin, ["--json", "list", "tools"], { encoding: "utf8" });
    tools = JSON.parse(raw).values;
  } catch (err) {
    console.error(
      `\`${bin} --json list tools\` failed: ${err.message.split("\n")[0]}\n` +
        "Needs a signed-in session with events:read. Check with: " + bin + " --json whoami",
    );
    process.exit(2);
  }
}

if (!Array.isArray(tools) || tools.length === 0) {
  console.error("No tools returned. An empty fleet, or the wrong org — check `--org`.");
  process.exit(1);
}

// --------------------------------------------------------------- crossref

const mapped = [];
const raw = [];
for (const t of tools) {
  const canon = {};
  if (canonicalNames.has(t)) canon.direct = t;
  for (const cli of CLIS) {
    const c = toolMaps[cli]?.[t];
    if (c) canon[cli] = c;
  }
  (Object.keys(canon).length ? mapped : raw).push({ tool: t, canon });
}

/**
 * Group raw tools by prefix family so the output is a work-list rather than a
 * wall of names. The families are derived from the names themselves — no
 * hardcoded vendor list, which would rot the moment a fleet adds an integration.
 */
function family(t) {
  if (/^mcp[_.]{1,2}/i.test(t)) {
    const m = t.match(/^mcp[_.]{1,2}([a-z0-9]+)/i);
    return `mcp:${m ? m[1] : "?"}`;
  }
  if (t.includes(".")) return `${t.split(".")[0]}.*`;
  const m = t.match(/^([a-z]+)[_-]/i);
  return m ? `${m[1]}_*` : "(other)";
}
const families = new Map();
for (const r of raw) {
  const f = family(r.tool);
  if (!families.has(f)) families.set(f, []);
  families.get(f).push(r.tool);
}
const sortedFamilies = [...families.entries()].sort((a, b) => b[1].length - a[1].length);

const pct = ((mapped.length / tools.length) * 100).toFixed(0);

if (args.json) {
  console.log(JSON.stringify({
    total: tools.length,
    canonicalized: mapped.length,
    raw: raw.length,
    builtinReachablePct: Number(pct),
    mapped,
    rawByFamily: Object.fromEntries(sortedFamilies),
  }, null, 2));
  process.exit(0);
}

console.log(`\n${tools.length} distinct tools seen across the fleet.`);
console.log(`  ${mapped.length} canonicalize on at least one harness — builtins can match these (${pct}%)`);
console.log(`  ${raw.length} arrive RAW everywhere — no builtin can ever match them`);

console.log(`\n--- canonicalized (${mapped.length}) ---`);
for (const m of mapped) {
  const targets = [...new Set(Object.values(m.canon))].join("/");
  console.log(`  ${m.tool.padEnd(22)} -> ${targets.padEnd(10)} on ${Object.keys(m.canon).join(", ")}`);
}

console.log(`\n--- raw, by family (${raw.length}) ---`);
for (const [f, names] of sortedFamilies) {
  console.log(`  ${String(names.length).padStart(4)}  ${f}`);
  if (names.length <= 6) console.log(`        ${names.join(", ")}`);
}

console.log(`
Every raw tool above is still interceptable: PreToolUse fires for it and it reaches
your policy under the name shown. What you lose is builtin coverage — so for these,
"is a builtin enough?" is always no, and a custom policy matching the raw name (scoped
with ctx.cli) is the only option. references/patterns.md has the shape.`);

if (Number(pct) < 50) {
  console.log(
    `\nOnly ${pct}% of this fleet's tool surface is builtin-reachable. Do not report a\n` +
      "behaviour as covered because a builtin is enabled — check the tool it fires on.",
  );
}
