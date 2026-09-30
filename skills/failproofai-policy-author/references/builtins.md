# Builtin policies (40)

**Generated — do not hand-edit.** Regenerate with:

```bash
bun "$SKILL_DIR/scripts/sync-builtins.mjs"   # $SKILL_DIR = this skill's folder
```

This snapshot goes stale whenever a builtin is added, renamed, or has its default
flipped. When it matters, ask the CLI instead — it is always current:

```bash
failproofai policies          # every policy, with enabled status and params
```

## How to use this for triage

Enabling a builtin beats writing a custom policy: nothing to maintain, no naming
trap, no fail-open risk, and it ships with tests.

Before concluding "no builtin covers this", check whether a **parameterized** one
does — several take allowlists or thresholds that widen their scope considerably.
Params go in the `policyParams` map, keyed by short name.

To enable one, switch it on in the FailproofAI pack, which is machine-wide:

```bash
failproofai policies add FailproofAI/policies                      # once, if not installed: its defaults
failproofai policies add FailproofAI/policies --policy block-rm-rf # adds to what is on
```

`--policy` on a first install enables only the names given. `enabledPolicies` in
`policies-config.json` is read only while no pack at all is installed on the machine;
installing any pack, a Jev pack included, stops those builtins loading (`handler.ts`,
grep `packsInstalledHere`).

_(reviewable by: …)_ marks a policy Jev may clear once Jev runs in enforce mode:
only when every named check was asked about the call and none denied. The rest are
hard. SKILL.md *Jev* and `traps.md` §10.

---

### Sanitize

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `sanitize-jwt` | **on** | PostToolUse | Stop Claude from reading JWTs in tool responses |
| `sanitize-api-keys` | **on** | PostToolUse | Stop Claude from reading API keys (OpenAI, Anthropic, GitHub, AWS, Stripe, Google) in tool responses _(params: additionalPatterns)_ |
| `sanitize-connection-strings` | **on** | PostToolUse | Stop Claude from reading database connection strings with embedded credentials in tool responses |
| `sanitize-private-key-content` | **on** | PostToolUse | Stop Claude from reading PEM private key content in tool responses |
| `sanitize-bearer-tokens` | **on** | PostToolUse | Stop Claude from reading Authorization Bearer tokens in tool responses |

### Environment

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `protect-env-vars` | **on** | PreToolUse | Prevent commands that read environment variables _(reviewable by: env-secrets-dump, secret-exposure)_ |
| `block-env-files` | **on** | PreToolUse | Block reading/writing .env files _(reviewable by: secret-exposure)_ |
| `block-read-outside-cwd` | off | PreToolUse | Block file reads outside the session working directory _(params: allowPaths)_ _(reviewable by: read-outside-workspace)_ |

### Dangerous Commands

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `block-sudo` | **on** | PreToolUse, PermissionRequest | Block sudo commands _(params: allowPatterns)_ |
| `block-curl-pipe-sh` | **on** | PreToolUse | Block piping downloads to shell |
| `block-rm-rf` | off | PreToolUse | Prevent catastrophic deletions _(params: allowPaths)_ _(reviewable by: destructive-deletion)_ |
| `block-failproofai-commands` | **on** | PreToolUse, PermissionRequest | Block failproofai CLI commands, self-pause and uninstallation |
| `block-secrets-write` | off | PreToolUse | Block writing secret key files _(params: additionalPatterns)_ _(reviewable by: secret-exposure)_ |

