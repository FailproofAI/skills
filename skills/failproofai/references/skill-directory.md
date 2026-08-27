# The skill family and the docs behind it

Seven skills cover FailproofAI. They overlap deliberately at the edges and refuse each
other's work in the middle, so the routing sentence matters more than the description: pick
on **what the user is trying to change**, not on which nouns they said.

    failproofai ─────────────► the way in. Orients, sets a machine up, routes.
         ├── failproofai-policy-author ──► decide what to enforce, write it, prove it decides
         ├── failproofai-policy-publish ─► publish a GitHub pack others can install
         ├── fp-cloud-cli ───────────────► query and administer FailproofAI Cloud
         ├── failproofai-sdk ────────────► instrument an agent that is not one of the 12 CLIs
         ├── agenteye-evaluator ─────────► decide what to score, build the scoring service
         └── failproofai ────────────────► all of it, at full depth, in one skill

## Install any of them

```bash
npx skills add FailproofAI/skills --skill <name> -a claude-code
```

Substitute the skill name exactly as spelled in the table below. If the specialist you want
is not installed, do the job in whichever skill you are in — each carries a compact version
of the others in `references/` — and tell the user which skill would have done it better,
with that command.

## Three of these are mirrors

`fp-cloud-cli`, `failproofai-sdk` and `agenteye-evaluator` are **synced from upstream
(`FailproofAI/failproofai`) and marked do-not-hand-edit.** Patching them here is a
maintenance bug: the next sync silently reverts your change, and in the meantime two copies
of the same claim disagree. Fix upstream, or carry the correction in a skill that is
maintained here — `failproofai`, `failproofai-policy-author`, `failproofai-policy-publish`,
`failproofai`.

Two of the three were renamed with the product; the evaluator was not. **`agenteye-evaluator`
is its real current name** — do not "fix" it. The renamed mirror folders now match their
shipped skill names: `skills/fp-cloud-cli/` and `skills/failproofai-sdk/`.

## The seven

### `failproofai` — the way in

| | |
|---|---|
| **Owns** | orientation (what the product is, which half does what), installing and connecting a machine, the daemon, hooks across 12 agent CLIs, backfill/flush/capture paths, upgrade and uninstall, the local audit, keys and org *concepts*, self-hosting |
| **Refuses** | authoring a policy, rolling one out, driving the cloud CLI, evaluator scoring, the SDK. It routes to those |
| **Route to it when** | the user is changing what is installed or connected on a machine — or does not yet know which piece of the product they need |
| **Install** | `npx skills add FailproofAI/skills --skill failproofai -a claude-code` |
| **Maintained** | in this repo |

The default destination for "what is FailproofAI", "set it up", "why isn't my agent showing
up?". Two routes run backwards into it: policy work on an unset-up machine (set up first,
then hand off — except `fp policies test`, which needs nothing), and "my SDK events never
appear", where the bug is usually delivery, not instrumentation.

### `failproofai-policy-author` — decide, write, prove

| | |
|---|---|
| **Owns** | turning a recurring behaviour or an audit finding into enforcement: is a builtin enough, what the policy should match, writing it, testing it both ways, plugging it in. Also the 39-builtin catalog, convention-file loading, and the harness enforcement matrix from the author's side |
| **Refuses** | shipping the policy onward — publishing a version, `fp fleet deploy`, rollback, proving it fired in production. Also telemetry, evaluator scoring, and repo invariants that belong in tests |
| **Route to it when** | the sentence is a complaint about agent behaviour — "my agent keeps force-pushing" — or an explicit "write a policy that blocks X" |
| **Install** | `npx skills add FailproofAI/skills --skill failproofai-policy-author -a claude-code` |
| **Maintained** | in this repo |

It reads the local audit cache directly, so the `failproofai audit` → policy hop lands here
with the findings already in hand.

### `failproofai-policy-publish` — publish a reusable policy pack

| | |
|---|---|
| **Owns** | the lifecycle after a local policy works: `failproofai publish --init`, dry runs, Git/GitHub prerequisites, pack metadata and effect, publishing release assets, previewing releases, and verifying `failproofai policies add <owner>/<repo>` |
| **Refuses** | deciding *what* to enforce or writing the policy body (`failproofai-policy-author`), Cloud policy versions and fleet rollout (`fp-cloud-cli`), and machine setup (`failproofai`) |
| **Route to it when** | a tested policy should become a versioned GitHub pack that other users or machines can install |
| **Install** | `npx skills add FailproofAI/skills --skill failproofai-policy-publish -a claude-code` |
| **Maintained** | in this repo |

