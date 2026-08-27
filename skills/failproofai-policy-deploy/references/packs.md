# Policy packs

A pack is a versioned, content-addressed bundle of policies published as a GitHub release and
installed by digest. It is now **the** way a policy reaches a machine without the cloud: the npm
package ships no policies to enable any more, so a fresh machine enforces nothing until somebody
installs a pack — including ours.

Reach for a pack when a rule set is **shared and versioned but not centrally operated**: several
repos, one team's conventions, no cloud account. Reach for the cloud lane (`cloud-lane.md`) when
someone has to change what a machine enforces without touching that machine.

Grep anchors are inside the `failproofai` npm package: `node_modules/failproofai/` in an installed
project, the repo root in a checkout.

## The rule that decides everything: a slash means a source

```bash
failproofai policies add block-sudo            # no slash → a POLICY NAME
failproofai policies add acme/deploy-guard     # slash    → a PACK SOURCE
```

A policy name matches `/^[A-Za-z0-9._-]{1,128}$/` and `/` is refused inside it
(`pack-manifest.ts`, grep `PACK_POLICY_NAME_RE`), so a slash can only ever mean a pack. There is
nothing to guess and no flag to disambiguate. `github:` prefixes and `https://github.com/…` URLs
are sources too.

The two lanes then diverge in ways that look alike and are not:

| | policy name | pack source |
|---|---|---|
| What it changes | this machine's `enabledPolicies` for a scope | installs a pack machine-wide |
| `--scope` | `user` (default), `project`, `local` | **ignored** — a pack install is machine-level |
| `--cli` | whose hook config gets written | which agents the pack guards, recorded in `installed.json` |
| Selection flags | none | `--policy` / `--category` / `--all` |

Do not conflate the two `--cli`s. Both take space-separated and/or repeated values; the pack lane
also takes `--cli=a,b`. `--cli` with no value after it is refused on both lanes — it used to
install a pack that enforced nowhere and still exit 0.

**`core` is retired and throws.** `core`, `failproofai` and `official` are
`RETIRED_CORE_ALIASES` (`pack-store.ts`); typing one reaches the pack lane on purpose so that
`parsePackSpec` can answer `"core" is no longer a pack name — ours is a pack like anyone else's
now. Use FailproofAI/policies instead.`, surfaced as `Could not install pack: …`, exit 1. There is
**no offline install of anything**: `policy-pack/` is out of the package's `files` and `build`,
`installBundledPack` is deleted, and our own pack is fetched, digest-verified and pinned exactly
like a stranger's. Type it in full.

**Compatibility:** `pack`, `policy` and `p` are all spellings of `policies`, rewritten in
`bin/failproofai.mjs` above every dispatch, so nothing anyone typed before breaks. `pack list`
splits by argument — bare it becomes `policies`, with a source it becomes `policies show` — and
`pack build` becomes `publish`. Write `policies`; recognise the rest.

## The commands

```bash
failproofai policies                                    # what is on this machine
failproofai policies add                                # picker across every installed pack
failproofai policies add FailproofAI/policies           # our pack, by its full name
failproofai policies add acme/deploy-guard --category git
failproofai policies add github:acme/deploy-guard@v1.2.0 --policy block-refunds
failproofai policies show acme/deploy-guard             # read it before running it
failproofai policies show acme/deploy-guard --releases  # every release, and which is newest
failproofai policies remove acme/deploy-guard           # a pack id, or a policy name
failproofai publish ./my-policies.mjs --repo acme/deploy-guard
```

**`remove` reads `rest[0]` and nothing else** (`pack-cli.ts`, grep `function remove`). Put the
pack id immediately after the word: `failproofai policies remove --scope user acme/deploy-guard`
routes to the pack lane correctly and then takes `--scope` as the id. `add` is flag-aware and
skips every value-taking flag; `remove` is not.

**Unknown flags are ignored silently on the pack lane.** `policies add acme/deploy-guard --onlyy
block-refunds` installs the defaults, because bin's unknown-flag rejection sits below the
source-routing branch and `add()` has no check of its own. Unknown *values* are no longer silent:
an unknown `--category` throws naming the valid slugs, an unknown `--policy` throws `pack does not
contain <name>`, and a typo'd `--cli` agent is refused with a did-you-mean.

`--policy` is the spelling; `--only` still parses as a synonym. Both refuse an empty list before
any fetch.

## `policies show` — what you can read before you run it

