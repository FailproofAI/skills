#!/usr/bin/env node
/**
 * Regenerate references/builtins.md from the live BUILTIN_POLICIES registry.
 *
 *   node sync-builtins.mjs           rewrite the reference file
 *   node sync-builtins.mjs --check   exit 1 if it is out of date (for CI)
 *
 * The reference file is a convenience snapshot. It drifts the moment a builtin
 * is added, renamed, or has its default flipped — and a stale list is worse than
 * no list, because it is quietly authoritative. Run this after any change to
 * builtin-policies.ts.
 *
 * Resolves the registry from the repo checkout first, then from an installed
 * failproofai package, so it works inside the repo and from a user's project.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "references", "builtins.md");
// Machine-readable twin: policy name -> the events it matches on. Consumed by
// attribute-findings.mjs, which has to answer "can this finding's policy even
// fire on the harness the hits came from?" and cannot parse that out of prose.
const OUT_JSON = resolve(HERE, "policy-events.json");
const check = process.argv.includes("--check");

/**
 * Walk up for a repo checkout, then fall back to node_modules.
 *
 * Searches from the CWD first and only then from this script's own location: a
 * globally-installed skill (~/.claude/skills/...) sits nowhere near the user's
 * project, so walking up from the script would never reach their node_modules.
 */
function findRegistry() {
  for (const start of [process.cwd(), HERE]) {
    const hit = walkUpFrom(start);
    if (hit) return hit;
  }
  return null;
}

function walkUpFrom(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const src = join(dir, "src", "hooks", "builtin-policies.ts");
    if (existsSync(src)) return src;
    const dep = join(dir, "node_modules", "failproofai", "src", "hooks", "builtin-policies.ts");
    if (existsSync(dep)) return dep;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const registryPath = findRegistry();
if (!registryPath) {
  console.error("Could not locate builtin-policies.ts (looked in the repo and node_modules).");
  console.error("Run this from inside the failproofai repo, or a project with failproofai installed.");
  process.exit(2);
}

// TypeScript source — needs a TS-capable runtime. Bun handles it directly.
let BUILTIN_POLICIES;
try {
  ({ BUILTIN_POLICIES } = await import(pathToFileURL(registryPath).href));
} catch (err) {
  console.error(`Could not import ${registryPath}: ${err.message}`);
  console.error("This script needs a TypeScript-capable runtime — try: bun sync-builtins.mjs");
  process.exit(2);
}

const byCategory = new Map();
for (const p of BUILTIN_POLICIES) {
  if (!byCategory.has(p.category)) byCategory.set(p.category, []);
  byCategory.get(p.category).push(p);
}

const lines = [];
lines.push(`# Builtin policies (${BUILTIN_POLICIES.length})`);
lines.push("");
lines.push("**Generated — do not hand-edit.** Regenerate with:");
lines.push("");
lines.push("```bash");
lines.push('bun "$SKILL_DIR/scripts/sync-builtins.mjs"   # $SKILL_DIR = this skill\'s folder');
lines.push("```");
lines.push("");
lines.push("This snapshot goes stale whenever a builtin is added, renamed, or has its default");
lines.push("flipped. When it matters, ask the CLI instead — it is always current:");
lines.push("");
lines.push("```bash");
lines.push("failproofai policies          # every policy, with enabled status and params");
lines.push("```");
lines.push("");
lines.push("## How to use this for triage");
lines.push("");
lines.push("Enabling a builtin beats writing a custom policy: nothing to maintain, no naming");
lines.push("trap, no fail-open risk, and it ships with tests.");
lines.push("");
lines.push("Before concluding \"no builtin covers this\", check whether a **parameterized** one");
lines.push("does — several take allowlists or thresholds that widen their scope considerably.");
lines.push("Params go in the `policyParams` map, keyed by short name.");
lines.push("");
lines.push("To enable: add the short name to `enabledPolicies` in `.failproofai/policies-config.json`.");
lines.push("");
lines.push("---");

for (const [category, policies] of byCategory) {
  lines.push("");
  lines.push(`### ${category}`);
  lines.push("");
  lines.push("| Policy | Default | Events | What it catches |");
  lines.push("|---|---|---|---|");
  for (const p of policies) {
    const events = (p.match?.events ?? []).join(", ") || "—";
    const params = p.params ? ` _(params: ${Object.keys(p.params).join(", ")})_` : "";
    const beta = p.beta ? " _(beta)_" : "";
    lines.push(
      `| \`${p.name}\` | ${p.defaultEnabled ? "**on**" : "off"} | ${events} | ${p.description}${params}${beta} |`,
    );
  }
}

lines.push("");
lines.push("> The five `require-*-before-stop` policies gate the end of a turn. A gate whose");
lines.push("> condition cannot be met in the current project loops forever — see `traps.md` §6");
lines.push("> before enabling one.");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Audit-only detectors");
lines.push("");
lines.push("These have no real-time builtin equivalent, so they are the prime candidates for");
lines.push("custom policies. List them from source with:");
lines.push("");
lines.push("```bash");
lines.push("bun -e 'const {AUDIT_DETECTORS}=await import(\"./src/audit/detectors/index.ts\");");
lines.push("for (const d of AUDIT_DETECTORS) console.log(d.name, \"|\", d.category+\"/\"+d.severity, \"|\", d.description)'");
lines.push("```");
lines.push("");
lines.push("All but `reread-after-edit` are Bash-command patterns, so a `PreToolUse` policy");
lines.push("filtering on `ctx.toolName === \"Bash\"` and matching `ctx.toolInput.command` covers");
lines.push("most of them. `reread-after-edit` needs cross-call session state, which hooks cannot");
lines.push("see — that one needs a builtin, not a custom policy.");
lines.push("");

const generated = lines.join("\n");

const eventsJson =
  JSON.stringify(
    {
      _generated: "sync-builtins.mjs — do not hand-edit",
      policies: Object.fromEntries(
        [...BUILTIN_POLICIES]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => [
            p.name,
            {
              events: p.match?.events ?? [],
              toolNames: p.match?.toolNames ?? null,
              defaultEnabled: p.defaultEnabled === true,
              alwaysOn: p.alwaysOn === true,
            },
          ]),
      ),
    },
    null,
    2,
  ) + "\n";

if (check) {
  const stale = [
    [OUT, generated, "references/builtins.md"],
    [OUT_JSON, eventsJson, "scripts/policy-events.json"],
  ].filter(([path, want]) => (existsSync(path) ? readFileSync(path, "utf8") : "") !== want);
  if (stale.length) {
    console.error(`${stale.map(([, , label]) => label).join(" and ")} OUT OF DATE.`);
    console.error(`Registry has ${BUILTIN_POLICIES.length} builtins. Run: bun ${process.argv[1]}`);
    process.exit(1);
  }
  console.log(`builtins.md and policy-events.json are current (${BUILTIN_POLICIES.length} builtins).`);
  process.exit(0);
}

writeFileSync(OUT, generated);
writeFileSync(OUT_JSON, eventsJson);
console.log(`Wrote ${OUT} — ${BUILTIN_POLICIES.length} builtins across ${byCategory.size} categories.`);
console.log(`Wrote ${OUT_JSON} — events for ${BUILTIN_POLICIES.length} policies.`);