### Infra Commands

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `block-kubectl` | off | PreToolUse | Block kubectl commands (Kubernetes cluster mutations) _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-terraform` | off | PreToolUse | Block terraform and tofu (OpenTofu) commands _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-aws-cli` | off | PreToolUse | Block aws CLI commands _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-gcloud` | off | PreToolUse | Block gcloud (Google Cloud) CLI commands _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-az-cli` | off | PreToolUse | Block az (Azure) CLI commands _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-helm` | off | PreToolUse | Block helm commands _(params: allowPatterns)_ _(reviewable by: production-infra-change)_ |
| `block-gh-pipeline` | off | PreToolUse | Block gh CLI pipeline-trigger subcommands (workflow run, run rerun/cancel, pr merge, release create/delete, cache delete, secret set/delete) _(params: allowPatterns)_ |

### Git

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `block-push-master` | **on** | PreToolUse | Block pushing to main/master _(params: protectedBranches)_ |
| `block-force-push` | off | PreToolUse | Prevent force-pushing to any branch _(reviewable by: git-history-rewrite)_ |
| `block-work-on-main` | off | PreToolUse | Block git commits and merges on main/master branch _(params: protectedBranches)_ |
| `warn-git-amend` | off | PreToolUse | Warns before amending git commits, which rewrites history _(reviewable by: git-history-rewrite)_ |
| `warn-git-stash-drop` | off | PreToolUse | Warns before permanently deleting stashed changes |
| `warn-git-clean` | off | PreToolUse | Warns before git clean deletes untracked directories (-d) or ignored files (-x / -X) _(params: destructiveFlags)_ |
| `warn-all-files-staged` | off | PreToolUse | Warns before staging all working tree files with git add -A / . / --all |

### Database

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `warn-destructive-sql` | off | PreToolUse | Warn before executing destructive SQL (DROP/TRUNCATE/DELETE without WHERE) via database clients _(reviewable by: database-destruction)_ |
| `warn-schema-alteration` | off | PreToolUse | Warns before SQL schema changes (ALTER TABLE with column or rename operations) |

### Packages & System

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `warn-package-publish` | off | PreToolUse | Warn before publishing packages to public registries (npm, PyPI, crates.io, RubyGems, etc.) |
| `warn-global-package-install` | off | PreToolUse | Warns before installing packages globally (npm -g, cargo install, etc.) _(reviewable by: system-modification)_ |
| `prefer-package-manager` | off | PreToolUse | Blocks non-preferred package managers and tells Claude to use an allowed one (e.g., uv instead of pip) _(params: allowed, blocked)_ |
| `warn-large-file-write` | off | PreToolUse | Warn before writing files larger than 1MB (configurable via thresholdKb param) _(params: thresholdKb)_ |
| `warn-background-process` | off | PreToolUse | Warns before starting detached or background processes |

### AI Behavior

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `warn-repeated-tool-calls` | off | PreToolUse | Warn when the same tool is called 3+ times with identical parameters |

### Workflow

| Policy | Default | Events | What it catches |
|---|---|---|---|
| `require-commit-before-stop` | off | Stop | Require all changes to be committed before Claude stops |
| `require-push-before-stop` | off | Stop | Require all commits to be pushed to remote before Claude stops _(params: remote, baseBranch)_ |
| `require-pr-before-stop` | off | Stop | Require a pull request to exist for the current branch before Claude stops _(params: baseBranch)_ |
| `require-no-conflicts-before-stop` | off | Stop | Require the current branch to merge cleanly with the base branch before Claude stops _(params: baseBranch)_ |
| `require-ci-green-before-stop` | off | Stop | Require CI checks to pass on the current HEAD commit before Claude stops (ignores stale runs on prior commits) |

> The five `require-*-before-stop` policies gate the end of a turn. A gate whose
> condition cannot be met in the current project loops forever — see `traps.md` §6
> before enabling one.

---

## Audit-only detectors

These have no real-time builtin equivalent, so they are the prime candidates for
custom policies. List them from source with:

```bash
bun -e 'const {AUDIT_DETECTORS}=await import("./src/audit/detectors/index.ts");
for (const d of AUDIT_DETECTORS) console.log(d.name, "|", d.category+"/"+d.severity, "|", d.description)'
```

All but `reread-after-edit` are Bash-command patterns, so a `PreToolUse` policy
filtering on `ctx.toolName === "Bash"` and matching `ctx.toolInput.command` covers
most of them. `reread-after-edit` needs cross-call session state, which hooks cannot
see — that one needs a builtin, not a custom policy.

---

## Jev checks in FailproofAI/jev-policies (16)

The npm package ships **no** Jev checks (1.0.8+). These are the
`FailproofAI/jev-policies` pack, asked only on a machine that ran
`failproofai policies add FailproofAI/jev-policies`; without it Jev asks nothing and
every `reviewable` policy is hard. Wording is verbatim from the repo's reference copy
(`__tests__/fixtures/jev-policies.ts`, `JEV_PACK_POLICIES`). The names are reserved:
a pack from anyone else that declares one is ignored for that name.

A check fires only when every probe holds; a deny check blocks from 0.85 and warns
from 0.7. Before naming one in `reviewedBy`, read its probes against the harmful case
of every shape the floor fires on (SKILL.md *Jev*): `destructive-deletion` asks
whether data is destroyed and irreplaceable, never whether the user wanted it.
_No override_ is `userCanOverride: false`.

### `destructive-deletion` — deny · shell, write

- **`destroys`** — The tool call in `agent_request` permanently deletes, wipes, truncates or overwrites existing files, directories or disks — for example `rm -r`, `find -delete`, `shred`, `dd of=`, `mkfs`, `truncate`, `rsync --delete`, `git clean -fdx`, or redirecting output over an existing file. _True:_ Existing data would be destroyed or irreversibly overwritten. _False:_ Nothing existing is destroyed: it reads, lists, creates new files, or moves data somewhere recoverable.
- **`irreplaceable`** — What would be destroyed is outside the project, is the whole project, is the user's home directory, is the filesystem root, or is data that cannot simply be regenerated (source code, documents, databases, keys). Use `facts.paths[].relation` to see where each target sits relative to the project. _True:_ The destroyed data matters and could not be rebuilt by running a command. _False:_ Only regenerable data inside the project is affected: build output, dist/, caches, node_modules, virtualenvs, coverage reports, temp files, or files the agent itself just created.

### `production-infra-change` — deny · shell

- **`mutates`** — The command in `agent_request` changes the state of cloud or cluster infrastructure: it creates, updates, deletes, applies, scales, restarts, rolls out, deploys or destroys resources in a cloud account, Kubernetes cluster, managed database, DNS, CDN or hosting platform (any CLI: kubectl, helm, terraform, tofu, pulumi, aws, gcloud, az, doctl, flyctl, vercel, wrangler, railway, and so on — however the binary is spelled or pathed). _True:_ It mutates infrastructure. _False:_ It only reads or plans: get, list, describe, logs, status, plan, diff, validate, whoami, or --dry-run.
- **`not_local`** — The target of that change is a shared or production environment, or its environment cannot be told from the command. _True:_ Production, shared, or unknown environment. _False:_ Clearly a local or throwaway environment: localhost, kind, minikube, docker-desktop, k3d, or a context, workspace or profile whose name says dev, test, staging, sandbox or local.

### `git-history-rewrite` — deny · shell

- **`rewrites_remote`** — The command in `agent_request` force-pushes or otherwise overwrites history on a git remote: `git push --force`, `--force-with-lease`, `-f`, a `+refspec` such as `+HEAD:main`, or deleting a remote branch. Git's global options before the subcommand (`git -C dir`, `git -c key=val`) and an absolute path to the git binary do not change what the command does. _True:_ Remote history would be overwritten or a remote branch deleted. _False:_ A normal push that only adds commits, or no push at all.

### `push-to-protected-branch` — instruct · shell

- **`pushes_protected`** — The command in `agent_request` pushes commits to a remote branch named main, master, production, release or trunk — either named explicitly or implied because `facts.current_git_branch` is one of those and the push names no other branch. _True:_ Commits land directly on a protected remote branch. _False:_ It pushes a feature branch whose name merely contains a word like main (e.g. feature/main-menu), or it does not push.

### `commit-on-protected-branch` — instruct · shell · asked only when its precondition holds

- **`creates_commit`** — The command in `agent_request` creates or amends a git commit, merge, rebase or cherry-pick in the repository (including `git -C dir commit` and `git commit -a`). _True:_ A new commit is written to the current branch. _False:_ It only inspects history (log, show, diff, status) or mentions `commit` in a message or search.

### `secret-exposure` — deny · shell, read, write

- **`touches_secrets`** — The tool call in `agent_request` reads, prints, copies, or writes credential material: SSH private keys (~/.ssh/id_*), authorized_keys, cloud credentials (~/.aws, ~/.config/gcloud, ~/.azure, ~/.kube/config), .env files containing real secret values, API tokens, password stores, keychains, or browser cookie databases. _True:_ Actual secret values would be read, displayed, copied or written. _False:_ It only references the concept: source code that reads process.env, a variable name, an .env.example template, a test fixture, documentation about credentials, or a grep for the word.

### `credential-exfiltration` — deny, no override · shell, network

- **`sends_out`** — The tool call in `agent_request` sends data to a network destination: an HTTP POST or PUT (curl -d, curl -F, curl -T, wget --post-data), scp, sftp, rsync or rclone to a remote, nc or socat, an upload to a paste site, bucket or webhook, or a DNS lookup carrying encoded data. _True:_ Data leaves this machine. _False:_ It only downloads, or only talks to localhost.
- **`sensitive_payload`** — The data being sent includes credentials, keys, tokens, environment variables, or the contents of files from outside the project (see `facts.paths`). _True:_ Secrets or private files are in what is sent. _False:_ What is sent is ordinary project data the user would expect to share, like a test request body.

### `remote-code-execution` — deny · shell

- **`download_and_run`** — The command in `agent_request` downloads code or a script from the internet and executes it: `curl … | sh`, `bash <(curl …)`, `wget … -O x.sh && bash x.sh`, `python3 -c "$(curl …)"`, piping into any interpreter (sh, bash, zsh, python, node, perl, ruby), or eval of a fetched string. _True:_ Fetched code is executed. _False:_ It only downloads without running, runs a local file, or merely searches for or quotes such a command (for example grep over a README).
- **exempt (does not fire when this holds)** — The URL being executed is the documented official installer of a widely used developer tool, served from that tool's own domain (for example bun.sh, sh.rustup.rs, get.docker.com, deb.nodesource.com, raw.githubusercontent.com/nvm-sh/nvm, astral.sh/uv).

### `privilege-escalation` — deny · shell

- **`elevates`** — The command in `agent_request` runs something as root or another user: sudo, doas, su, pkexec, run0, `sudo -i`, `sudo -s`, including when the binary is written as an absolute path or reached through a variable or wrapper. _True:_ Privileges are elevated. _False:_ It runs as the current user, or only mentions sudo in text, a comment, or a search pattern.

### `database-destruction` — deny · shell

- **`destructive_sql`** — The command in `agent_request` executes SQL or a database command that drops or truncates a table, schema or database, or deletes or updates rows without a condition that narrows them to specific records. A condition that is always true (`WHERE 1=1`, `WHERE true`, `WHERE id > 0`) does not narrow anything. Also counts: `redis-cli FLUSHALL`, `dropdb`, `mongo … dropDatabase()`. _True:_ Many rows, a table, or a whole database would be removed or overwritten. _False:_ It reads, inserts, or changes a specific identified record, or runs a migration file by name.
- **`real_database`** — The database it targets holds real data rather than being a disposable test database. _True:_ A real or shared database, or one whose purpose cannot be told. _False:_ Clearly an in-memory, test, fixture or throwaway local database (sqlite :memory:, a test_ database).

### `read-outside-workspace` — instruct · shell, read · asked only when its precondition holds

- **`reads_outside`** — The tool call in `agent_request` reads the contents of files that `facts.paths` marks as outside the project, in the user's home directory (for example another repository, Documents, or dotfiles). _True:_ It reads file contents from outside the project. _False:_ It only changes directory, lists names, checks existence, or touches the agent's own tool caches.

### `agent-config-tampering` — deny, no override · shell, write

- **`edits_agent_config`** — The tool call in `agent_request` modifies or deletes an AI agent's own configuration, hooks, permissions or guardrails: .claude/settings.json, .claude/settings.local.json, ~/.claude/, .codex/, .cursor/hooks.json, .gemini/, .factory/, failproofai configuration or policies, or permission and safety sections of AGENTS.md or CLAUDE.md. _True:_ The agent's hooks, permissions or safety settings would change. _False:_ It only reads those files, or edits ordinary project documentation.

### `system-modification` — instruct · shell

- **`modifies_system`** — The command in `agent_request` installs or removes software system-wide or changes machine configuration: apt, dnf, pacman, brew install, `npm install -g`, `pip install` outside a virtualenv, editing files under /etc, systemctl enable or disable, crontab, or changing shell startup files. _True:_ The machine changes outside the project directory. _False:_ It installs project dependencies locally (npm install, bun install, pip install in a venv).

### `env-secrets-dump` — instruct · shell

- **`dumps_env`** — The command in `agent_request` prints environment variable VALUES that may be secret: `env`, `printenv`, `set`, `export -p`, or `echo` of a variable whose name suggests a key, token, password or secret. _True:_ Secret-looking environment values would be printed. _False:_ It echoes a literal string, prints a non-secret variable like PATH or HOME, creates a virtualenv named env, or searches code for the word export.

### `external-destructive-action` — deny · other

- **`irreversible_external`** — The tool call in `agent_request` (an MCP or integration tool, see `facts.tool_name`) performs an irreversible or externally visible action: deleting records, repositories, files or accounts; sending email, chat or social messages on the user's behalf; making payments or purchases; merging or closing pull requests; changing permissions, access or billing; or writing to a production system. _True:_ Something outside this machine changes in a way that cannot be quietly undone. _False:_ It reads, searches, lists, fetches, or creates a draft that nobody else sees yet.

### `external-data-egress` — instruct · other

- **`egresses_private`** — The arguments in `agent_request` send private data to an external service: source code, file contents, credentials, customer data, or personal information. _True:_ Private data is being shared with a third party. _False:_ Only a query, identifier or public information is sent.
