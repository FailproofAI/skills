#!/usr/bin/env node
/**
 * Which harness did each audit finding actually come from, and can a policy
 * even fire there?
 *
 *   node attribute-findings.mjs              human-readable table
 *   node attribute-findings.mjs --json       machine-readable
 *   node attribute-findings.mjs --name <n>   one finding only
 *
 * WHY THIS EXISTS
 *
 * `failproofai audit` scans every harness on the machine and then AGGREGATES.
 * `AuditCount` (`src/audit/types.ts`) carries `hits`, `projects` and
 * `examples[]` but **no `cli` field** — so a finding reading "47 hits" hides
 * which of the 12 harnesses produced them, and the triage that follows silently
 * assumes they are all enforceable the same way. They are not:
 *
 *   • a Stop-event finding whose hits are all from Hermes is unenforceable —
 *     failproofai installs no Stop event for Hermes at all;
 *   • a PostToolUse finding is a real block only on Codex and Copilot, and
 *     observation-only on the other ten;
 *   • a finding from a harness whose tool never canonicalizes needs a policy
 *     matching the RAW tool name, not `Bash`.
 *
 * The per-transcript cache still has the attribution the aggregate threw away:
 * `~/.failproofai/audit/cache/<sha1>.json` holds a `TranscriptAuditResult` with
 * BOTH `cli` and `hitsByName`. Joining those back per finding is the whole job
 * here. Cross-referenced against the generated capability tables, it answers
 * "is this finding worth a policy?" before any policy gets written.
 *
 * Reads only generated data that ships with this skill (harness-capability.json,
 * policy-events.json) plus the user's own cache — no failproofai source needed.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
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
Usage: attribute-findings.mjs [--json] [--name <finding>] [--home <dir>]

Joins the per-transcript audit cache back to each finding so you can see which
harness the hits came from, then says whether a policy can enforce there.

  --json        machine-readable output
  --name <n>    one finding only (short name or failproofai/-prefixed)
  --home <dir>  alternate home (default: $HOME)
`.trim());
  process.exit(0);
}

const HOME = args.home && args.home !== true ? resolve(args.home) : homedir();
const CACHE_DIR = join(HOME, ".failproofai", "audit", "cache");

// ------------------------------------------------------------------ tables

function loadJson(p, what) {
  if (!existsSync(p)) {
    console.error(`Missing ${what} at ${p}. Regenerate it with the sync script.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

const capability = loadJson(join(HERE, "harness-capability.json"), "harness-capability.json").events;
const policyEvents = loadJson(join(HERE, "policy-events.json"), "policy-events.json").policies;

/** Short name — builtins are canonical-prefixed in the audit, bare in config. */
const short = (n) => n.replace(/^failproofai\//, "");

// ------------------------------------------------------------------- cache

if (!existsSync(CACHE_DIR)) {
  console.error(
    `No audit cache at ${CACHE_DIR}.\n` +
      "Either no audit has run on this machine, or it predates the layout-4 move.\n" +
      "Ask the user to run `failproofai audit` (it serves a dashboard until Ctrl+C).",
  );
  process.exit(1);
}

/**
 * `hitsByName` per transcript, tagged with that transcript's harness.
 *
 * Entries are read leniently: a schemaVersion the audit engine would reject is
 * still useful for attribution, because `cli` and `hitsByName` have been in the
 * shape since v1. Rejecting them the way `readCachedTranscriptResult` does
 * would throw away good attribution over a field this script never reads — but
 * the count is reported so a stale-looking picture is visible rather than
 * silent.
 */
const perFinding = new Map();   // name -> Map(cli -> hits)
const seenClis = new Set();
let files = 0, unreadable = 0, oldSchema = 0, newestMs = 0, oldestMs = Infinity;

for (const f of readdirSync(CACHE_DIR)) {
  if (!f.endsWith(".json")) continue;
  files++;
  let entry;
  try {
    entry = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8"));
  } catch { unreadable++; continue; }
  const r = entry?.result;
  if (!r || typeof r.cli !== "string" || !r.hitsByName) { unreadable++; continue; }
  if (typeof entry.schemaVersion === "number" && entry.schemaVersion < 2) oldSchema++;

  const when = Number(entry.cachedAt);
  if (Number.isFinite(when)) {
    if (when > newestMs) newestMs = when;
    if (when < oldestMs) oldestMs = when;
  }
  seenClis.add(r.cli);

  for (const [name, hits] of Object.entries(r.hitsByName)) {
    if (!hits) continue;
    const key = short(name);
    if (!perFinding.has(key)) perFinding.set(key, new Map());
    const byCli = perFinding.get(key);
    byCli.set(r.cli, (byCli.get(r.cli) ?? 0) + hits);
  }
}

if (perFinding.size === 0) {
  console.error(`Read ${files} cache file(s) under ${CACHE_DIR} but found no attributable hits.`);
  process.exit(1);
}

// ------------------------------------------------------------------ verdict

/**
 * Can a policy for this finding actually enforce on the harnesses it came from?
 *
 * A finding is judged against its OWN events. `undefined` capability is carried
 * through as "unverified" rather than rounded to either answer — the capability
 * table's own rule is that absent means untraced, and asserting protection
 * nobody confirmed is the failure this whole join exists to prevent.
 */
function judge(name, byCli) {
  const spec = policyEvents[name];
  const clis = [...byCli.keys()].sort();

  if (!spec) {
    return {
      kind: "detector",
      events: [],
      perCli: Object.fromEntries(clis.map((c) => [c, "n/a"])),
      verdict: "audit-only detector — no builtin behind it; author a custom policy and pick the event yourself",
    };
  }

  const perCli = {};
  for (const cli of clis) {
    // Best outcome across the policy's events: if any event blocks here, a
    // policy can be made to work here.
    let best = "not-installed";
    const rank = { block: 3, observe: 2, unverified: 1, "not-installed": 0 };
    for (const ev of spec.events) {
      const cap = capability[ev]?.[cli] ?? "unverified";
      if (rank[cap] > rank[best]) best = cap;
    }
    perCli[cli] = best;
  }

  const blocking = clis.filter((c) => perCli[c] === "block");
  const dead = clis.filter((c) => perCli[c] === "not-installed");
  const inert = clis.filter((c) => perCli[c] === "observe");
  const unknown = clis.filter((c) => perCli[c] === "unverified");

  let kind, verdict;
  if (blocking.length === clis.length) {
    kind = "enforceable";
    verdict = `enforceable on every harness the hits came from (${blocking.join(", ")})`;
  } else if (blocking.length === 0) {
    kind = "unenforceable";
    const why = [
      dead.length ? `${dead.join(", ")}: event not installed — the policy never runs` : "",
      inert.length ? `${inert.join(", ")}: verdict discarded — the action still happens` : "",
      unknown.length ? `${unknown.join(", ")}: untraced` : "",
    ].filter(Boolean).join("; ");
    verdict = `NOT enforceable where it happened — ${why}`;
  } else {
    kind = "partial";
    const lost = [...dead, ...inert, ...unknown];
    const lostHits = lost.reduce((n, c) => n + byCli.get(c), 0);
    const total = clis.reduce((n, c) => n + byCli.get(c), 0);
    verdict =
      `enforceable on ${blocking.join(", ")} only — ${lostHits} of ${total} hits ` +
      `(${lost.join(", ")}) would not be stopped`;
  }
  return { kind, events: spec.events, toolNames: spec.toolNames, perCli, verdict };
}

const rows = [...perFinding.entries()]
  .map(([name, byCli]) => {
    const total = [...byCli.values()].reduce((a, b) => a + b, 0);
    return { name, total, byCli: Object.fromEntries([...byCli].sort((a, b) => b[1] - a[1])), ...judge(name, byCli) };
  })
  .filter((r) => !args.name || args.name === true || short(String(args.name)) === r.name)
  .sort((a, b) => b.total - a.total);

if (rows.length === 0) {
  console.error(`No finding named "${args.name}" in the cache.`);
  process.exit(1);
}

// ------------------------------------------------------------------- output

const ageDays = (ms) => ((Date.now() - ms) / 864e5).toFixed(1);

if (args.json) {
  console.log(JSON.stringify({
    cacheDir: CACHE_DIR,
    transcripts: files,
    unreadable,
    harnesses: [...seenClis].sort(),
    newestCacheAgeDays: Number.isFinite(newestMs) ? Number(ageDays(newestMs)) : null,
    findings: rows,
  }, null, 2));
  process.exit(0);
}

console.log(`\n${files} cached transcript(s) across ${seenClis.size} harness(es): ${[...seenClis].sort().join(", ")}`);
if (Number.isFinite(newestMs) && newestMs > 0) {
  console.log(`Cache spans ${ageDays(newestMs)}–${ageDays(oldestMs)} days old — findings describe that window, not today.`);
}
if (unreadable) console.log(`${unreadable} cache file(s) unreadable and skipped.`);
if (oldSchema) console.log(`${oldSchema} entry(ies) written by an older engine; attribution still read.`);

const LABEL = { enforceable: "OK    ", partial: "PARTIAL", unenforceable: "DEAD  ", detector: "DETECT" };
console.log("");
for (const r of rows) {
  const spread = Object.entries(r.byCli).map(([c, n]) => `${c} ${n}`).join(", ");
  console.log(`${LABEL[r.kind]}  ${r.name}  (${r.total} hits: ${spread})`);
  if (r.events.length) {
    const caps = Object.entries(r.perCli).map(([c, v]) => `${c}=${v}`).join(" ");
    console.log(`        events: ${r.events.join(", ")}   |   ${caps}`);
  }
  console.log(`        ${r.verdict}`);
  // Only worth saying where a rename actually happens. Claude's tool names ARE
  // the canonical names, so a claude-only finding has nothing to canonicalize
  // and the warning would be pure noise on the most common row.
  const renaming = Object.keys(r.byCli).filter((c) => c !== "claude");
  if (r.toolNames && renaming.length) {
    const verb = renaming.length === 1 ? "renames its tools" : "rename their tools";
    console.log(
      `        matches tool(s) ${r.toolNames.join(", ")}; ${renaming.join(", ")} ${verb} before`,
    );
    console.log(
      `        your policy sees them. Anything NOT in that harness's map in references/harnesses.md`,
    );
    console.log(`        arrives under its raw name and will not match.`);
  }
  console.log("");
}

const dead = rows.filter((r) => r.kind === "unenforceable");
const partial = rows.filter((r) => r.kind === "partial");
if (dead.length || partial.length) {
  console.log("Do not write a policy for a DEAD row as-is: pick a different event, or say plainly");
  console.log("that the behaviour cannot be intercepted on that harness. For PARTIAL, state which");
  console.log("harnesses are covered rather than reporting the finding as fixed.");
}
