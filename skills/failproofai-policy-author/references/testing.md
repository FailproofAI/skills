# Testing a draft before anyone publishes it

A policy that loads, registers and reads well can still fire on nothing, or on everything.
Test it against **labelled calls** and against **real history**, and read each for what it
can honestly say.

## Build the test set before the policy

- **must fire** (2–5): the request's own literal strings first — the exact command, flag,
  path, URL or tool name the person wrote — then real calls from history the request covers.
- **must allow** (3–6): near-misses from the same family, real calls first: `git push origin
  feature/x` next to `git push --force origin main`; `--force-with-lease` when only `--force`
  is banned; a `SELECT` next to `DROP TABLE`. Whatever the request explicitly allows goes here.
- Use the agent's **real tool names and input keys**. A test written for `Bash` proves nothing
  on an agent whose shell arrives as `bash.run`.
- When the action **is** a tool (a dedicated `http.post`, `slack.post`, `merge_pull_request`),
  the must-fire call is that tool with its real input, and the policy matches the tool name —
  not a parse of some argument that may not be there.
- A failure-reaction policy ("when `npm test` fails…") needs results: must-fire calls carry
  an error result, and the same call with a success result is a must-allow.

Run both lists through `fp policies test` (one call each) or the backtest harness. A policy
that fires on every must-fire call and no must-allow call has passed; anything else is a
finding to repair.

## Read a history replay under the right label

A replay over real traffic tells you how often the draft would have fired. What a fire
*means* depends on the policy:

| policy kind | a fire on a call that succeeded is | judge it by |
|---|---|---|
| **guard** — block/warn on an action (`never force-push`) | the point: the action happened | the tests; fires on tools it should not watch; the share of the target tool's calls it fires on (a partial guard firing on ~all of them is too broad) |
| **failure reaction** — act when a call fails | a false hit | precision and recall against the calls that really failed |

Scoring a guard by "did the call fail" calls a correct `no-force-push` "caught no real
failure", and a correct tool ban "95% false hits". Do not refine toward that number.

**Zero fires is not a verdict when the history cannot show the text.** If the target tool's
recorded inputs are placeholders (no command, path or URL), a condition on that text
cannot fire on the replay whatever it says. Report that, and rely on the tests.

## Repair in place — never redraft from scratch

When a test fails, show the failing calls **verbatim** with what was expected
(`MUST FIRE … did not`, `MUST BE ALLOWED … fired`), and change only the condition that
decides them. Keep the name, mode and reason. Re-run both lists and the replay; keep
whichever version passes more tests — a repair that went backwards does not win for being
newer.

## Check the builtins — and whether they can see this agent

If a builtin already does exactly this, enable it instead of shipping a copy. But builtins
match canonical tool names (`Bash`, `Read`, `Write`); on an agent whose calls arrive as
`bash.run` or a raw MCP name they never fire, and the custom policy is the answer.
