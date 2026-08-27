# Policy pack publishing reference

## Command map

```bash
failproofai publish --init [file]
failproofai publish [policy-file] [options]
failproofai policies show <owner>/<repo>
failproofai policies show <owner>/<repo> --releases
failproofai policies add <owner>/<repo> [--policy a,b] [--category x,y] [--all]
failproofai policies remove <pack-id>
```

`policy`, `pack`, and `p` remain compatibility spellings for `policies`; write the current
`policies` spelling in new documentation.

## Source discovery

`publish` recognizes policy files by their contents: they import FailproofAI and register
one or more entries with `customPolicies.add`. Discovery is non-recursive. If discovery finds
multiple candidates, pass the intended source explicitly or organize the directory so the
set is unambiguous.

Every policy included in a pack needs a unique name. The pack build rejects an artifact that
registers no policy or registers duplicate names.

## Identity and versions

The default pack id is the GitHub repository, `<owner>/<repo>`. `--id` can override it, but
stable ids are important because consumer configuration and updates identify the pack by id.

Without `--version`, a tag on `HEAD` wins; otherwise the version is a 12-character commit
SHA. The full commit is recorded as provenance. The default tag is the version. A manual tag
must describe the selected version (a leading `v` is accepted).

Commit-derived versions are intentionally immutable but not naturally ordered. Use:

```bash
failproofai policies show <owner>/<repo> --releases
```

to see release history in publication order.

## Pack effect and defaults

The pack effect is `enforce` or `observe` and applies to every policy in the pack. Consumers
cannot override it per policy at install time.

Individual policies can define `category` and `defaultEnabled`. A bare installation enables
the publisher defaults; consumers can instead choose with `--policy`, `--category`, or
`--all`.

## Integrity model

The release contains a manifest, bundled entry module, and checksum file. Installation
verifies the manifest and content digest, and the installed artifact is rechecked before
loading. This detects changed or corrupted assets. It is not publisher identity verification:
whoever controls the GitHub release controls both the artifact and its checksum.

## Public repository requirement

Consumers fetch release assets anonymously. A private repository therefore cannot provide
the normal public install path. If the CLI warns about a private target, do not present the
pack as generally installable.

## Publishing boundaries

- `failproofai publish` publishes a GitHub release; it does not push source commits.
- Publishing does not install or enable the pack anywhere.
- `failproofai policies add <owner>/<repo>` is the consumer install step.
- Cloud policy publication and fleet rollout use `fp policies`, `fp fleet`, and
  `fp guardrails`; those belong to `fp-cloud-cli` and are not policy-pack publishing.