`show` fetches `SHA256SUMS` and `failproofai-pack.json` only, verifies the manifest digest, and
parses it with the loader's own rules. **The entry artifact is never downloaded and never
imported**, so previewing a stranger's pack cannot run a stranger's code (`pack-store.ts`, grep
`fetchPackPreview`).

It prints `<id>@<version>`, `<N> policies · <C> categories`, a `Not installed. <D> of <N> are on
by default; the rest are opt-in.` line — with `This pack OBSERVES — it records and blocks
nothing.` appended when `effect` is `observe` — then a section per category with each row labelled
`default` or `opt-in`. The category slug is in the section heading, which is where you get the
spelling `--category` wants.

The tag/version agreement check is deliberately **not** applied here, so a publisher can `show`
their own broken pack and see the two values disagree.

`--releases` is one `GET /releases?per_page=100`. Counts and commit are parsed out of each release
*body*, which `publish` wrote, rather than by downloading a manifest per release; the list is
sorted locally by `published_at` because GitHub's own order ties on releases cut from one commit.
A release missing any of the three assets is marked `incomplete`. 403 rate limit tells you to
`gh auth login` or set `GITHUB_TOKEN` to go from 60/hr to 5000/hr.

Everything on that screen is publisher-controlled text shown as a claim. What a machine actually
enforces comes from the manifest it verified at install.

## Publishing: `failproofai publish`

The authoring end of the same lane. Build, create the release and upload, in one command, over the
GitHub REST API — deliberately **not** `gh release create`, which the product's own
`block-gh-pipeline` builtin matches.

```bash
failproofai publish --init                              # one runnable starter policy, no network
failproofai publish ./my-policies.mjs --dry-run         # build the three assets, publish nothing
failproofai publish ./my-policies.mjs --repo acme/deploy-guard
failproofai publish                                     # discover, ask, publish
```

A bare `publish` on a TTY inside a git checkout is the headline path: it discovers policy files in
the cwd **by content**, non-recursively, asks where to publish, infers the version, bundles,
creates the repo public if missing, and replaces the three assets on the release.

| Flag | Effect |
|---|---|
| `--repo <owner>/<repo>` | where to release. Absent ⇒ implicit dry run, id falls back to `local/<folder>` |
| `--id <publisher/name>` | pack id, defaults to `--repo` |
| `--version` / `--tag` | override the inferred version; the tag must describe it |
| `--effect enforce\|observe` | whole-pack, publisher-set. Default `enforce` |
| `--out <dir>` | asset output, default `dist-pack` |
| `--dry-run` | build locally, publish nothing, read no credential |
| `--allow-private` | publish to a private repo anyway — see below |

Credential is `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`; missing is exit 1.

**Two refusals fire before anything is created**, and both exist because the failure they prevent
is silent:

- `Tag <t> does not describe version <v>, so nobody could install it.` `packTagMatchesVersion`
  compares only the segment after the last `/` and accepts one leading `v`, so `v1.0.0` for
  version `1.0.0` passes.
- `<repo> is PRIVATE, so nothing was published.` Installs fetch release assets over anonymous
  HTTPS with **no Authorization header by design**, so every install of a private pack would 404.
  `--allow-private` publishes anyway, and the success message then prints the warning *instead of*
  the install lines rather than underneath them.

**The version is the commit, not semver.** With no `--version`, `publish` takes a tag on HEAD, then
the 12-character short SHA (`pack-cli.ts`, grep `VERSION_SHA_LENGTH`); the full SHA goes in the
manifest's `commit`. It refuses rather than approximates — no checkout, a dirty tree, or policy
sources not in HEAD each get their own message — and `--commit` is not recorded on a dirty tree
even when `--version` let the publish through. The cost is real: a SHA carries no ordering, which
is why `policies show <source> --releases` is the only place "am I on the newest?" gets answered.

`publish` bundles for you when it finds several policy files or a relative import, so nobody is
sent off to configure esbuild. It refuses an entry that registers nothing, and two policies sharing
a name — a name is what `--policy` selects and what the picker toggles.

Releases are always `draft: false, prerelease: false`, for the redirect reason below.

## What lands on disk

Three release assets, always these names: `failproofai-pack.json` (manifest),
`failproofai-pack.mjs` (entry), `SHA256SUMS`. `SHA256SUMS` lines are `<sha256>  <filename>`.

```
~/.failproofai/policies/packs/
  artifacts/<sha256>.mjs      content-addressed, shared across packs and versions
  installed.json              { "schemaVersion": 1, "packs": [...] } — written last, atomically
```

