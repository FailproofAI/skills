# The do-not-rename register

The cloud half of this product was called **AgentEye** and is now **FailproofAI Cloud**. Use
the new name in anything you write, spelled the way the binary spells it — one word, no space
inside "FailproofAI". Never introduce "AgentEye" yourself.

But the old name survives wherever a rename would break something on the wire, on disk, or in
a package index. **Those are literals, not style.** Renaming one does not make a document
tidier; it makes a request 401, a spool go unwatched, a `pip install` 404, or a permission
grant vanish. Every entry below is grouped by **the artifact that still reads it**, with one
reason per line.

The single exception to "never modernise" is environment variables, and the rule there is
narrow: **the prefix follows the binary.** `fp` reads `FP_*` and zero `AGENTEYE_*`; legacy
`agenteye` reads `AGENTEYE_CLI_*` and zero `FP_*`. That sentence has two halves and only the
env half changed — the header, cookie, registry and table half is still absolutely true. Do
not delete the second half when you quote the first. Details in `references/env-vars.md`.

---

## The wire and the session — `fp` still sends every one of these

| Literal | What breaks if you rename it |
|---|---|
| `X-AgentEye-Org` | the tenant header. Renaming it silently resolves to the **default** org instead of erroring |
| `X-AgentEye-Client` | client identification on every request |
| `X-AgentEye-Signature` | request signing. A renamed header is an unsigned request |
| cookie `ae_session` | the session itself. `login` sets it; every session-mode command sends it |
| OpenAPI title `"AgentEye API"` | generated clients key off the title. Change it and every regenerated client changes its package name |

`X-AgentEye-Org` has a second edge worth knowing: it appears only in the spec's
`info.description` prose and is **not declared as a parameter on any operation**, so a
generator will not produce it for you. You have to add it by hand, spelled exactly as above.

## The local daemon's spool — the collector's contract

| Literal | What breaks if you rename it |
|---|---|
| `AGENTEYE_HOME` | the `~/.agenteye` root. It is a **path, not a credential** — the only `AGENTEYE_*` name the local codebase reads |
| `~/.agenteye/events` | the legacy SDK event spool. The daemon still watches it, indefinitely, alongside the current root |

This did not move when everything around it was renamed **because it is a contract with the
collector rather than a preference**. A machine whose spool path changed stops delivering, and
nothing reports it as an error — events simply stop arriving.

## Ingest credentials — two different keys, neither of them the CLI's

| Literal | What breaks if you rename it — or reuse it |
|---|---|
| `AGENTEYE_KEY` | the collector's **ingest** bearer, normally scoped to `events:add` alone. Hand it to `fp` and every read command 403s for no visible reason |
| `AGENTEYE_API_KEY` | the dashboard service's own **admin-grade** key. Hand it to `fp` and you have silently promoted an operator credential to "the CLI's identity" |

**`FP_API_KEY` was named deliberately so it would not collide with either**, because on a
dashboard host both of those variables are typically already set. Never tell anyone to reuse
one for the other, in either direction.

## Evaluator packaging — never renamed upstream at all

| Literal | What breaks if you rename it |
|---|---|
| dist `agenteye-evaluator` | the package index name. `pip install` fails |
| module `agenteye_evaluator` | every `import` in every evaluator service anyone has written |
| user-agent `agenteye-server/<version>` | how the evaluator identifies itself to the service it calls |
| the skill `agenteye-evaluator` | see *Skill names* below — this is the one sibling that keeps its old name |

The evaluator is the clean case: it was not renamed, so there is nothing here to modernise and
no migration to describe. Cross-reference it by its real name.

## Self-hosted infrastructure

| Literal | What breaks if you rename it |
|---|---|
| `ghcr.io/agenteye-enterprise/*` | the private image registry. A renamed path pulls nothing |
| k8s namespace `agenteye` | every manifest, overlay and RBAC binding in a running cluster |
| ClickHouse table `agenteye.events` | every saved query, every dashboard panel, `fp query run` |
| ClickHouse table `agenteye.agent_sessions` | the same |

## Retired grants and arguments the server still parses

The server accepts the old spellings **forever**, so pre-rename keys keep working. That is a
compatibility guarantee, not a deprecation warning — but two of them expand wider than they
read:

| Literal | What it maps to now |
|---|---|
| `incidents:read` | `issues:read` |
| `incidents:write` | `issues:create` |
| `incidents:ack` | **all three** of `issues:read`, `issues:create`, `issues:close` |
| `alerts:ack` | **all three** of `issues:read`, `issues:create`, `issues:close` |
| the `INCIDENT_ID` positional on `fp issues show` | the issue id. The CLI still calls them incidents throughout its help |

