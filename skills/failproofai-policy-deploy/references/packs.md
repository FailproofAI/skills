# Policy packs

The third way a policy reaches a machine, beside a local file and a cloud deploy: a versioned,
content-addressed bundle installed from a GitHub release. Undocumented on the docs site
(`grep -rn "failproofai pack" docs/policies/` finds nothing) but a first-class subcommand — and
how the 38 non-alwaysOn builtins now ship (`policy-pack/failproofai-pack.json`, id
`failproofai/builtins`, effect `enforce`).

Reach for a pack when a rule set is **shared and versioned but not centrally operated**: several
repos, one team's conventions, no cloud account required. Reach for the cloud lane
(`cloud-lane.md`) when someone has to be able to change what a machine enforces without touching
that machine.

## The commands

```bash
failproofai pack list
failproofai pack add FailproofAI/policies --category secrets,git
failproofai pack add github:acme/finance@v1.2.0 --only block-refunds
failproofai pack remove acme/finance          # the ID, never the source string
```

`pack list` is the only surface showing a pack's digest, source and effect. The `failproofai
policies` listing shows a `Pack — <id>@<version>` block per pack, with `observe` rendered per row.

**`pack list` exits non-zero whenever any recorded pack failed to load**, having printed the
listing fine. Exit 0 is not "the listing worked"; it is "the listing worked and every pack
loaded".

## What lands on disk

Three release assets — `failproofai-pack.mjs`, `failproofai-pack.json`, `SHA256SUMS` — installed
under `~/.failproofai/policies/packs/` with content-addressed `artifacts/<sha256>.mjs` and an
`installed.json` pointer written last and atomically.

**The digest is verified at install and re-verified immediately before every import**
(`pack-manifest.ts`, grep `failed integrity verification`). That buys two things: a pack cannot
change under a machine after install, and a repo that retags or force-pushes an asset stops
loading rather than silently running something else.

It is **not a signature.** Whoever controls the release controls `SHA256SUMS` too, and signing was
deliberately deferred (`pack-store.ts`, grep `The trust this does and does not give you`). Say
that plainly when recommending a third-party pack: the integrity check protects against the
artifact changing, not against the publisher.

## Selection resolution

In order (`pack-store.ts`, grep `resolveSelection`):

| Reason printed | When |
|---|---|
| `everything in the pack` | `--all` |
| `your selection` | `--category` and/or `--only`, unioned |
| `your existing selection` | no flags, already installed — an upgrade carries your picks |
| `the pack's defaults` | no flags, first install — the author's `defaultEnabled` set |

Four traps in that table:

- **`--all` silently overrides `--only` and `--category`.** The early return sits above both
  blocks and nothing warns.
- **Unknown flags are ignored just as quietly.** `--onlyy block-refunds` installs the pack's
  defaults instead, with no error.
- **A bare `pack add owner/repo` takes `defaultEnabled`** — **10 of 38** for the builtins pack,
  fewer than the 14 in the recommended set. Adding the builtins pack is not equivalent to setup.
- **`remove` then `add` resets your selection to the pack's defaults.** Removal deletes the
  `installed.json` record, so the carry-forward branch no longer sees a prior install. Upgrading
  in place carries it; a remove/re-add does not, and nothing warns.

## Versions and reproducibility

A tagless source resolves `releases/latest` **once** and pins the tag, printed as
`(newest release; pinned to <tag>)`. Re-running the same command later can install something
else — so a bare `pack add owner/repo` is **not reproducible in a Dockerfile**. Pin the tag
explicitly there: `pack add github:acme/finance@v1.2.0`.

`pack remove` prints "re-adding it works offline". It does not: `addPack` always hits the network
and throws under `FAILPROOFAI_NO_DOWNLOAD`. The only disk-sourced install is
`installBundledPack()`, reading `policy-pack/` from the npm package.

## Effect is the publisher's, not yours

Effect is **publisher-set, whole-pack, with no CLI override**. There is no per-policy
`enforce`/`observe` for a pack the way there is for a cloud deploy — that difference is the main
reason to choose one mechanism over the other.

`pack list`'s per-policy chip is derived purely from selection, so it reads `on` inside an
`observe` pack. Effect appears once, in the header rows. Read the header before concluding a pack
is blocking anything.

Packs may not declare `alwaysOn`; the check is `"alwaysOn" in raw`, so even `"alwaysOn": false`
refuses the install.

## Fail-closed, narrowly

When a pack the machine was told to **enforce** will not load, `missingGuards()` registers a
synthetic `pack/failproofai-pack-unavailable` at priority 1 (above builtins at 0), matching only
the union of the missing policies' declared events and tools (`pack-failclosed.ts`).

Four carve-outs, each deliberate:

- Only `module_not_found`, `syntax_error`, `runtime_error` and `path_missing` trigger it.
  **`load_timeout` is excluded** as transient.
- An `observe` pack that fails to load **never denies** — that would deny for something which,
  had it loaded, would have allowed. `UserPromptSubmit` instructs, never denies.
- Skipped entirely during a session pause, so a paused session gets no signal at all.
- A pack whose author marked nothing `defaultEnabled` installs completely inert, reports success,
  and **can never trigger this check** — an empty taken set means no missing guards.

Pack *loading* fails open (bad manifest → zero packs and a logged reason); a pack the machine was
told to *enforce* fails closed. Same subsystem, opposite directions, split on whether an
expectation was recorded.

## Environment

| Var | Effect |
|---|---|
| `FAILPROOFAI_PACK_DIR` | pack root |
| `FAILPROOFAI_PACK_BASE_URL` | mirror — covers asset URLs *and* the latest-release redirect |
| `FAILPROOFAI_NO_DOWNLOAD` | refuse to fetch. Installed packs keep enforcing |

These follow the local binary, so they are `FAILPROOFAI_*`. The cloud CLI reads `FP_*` — `FP_HOME`,
`FP_JSON`, `FP_TOKEN`, `FP_API_KEY`, `FP_ORG`, `FP_DASHBOARD_URL` — plus `FAILPROOFAI_HOME`, and no
`AGENTEYE_*` variable at all. The prefix follows the binary; do not port a name across.