`FAILPROOFAI_PACK_DIR` overrides the root. Only schema version 1 is accepted; an unknown schema
yields zero packs and one error.

**The digest is verified at install and re-verified immediately before every import**
(`pack-manifest.ts`, grep `failed integrity verification`). That buys two things: a pack cannot
change under a machine after install, and a repo that retags or force-pushes an asset stops
loading rather than silently running something else. Artifact cap 8 MiB, fetch timeout 30s.

It is **not a signature.** Whoever controls the release controls `SHA256SUMS` too. Say that plainly
when recommending a third-party pack: the integrity check protects against the artifact changing,
not against the publisher.

Only the **entry** is content-addressed, which is why `publish`'s build step refuses an entry with
unbundled relative imports — the digest would cover one file out of several.

**No command prints the digest.** `pack-cli.ts`'s `list()` still renders digest, source and effect,
but it has no CLI door left: bin rewrites bare `pack list` to `policies`, which goes to
`manager.ts`'s `listHooks`, and the only `runPackCommand` call site passes `list` solely *with* a
source. Read `installed.json` when you need the digest.

## Manifest format

`failproofai-pack.json` — `{ id, version, effect, commit?, policies[] }`
(`pack-manifest.ts`, grep `PACK_ID_RE`):

| Field | Rule |
|---|---|
| `id` | `<publisher>/<name>`, `/^[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._-]{1,64}$/` |
| `version` | `/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/` — loose enough for semver and a tag |
| `effect` | `enforce` (default) or `observe`. Whole-pack, publisher-set, **no CLI override** |
| `commit` | 7–40 lowercase hex, **provenance only** — malformed is dropped, never fatal |
| `policies[]` | `{ name, description, category, defaultEnabled, match }`, all five required |

`defaultEnabled` must be a real boolean. `match.events` / `match.toolNames` must be arrays of
non-empty strings when present. A policy name may not contain `/`: `registerPolicy` replaces by
canonical name, so a pack shipping `failproofai/block-sudo` would overwrite the compiled builtin
with its own code — the loader prefixes pack names instead, which is what keeps a pack out of the
builtin namespace.

**Packs may not declare `alwaysOn`.** The check is `"alwaysOn" in raw`, so even `"alwaysOn": false`
refuses the install. That is exactly why the one always-on guard ships compiled into the binary and
cannot travel this lane.

Effect being whole-pack is the main reason to choose a pack over a cloud deploy, or the reverse:
there is no per-policy `enforce`/`observe` here the way there is for `fp fleet deploy`. The local
listing's per-row chip is derived from selection, so it reads `on` inside an `observe` pack — read
the pack header before concluding anything is blocking.

## How `owner/repo@tag` resolves

| Spelling | Resolves how |
|---|---|
| `acme/deploy-guard` | `releases/latest` **redirect**, pinned to the concrete tag it names |
| `acme/deploy-guard@v1.2.0` | that tag, directly |
| `acme/deploy-guard@a1b2c3d` | 7–40 hex ⇒ the release whose body names that commit |
| `github:acme/deploy-guard@v1.2.0` | same as the shorthand |
| `https://github.com/acme/x/releases/tag/v2` | tag from the URL |
| `https://github.com/acme/x/releases/download/v2/failproofai-pack.mjs` | tag from the URL |
| `https://github.com/acme/x` | bare repo ⇒ latest |

Asset URLs are **constructed** from owner/repo/tag. There is no index and no discovery, which is
what leaves nothing to poison. A tagless source is resolved to a concrete tag *before* anything is
written, and that concrete tag is what `installed.json` records — so what a machine reinstalls is
pinned even when the person who typed it did not know the version.

**The latest-release redirect has a price worth writing down.** It is read from
`releases/latest` on the asset host rather than the API — same origin, no 60/hr limit, follows
`FAILPROOFAI_PACK_BASE_URL`. But GitHub issues that redirect only for a published, non-prerelease
release. A repo whose newest release is a draft or prerelease either redirects to an **older stable
tag** — you silently pin something superseded, and it is undetectable from here — or issues no
redirect at all, which errors and names the prerelease case. Name a tag whenever a publisher's
newest release is not their newest stable one.