It keeps the two publication systems separate: `failproofai publish` creates an installable
GitHub policy pack, while `fp policies publish` creates a Cloud-managed policy version.
Publishing a GitHub pack neither pushes source code nor installs the pack on a machine.

### `fp-cloud-cli` — query and administer the cloud

| | |
|---|---|
| **Owns** | driving `fp` against FailproofAI Cloud: sessions, events, errors, evals, usage; triaging issues, audits and alerts; keys, users, orgs, settings and saved queries; the assistant |
| **Refuses** | writing or designing an evaluator service, instrumenting an app with the SDK, debugging the collector or daemon, and unrelated dev work |
| **Route to it when** | the user wants to *read* what already landed, or change who has access — "how are my agents doing?", "give CI a push-only key", "make them read-only" |
| **Install** | `npx skills add FailproofAI/skills --skill fp-cloud-cli -a claude-code` |
| **Maintained** | **mirror — do not hand-edit** |

Was `agenteye-cli`. Its 23-command surface is the cloud half of everything the other skills
describe; when another skill says "hand off to the cloud CLI", this is the destination.

### `failproofai-sdk` — instrument your own agent

| | |
|---|---|
| **Owns** | making an agent that is **not** one of the 12 supported CLIs report what it did: planning which points in the loop to record, threading session and agent identity, emitting tool/model/hook/human events, and proving the `.jsonl` files land |
| **Refuses** | reading telemetry that already arrived or operating a deployment (`fp-cloud-cli`), and building the evaluator that scores runs (`agenteye-evaluator`) |
| **Route to it when** | the agent is a Python loop, a LangChain/LangGraph/CrewAI/LlamaIndex/Pydantic AI app, or anything custom — there are no hooks to install because there is no harness |
| **Install** | `npx skills add FailproofAI/skills --skill failproofai-sdk -a claude-code` |
| **Maintained** | **mirror — do not hand-edit** |

Was `agenteye-python-sdk`, and unlike the wire literals **the module genuinely renamed** to
`failproofai_sdk`. The SDK's job ends at the file it writes; a separate collector ships it,
which is why "my events never appear" splits between this skill and `failproofai`.

### `agenteye-evaluator` — decide what to score, build the scorer

| | |
|---|---|
| **Owns** | both halves of evaluation-you-own: choosing 2–4 dimensions worth measuring against real sessions (a plan is a valid end state, with no code), and building the HTTP service the server POSTs finished transcripts to |
| **Refuses** | reading eval results that already exist or checking whether quality dropped (`fp evals`, via `fp-cloud-cli`), instrumenting an agent, and alerting on scores |
| **Route to it when** | the user says "I want evals" or "how do I know if my agent is any good?" |
| **Install** | `npx skills add FailproofAI/skills --skill agenteye-evaluator -a claude-code` |
| **Maintained** | **mirror — do not hand-edit** |

The one skill that keeps the old name, because the package did: distribution
`agenteye-evaluator`, module `agenteye_evaluator`, user-agent `agenteye-server/<version>`.

### `failproofai` — all of it

| | |
|---|---|
| **Owns** | the whole product at full depth in one skill: both binaries' complete command surfaces, every vertical (observe, enforce, audit, administer, instrument, evaluate), env vars, the literals that must never be renamed, the glossary, and this directory |
| **Refuses** | nothing on the product — which is exactly why it is the *last* resort, not the first. It is large |
| **Route to it when** | a specialist's summary has run out, the question spans three or more of them at once, or the user explicitly wants the full reference |
| **Install** | `npx skills add FailproofAI/skills --skill failproofai -a claude-code` |
| **Maintained** | in this repo |

## Naming, so cross-references resolve

| Thing | Current name | Was |
|---|---|---|
| Product | FailproofAI | — |
| The hosted service | **FailproofAI Cloud** | AgentEye |
| Cloud binary / distribution | `fp` / `fp-cloud-cli` | `agenteye` / `agenteye` (still installable, 0.1.13, legacy) |
| Local binary / package | `failproofai` / `failproofai` (npm) | — |
| Python SDK module | `failproofai_sdk` | `agenteye` |
| Evaluator distribution | `agenteye-evaluator` | *not renamed* |