A script still passing `--add alerts:ack` is granting issue-closing authority to whoever it
provisions. Audit those before assuming a key is read-only.

`policies:read`, `policies:write`, `policies:pull` and `agent:use` are in the admin catalog but
appear **nowhere in the `/v1` OpenAPI spec** — enforcement lives on `/enforcement/v1/*`,
deliberately off the public surface. Their absence from the spec is not evidence they do not
exist. `usage:read` *is* in the spec.

---

## Packaging names that are easy to get backwards

Not AgentEye survivals — just pairs where the module and the distribution differ, and writing
the wrong half installs nothing.

| Write this | Never write this | Why |
|---|---|---|
| `uv tool install fp-cloud-cli` | `uv tool install fp-cli` | `fp_cli` is the **module**; `fp-cloud-cli` is the **distribution**. The module name installs nothing |
| dist `agenteye` / module `agenteye_cli` | — | the legacy cloud CLI, 0.1.13. A separate package that is still installable |
| `npm i -g failproofai` | — | the local CLI, Node >= 20.9 |
| module `failproofai_sdk` | `agenteye` (as a Python import) | the Python SDK's module **genuinely was renamed** |

## Skill names — already shipped upstream, do not invent alternatives

| Current name | Was | Notes |
|---|---|---|
| `fp-cloud-cli` | `agenteye-cli` | mirror, synced from upstream |
| `failproofai-sdk` | `agenteye-python-sdk` | mirror. The module genuinely renamed to `failproofai_sdk` |
| `agenteye-evaluator` | — | **not renamed upstream.** Keep this name when cross-referencing it |
| `failproofai` | — | maintained in this repo |
| `failproofai-policy-author` | — | maintained in this repo |
| `failproofai-policy-publish` | — | new |
| `failproofai` | — | the complete umbrella skill |

**The three mirrors are marked "do not hand-edit."** Never edit files under
`skills/fp-cloud-cli/`, `skills/failproofai-sdk/` or `skills/agenteye-evaluator/`. If one
of them contradicts this page, the fix belongs upstream — and the directory name on disk may
lag the shipped skill name, which is not a discrepancy to correct locally.

---

## The `AGENTEYE_TOKEN` trap

It appears twice in the SDK install doc:

```
GITHUB_TOKEN=$AGENTEYE_TOKEN gh release download …
curl -fsSL -H "Authorization: Bearer $AGENTEYE_TOKEN" -L …
```

**It is an invented placeholder for a GitHub personal access token.** No artifact in this
product defines it, nothing reads it, and what it authenticates is a release download from
GitHub — not FailproofAI, not the dashboard, not the collector.

**It must not become `FP_TOKEN`.** A mechanical rename here points a GitHub credential at the
dashboard, or a dashboard session at GitHub. Neither fails in a way that names the cause: you
get a 401 from a host nobody was thinking about.

It is not on the do-not-rename list because something reads it. It is here because it is the
name most likely to be "fixed" by a search-and-replace that is otherwise doing the right thing.

## Other names with no read site

Do not go hunting for these; they resolve to nothing in the local codebase.

| Name | Where it actually lives |
|---|---|
| `FAILPROOFAI_KEY` | nowhere. A shell placeholder in docs for a pasted token |
| `AGENTEYE_SPOOL_TO_FAILPROOFAI` | the Python SDK. Not the local CLI or daemon |
| `AGENTEYE_ENVIRONMENT` | the Python SDK. Not the local CLI or daemon |
| `AGENTEYE_ORG` | legacy `agenteye` and the Python SDK — **not** the local codebase, and not `fp`, which uses `FP_ORG`. The header it becomes is still `X-AgentEye-Org` |

---

## Product name spelling

Use **FailproofAI Cloud** uniformly — the binary's own spelling. Not "Failproof AI Cloud", not
"failproof.ai Cloud", not "AgentEye Cloud".

The default dashboard host is `https://app.befailproof.ai`. Older CLI error hints still print
`https://be.failproof.ai`, which is a **stale host** — do not copy it into anything.

## The one-sentence test

Before renaming any occurrence of `agenteye` / `AgentEye`, ask: **does something read this, or
does something only display it?**

- Read by a server, a daemon, a package index, a registry, a cluster, or a permission parser →
  it is a literal. Leave it.
- Displayed to a human, in prose you are writing → modernise it to FailproofAI Cloud.
- An environment variable → neither. The prefix follows the binary; pick the family that
  matches the binary the command will run.