`@<commit>` is the one spelling that hits `api.github.com`: it reads
`GET /repos/<o>/<r>/releases?per_page=100` and matches the `commit <sha>` line each release body
carries (`pack-store.ts`, grep `resolveTagForCommit`). A hex ref matching no release falls back to
being a literal tag; a prefix matching two releases is refused with both tags and full SHAs named.
`GITHUB_TOKEN` / `GH_TOKEN` are used here only for the rate limit — installs send no
`Authorization` header at all.

**A bare `policies add owner/repo` is still not reproducible in a Dockerfile.** It pins at install
time, not at write time; re-running the same line later can install something else. Pin the tag
there: `failproofai policies add github:acme/deploy-guard@v1.2.0`.

## Install order, and two refusals that are not about integrity

`parsePackSpec` → resolve tag → fetch `SHA256SUMS`, manifest, entry → verify both digests → parse
identity and policies → `packTagMatchesVersion` → write `artifacts/<sha256>.mjs` → **import once and
check it registers exactly what the manifest declared** → write `installed.json` last, atomically.

That import check (`pack-store.ts`, grep `verifyArtifactRegisters`) runs after the artifact is
written and before `installed.json`, so a refusal leaves the machine exactly as it was. It closes
the worst pack failure there was: a one-name typo between manifest and entry used to install
reporting `2/2 enabled` and then convert into a machine-wide deny, because a declared policy that
never registers is precisely what the fail-closed guard denies for.

Then two refusals about identity rather than bytes:

- **An id is bound to the repo it first came from.** A second source for an installed id is refused
  with `pack id X is already installed from Y`. Compared on the repository, so `@v1.2.0` →
  `@v1.3.0` still upgrades.
- **The inverse deletes a record.** `priorRecordFor` matches by **digest** as well as id, so
  installing a pack whose entry bytes are byte-identical to an installed one under a different id
  *absorbs* it: `Replaced <ids> — same artifact, so it was taken as this pack renamed`. You are
  told, and told to re-add if the guess was wrong, but the row is gone.

## Selection resolution

On a TTY with no selection flag, `policies add <source>` asks **twice** before installing: which
agents the pack should guard (all 12 of `INTEGRATION_TYPES` pre-ticked, detected ones hinted
`installed here`), then which of its policies
should be on — built from the **manifest only**, publisher defaults pre-ticked, grouped by
category. Cancelling either prints `Nothing installed.` and exits 0. Selection flags or a non-TTY
skip both prompts entirely, which is what makes "a bare add takes `defaultEnabled`" true only off
a terminal.

In order (`pack-store.ts`, grep `resolveSelection`):

| Reason printed | When |
|---|---|
| `everything in the pack` | `--all` |
| `your selection` | flags or picker on a first install; the picker on any install |
| `what you added, plus what was already on` | flags on a pack already installed |
| `your existing selection` | no flags, already installed — an upgrade carries your picks |
| `the pack's defaults` | no flags, first install — the author's `defaultEnabled` set |

Traps in that table:

- **Flags merge; the picker replaces.** `selectionFrom()` sets `merge: true` unconditionally, so on
  an installed pack `--category git` means "*also* turn Git on" — the command's first word is
  `add`. The picker overrides `merge` back to false because its list is the complete answer, which
  is the only reason unticking can turn anything off. An empty pick is a real answer, carried as an
  explicit empty list: the pack installs and enforces nothing.
- **`--all` silently overrides `--policy` and `--category`.** The early return sits above both
  blocks and nothing warns.
- **`remove` then `add` resets to the publisher's defaults.** Removal deletes the record the
  carry-forward branch reads. Upgrading in place carries your picks; a remove/re-add does not, and
  nothing warns.

## Fail-closed, narrowly

Pack **reading** fails open per-pack: `readInstalledPacks` never throws and one malformed
third-party pack cannot switch off the others. Pack **enforcing** fails closed. Same subsystem,
opposite directions, split on whether an expectation was recorded — the trigger is always
"something was declared and is not running", never "nothing is running". An absent `installed.json`
is a fresh machine, not a broken one.

When a pack the machine was told to **enforce** will not load, `missingGuards()` registers a
synthetic `pack/failproofai-pack-unavailable` at priority 1 — above builtins at 0 and custom at
−1 — matching only the union of the missing policies' declared events and tools
(`pack-failclosed.ts`). Its refusal text names `failproofai policies`, then `failproofai policies
add <source>`, and says the agent cannot run those itself.

Five carve-outs, each deliberate:

- Only `module_not_found`, `syntax_error`, `runtime_error` and `path_missing` trigger it.
  **`load_timeout` is excluded** as transient and load-dependent.