Spell the service **FailproofAI Cloud**, one word, matching the binary's own output. The
public docs site spells it "Failproof AI" with a space — do not propagate that spelling into
anything written here.

Never introduce "AgentEye" yourself, but recognise it: wire headers (`X-AgentEye-Org`,
`X-AgentEye-Client`, `X-AgentEye-Signature`), the `ae_session` cookie, the OpenAPI title,
the local daemon's `AGENTEYE_HOME` spool at `~/.agenteye/events`, ingest keys, container
registries and ClickHouse tables all still carry it, permanently. `literals.md` has the
full set.

## The docs map

Public documentation lives at **`docs.befailproof.ai`**. It is the product's own account of
itself; where it contradicts the shipped CLI, **the CLI wins** — check with `--help` before
you repeat a docs claim.

### Read it as markdown, not HTML

**Append `.md` to any docs URL.** Verified: `https://docs.befailproof.ai/start/concepts.md`
returns clean markdown; the same page without the suffix returns roughly 250 KB of HTML for
one page. Every `.md` page is also prefixed with a pointer back to the index.

Two aggregate files, and they are very different sizes:

| File | Size | What it is | Use it for |
|---|---|---|---|
| `https://docs.befailproof.ai/llms.txt` | ~52 KB | the index — all 173 pages as titled links with a one-line summary each, plus the OpenAPI spec and a support address | finding the right page. Fetch this first, always |
| `https://docs.befailproof.ai/llms-full.txt` | ~396 KB, 173 pages concatenated | every guide page **and** every API-reference page, in full | grepping for a term across the whole corpus when you do not know which page it is on |
| `https://docs.befailproof.ai/reference/openapi.json` | — | the generated OpenAPI spec | exact request/response shapes |

Read path: `llms.txt` → pick a page → fetch `<page>.md`. Reach for `llms-full.txt` only when
the index summaries do not tell you which page holds the fact — it is too large to read whole
and is meant to be searched.

### What is in each section

173 documentation pages: 65 guides plus 108 API-reference endpoints.

| Section | Pages | Covers | The pages worth knowing by name |
|---|---|---|---|
| `start/` | 15 | quickstart, concepts, choosing local vs Cloud vs enterprise, first audit, first policy, five framework quickstarts and their integration counterparts | `start/concepts.md` — the ten-noun table the whole product is built on. `start/setup.md` — the local/Cloud/enterprise fork |
| `sessions/` | 13 | the observe surface: sessions, live events, reading a trace, models, hooks, policy decisions, tools, errors, online evaluations, metrics, dashboards, queries, the assistant | `sessions/read-a-trace.md` — the documented investigation order |
| `policies/` | 10 | overview, builtins and the full builtin catalog, custom policies, local configuration, the policy editor, deploy, fleet, rollback, failure behaviour | `policies/builtin-catalog.md` — every builtin with its trigger and parameters. `policies/failure-behavior.md` — what happens when the daemon is unavailable |
| `audits/` | 9 | audits overview, the **local** offline audit, setup, agent contracts, running and reviewing, cadence, findings and issues, alerts, recipes | `audits/local-audit.md` — the half that needs no account. `audits/agent-contracts.md` — telling an audit what an agent is *for* |
| `admin/` | 5 | administration overview, usage and billing window, keys and permissions, users and organizations, settings and security | `admin/keys-and-permissions.md` — the permission vocabulary |
| `reference/` | 12 + spec | both CLIs, the policy SDK, the custom-agent SDK, the evaluator SDK, harnesses, the HTTP API, events and configuration, the local dashboard, self-hosting, troubleshooting | `reference/harnesses.md` — all 12 harnesses. `reference/failproof-cli.md` and `reference/cloud-cli.md` — one per binary. `reference/troubleshooting.md` |
| `api-reference/` | 108 | one page per endpoint, each with the behavioural notes that are not in the OpenAPI spec | grouped: audits 18, issues 15, events 13, dashboards 10, users 8, settings 7, queries 7, evaluations 7, alerts 7, permission-sets 5, keys 5, usage 2, sessions 2, health 1, auth 1 |

The API-reference summaries in `llms.txt` are unusually dense — they carry the gotchas
(which permission an endpoint really needs, what a full-replace PUT silently clears, which
delete cascades) rather than just restating the path. Reading the index entry is often
enough; fetch the page when it is not.
