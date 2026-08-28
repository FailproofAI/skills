---
name: failproofai-policy-publish
description: |-
  Package policies written with FailproofAI and publish them as an installable policy pack on GitHub. Use after `failproofai-policy-author` when the policy works locally and the user wants to share, version, release, or install it through `failproofai publish` and `failproofai policies add owner/repository`.

  Covers initializing a pack, validating it locally, choosing policy metadata and defaults, Git/GitHub prerequisites, dry runs, publishing release assets, previewing the release, and verifying installation on a clean machine.

  NOT for writing the policy logic (`failproofai-policy-author`) or deploying Cloud-managed policy versions to a fleet (`fp-cloud-cli`).
---

# Publish a FailproofAI policy pack

This skill is the publishing companion to `failproofai-policy-author`:

```text
author and test the policy → commit it → build a dry run → publish to GitHub → verify an install
```

It publishes reusable policy packs with the local `failproofai` CLI. It does not operate
FailproofAI Cloud. Cloud policy versions, fleet assignment, observe/enforce rollout,
guardrails, and rollback belong to `fp-cloud-cli`.

## Start with an authored policy

If no working policy exists yet, use `failproofai-policy-author` first. Come back when the
policy registers through `customPolicies.add(...)` and has passing allow and deny/instruct
cases.

Resolve the publishing CLI:

```bash
command -v failproofai
failproofai --version
```

If it is missing, route setup to `failproofai`. Do not substitute `fp`: `fp` operates
FailproofAI Cloud, while `failproofai publish` builds and releases GitHub policy packs.

## The normal publishing workflow

### 1. Create a starter only when needed

```bash
failproofai publish --init
# or
failproofai publish --init my-policies.mjs
```

`--init` writes one runnable example policy and stops. It performs no network or GitHub
operation and refuses to overwrite an existing file. Edit and test that policy before
continuing.

### 2. Prove the policy on this machine

```bash
failproofai policies -i -c ./my-policies.mjs
```

This installs the custom file locally so the user can exercise the real agent integration.
Do not treat publication as a test of policy behavior; publishing validates whether the pack
can be loaded, not whether its rule is correct.

Policy metadata controls how consumers see and select the pack:

- `name` must be unique within the pack.
- `description` should say what behavior is guarded.
- `category` powers `policies add --category ...`.
- `defaultEnabled: true` makes the policy part of a bare install; default is false.

Use multiple policy files when that keeps categories clear. Publishing discovers files by
content in the selected directory, not by a `*-policies.mjs` filename convention. Discovery
is non-recursive.

### 3. Make the source publishable

The default version is derived from Git:

1. a tag on `HEAD`, otherwise
2. the first 12 characters of the commit SHA.

Therefore the normal path requires a Git checkout with the policy sources committed and a
clean working tree. Do not hide a dirty tree with `--version` during a normal release: the
version is meant to identify the exact source that produced the assets.

The target GitHub repository should be public because installation downloads release assets
anonymously. Publishing can create a missing repository. Authentication is discovered in
this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `gh auth token`

Never print or persist the token. The credential needs permission to create/update releases
and, when requested, create the repository.

### 4. Build without publishing

```bash
failproofai publish ./my-policies.mjs --dry-run
```

The dry run builds the release assets under `dist-pack/` by default and performs no GitHub
write. Inspect the result before the real publish. Use `--out <dir>` only when a different
artifact directory is useful.

The three installable assets are:

- `failproofai-pack.json`
- `failproofai-pack.mjs`
- `SHA256SUMS`

If several policy files or relative imports are involved, the CLI bundles them. That path
requires Bun. With no bundler available, publish one self-contained policy file.

### 5. Publish the GitHub release

In a repository with an `origin` remote, the simplest command is:

```bash
failproofai publish
```

For an explicit target:

```bash
failproofai publish ./my-policies.mjs --repo <owner>/<repo>
```

Useful overrides:

```text
--repo <owner>/<repo>   GitHub repository to publish into
--id <publisher/name>  pack id; defaults to the repository
--version <version>    override the Git-derived version
--tag <tag>            release tag; defaults to the version
--notes <text>         release notes
--out <dir>            asset output directory
--effect <effect>      enforce or observe; default enforce
--dry-run              build only; do not publish
```

`effect` applies to the whole pack. `observe` records decisions but blocks nothing;
`enforce` applies policy verdicts. Choose deliberately and state it in the handoff.

Publishing creates or reuses the release and replaces same-named release assets. It does not
push the Git source and does not install the pack on any machine.

### 6. Verify what users will receive

Preview without installing:

```bash
failproofai policies show <owner>/<repo>
failproofai policies show <owner>/<repo> --releases
```

Then verify the documented consumer path, preferably in a clean environment:

```bash
failproofai policies add <owner>/<repo>
failproofai policies
```

Install a specific release when reproducing or pinning:

```bash
failproofai policies add <owner>/<repo>@<tag-or-version>
```

Selection can be narrowed with `--policy`, `--category`, or expanded with `--all`. A bare
interactive install lets the user choose agents and policies. Never claim publication was
successful until `policies show` can read the release and an install can verify its digest.

## Safety and authorization

`--init`, local installation, `--dry-run`, and `policies show` are local/read-only enough to
run when they are within the user's request. The real `failproofai publish` mutates GitHub:
confirm the repository, visibility, version/tag, and pack effect before running it unless the
user already authorized that exact publication.

Do not create a repository, publish a release, change visibility, push commits, or open a PR
merely because the user asked to prepare a pack. Report the exact command that remains when
authorization is missing.

## Handoff

Report:

- policy files included;
- pack id and GitHub repository;
- version/tag and source commit;
- `enforce` or `observe`;
- dry-run result and generated asset directory;
- release URL if actually published;
- preview/install verification performed;
- anything intentionally left for the user.

For detailed pack semantics and consumer commands, read
[`references/publishing.md`](references/publishing.md).