- An `observe` pack that fails to load **never denies** — that would deny for something which, had
  it loaded, would have allowed.
- **`UserPromptSubmit` instructs, never denies**, whatever the missing policy declared. A blanket
  deny there locks the user out of their agent entirely.
- **A pack narrowed with `--cli` does not deny on the agents it was never scoped to**
  (`pack-failclosed.ts`, grep `outOfScope`) — a pack scoped to `codex` that failed to load used to
  deny on `claude` too. But **unreadable scope means every agent, never none**: the check is
  `Array.isArray`, because a `clis` of `"codex"` is a truthy value with a `length` and an
  `includes`, and reading it loosely turned a guard against over-denying into one that under-denies.
- Skipped entirely during a session pause, so a paused session gets no signal at all.

A pack whose author marked nothing `defaultEnabled` installs completely inert, reports success, and
can never trigger this check — an empty taken set means no missing guards.

## How the builtins ship

They are a pack, published like anyone's: `FailproofAI/policies`.

| Number | Is |
|---|---|
| **39** | built-in policies compiled into the package — `POLICY_CATALOG` in `src/hooks/policy-catalog.ts`, asserted at `__tests__/scripts/copy-counts.test.ts` |
| **1** | of those is `alwaysOn` — `block-failproofai-commands` |
| **38** | policies the pack can carry, and does |
| **10** | of those are `defaultEnabled` — what a bare install turns on |

39, not 40: `block-self-pause` and `block-failproofai-commands` were merged into one always-on
guard. Anything saying 40, 41 or "over 40" is stale, including `docs/policies/builtin.mdx` and the
landing site, neither of which is covered by the count test.

```bash
failproofai policies show FailproofAI/policies    # read it first
failproofai policies add FailproofAI/policies     # 10 of 38 on
failproofai policies add FailproofAI/policies --all
```

**The npm package still enforces exactly one policy**, `block-failproofai-commands`
(`policy-catalog.ts`, `alwaysOn: true`). It matches `PreToolUse` and `PermissionRequest` on `Bash`,
`Write`, `Edit` and `NotebookEdit`; `alwaysOn` bypasses the enabled set entirely, including an
active session pause and a config file that failed to parse. It cannot travel the pack lane
precisely because packs may not declare `alwaysOn` — which is why it is compiled in.

So a fresh machine finishes `failproofai config` with **nothing enforcing but that one guard**.
That is the intended end state, not a broken install: setup wires hooks into every supported agent
at global scope and chooses no policies at all. Enforcement arrives when someone installs a pack.

One shim exists and is not a feature: a machine that *upgraded* into this build with
`enabledPolicies` set and no pack installed keeps enforcing those compiled builtins and logs that
it is doing so (`handler.ts`, grep `because no pack is installed`). It stops dead the moment any
pack is installed, and never fires on a machine set up by this version. Do not describe the
compiled builtins as a fallback that persists.

Do not read the `FailproofAI/policies` repo tree for any of this. Three stale files sit committed
at its root from an older build script, declaring id `failproofai/builtins`; installs read the
**release assets**, never the tree, so they are inert. `docs/` in the product repo is stale too —
it still documents `failproofai pack add core` as an offline install. Read `src/hooks/` and
`bin/failproofai.mjs`.

## Environment

| Var | Effect |
|---|---|
| `FAILPROOFAI_PACK_DIR` | pack root — where `installed.json` and `artifacts/` live |
| `FAILPROOFAI_PACK_BASE_URL` | mirror — covers asset URLs *and* the latest-release redirect |
| `FAILPROOFAI_NO_DOWNLOAD` | refuse to fetch. Installed packs keep enforcing; `add` and `show` throw |
| `FAILPROOFAI_GITHUB_API` | `@<commit>` resolution, `--releases`, and `publish` |
| `FAILPROOFAI_GITHUB_UPLOADS` | `publish` asset uploads |
| `GITHUB_TOKEN` / `GH_TOKEN` | **required** for `publish`; on installs, rate limit only |

These follow the local binary, so they are `FAILPROOFAI_*`. The cloud CLI reads `FP_*` — `FP_HOME`,
`FP_JSON`, `FP_TOKEN`, `FP_API_KEY`, `FP_ORG`, `FP_DASHBOARD_URL` — plus `FAILPROOFAI_HOME`, and no
`AGENTEYE_*` variable at all. The prefix follows the binary; do not port a name across.
