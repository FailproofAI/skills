# Setup: from nothing to a session you can see

This file stands alone. It assumes no sibling skill is installed and nothing on this
machine is wired up. Two binaries, two installs, two independent verifications.

    npm i -g failproofai              uv tool install fp-cloud-cli
            │                                    │
            ▼                                    ▼
      hooks · policies · daemon            fp login  ◄── ONLY A HUMAN CAN DO THIS
            │                                    │
            └──────── machine key ◄──────────────┘
                          │
                          ▼
              connect → one real tool call → fp events

Do them in that order. The step an agent cannot perform is `fp login`, and discovering
that after you have half-provisioned a machine wastes the turn — read *Step 3* first.

**What was verified.** Every `fp` command quoted here was run against the shipped CLI
(`fp-cloud-cli` 0.0.1b1). The `failproofai` half is from the package source and the
shipped docs: the binary could not be executed while this was written, because a local
enforcement policy on this machine blocks it. Flags are quoted exactly as documented —
do not improvise variants of them.

## What you are installing

| | Local | FailproofAI Cloud |
|---|---|---|
| Binary | `failproofai` (+ the `failproofaid` shim) | `fp` |
| Install | `npm i -g failproofai`, Node >= 20.9 | `uv tool install fp-cloud-cli` |
| Owns | hooks in 12 agent CLIs, policy evaluation, capture, machine enrolment | sessions, events, audits, issues, keys, orgs, publish/deploy/rollback |
| Needs an account | **no** — fully offline is a finished state | yes |
| Config | `~/.failproofai/` | `~/.failproofai/fpcli/cli-auth.json`, mode 0600 |
| Platform | daemon is Linux/macOS only | any |

**Never write `uv tool install fp-cli`.** `fp_cli` is the Python module name; the
distribution is `fp-cloud-cli`. The module name is not the package and installs nothing
you want.

The cloud CLI's session file lives *inside* the local home. So `~/.failproofai/` existing
tells you nothing about whether you are signed in, and being signed in tells you nothing
about whether the local half is set up. Check each with its own command.

## Decide the end state before you install anything

The fork decides whether you need an account. It does **not** decide sudo: setup installs
`failproofaid` in both modes, and that needs root once.

| End state | What you get | What it costs |
|---|---|---|
| **Local only** | hooks across 12 harnesses, any pack you install, plus custom and convention policies, offline audit of local history, the local dashboard on port 8020 | no fleet, no cloud sessions, no evals, no issues or alerts, no publish → deploy lifecycle |
| **Cloud connected** | all of the above, plus centrally-managed policy, session capture, the fleet view, and the deploy/rollback lifecycle | an account and a scoped key — and decisions and full transcripts leave the machine |

Local only is **complete and supported**. Do not treat `cloud  not connected` as a broken
install; the wizard's own copy for that state is "nothing leaves this machine".

Neither end state comes with policies. Setup wires the hooks and deliberately chooses nothing
for them to enforce — see *Step 7*, which is the step people skip and then report as a broken
install.

## Step 1 — install the local CLI

```bash
node --version                 # must be >= 20.9
npm install -g failproofai
command -v failproofai failproofaid
```

The npm package ships two binaries. `failproofaid` is a launcher shim; the daemon it
launches is a compiled service, Linux and macOS only. On Windows every cloud noun stays
unreachable even after a successful connect.

`npm install -g` installs **no service, no daemon binary and no policies**. It gives you the
CLI, one compiled always-on guard, and nothing else. Installing the package is not setting the
machine up, and setting the machine up is not choosing what it enforces.

## Step 2 — install the cloud CLI

```bash
uv tool install fp-cloud-cli        # or: pipx install fp-cloud-cli
command -v fp agenteye              # fp first — prefer it whenever both resolve
fp version
```

`agenteye` (0.1.13) is the **legacy** cloud binary. It is a separate package, still
installable, and it has no `policies`, `fleet`, `guardrails` or `usage` at all. Resolve
the pair once, at the start, and prefer `fp`. A command missing under `agenteye` means
"wrong binary", not "not shipped".

Two things about driving `fp` that will otherwise cost you a turn each:

- **Global options come *before* the command.** `fp --json sessions` works;
  `fp sessions --json` is a usage error, exit 2. A command's own options come after it:
  `fp --json keys create ci-bot`. The globals are `--json --base-url --org --token
  --api-key --insecure/--secure --timeout --quiet --no-color`.
- **The env prefix follows the binary.** `fp` reads `FP_HOME`, `FP_JSON`, `FP_TOKEN`,
  `FP_API_KEY`, `FP_ORG`, `FP_DASHBOARD_URL`, `FP_INSECURE` (plus `FAILPROOFAI_HOME`) and
  zero `AGENTEYE_*` variables. Note the dropped infix: `FP_TOKEN`, not `FP_CLI_TOKEN`;
  `FP_JSON`, not `FP_CLI_JSON`. Legacy `agenteye` is the one that reads `AGENTEYE_HOME`,
  `AGENTEYE_CLI_TOKEN`, `AGENTEYE_CLI_JSON`.

## Step 3 — `fp login`, and why you have to stop here

```bash
fp login                                          # fully interactive
fp login --email you@example.com --org <org>      # both prompts skipped
fp --base-url https://dash.example.com login      # self-hosted; the URL is saved
```

**Sign-in is a 6-digit code emailed to the user.** You enter the address, the dashboard
sends the code, and it has to be pasted back within the same prompt. There is no API-key
path to a session, no device-code flow, no token you can mint for yourself, and no
environment variable that skips it. An agent cannot read the user's mail.

So when `whoami` says logged out: **stop, print the exact command, and ask the user to run
it.** Do not loop, do not retry, do not go looking for another route to a session. Then
carry on from step 4 once they say they are in.

Details worth knowing before you hand the command over:

| | |
|---|---|
| Where the session lands | `~/.failproofai/fpcli/cli-auth.json`, mode 0600 |
| How long it lasts | about 24 hours — re-run `login` when it expires |
| Already signed in | `login` prints who you are and exits 0 without prompting; `--force` re-authenticates anyway |
| The active org | chosen here and saved. One org is picked automatically; several give a picker, or pass `--org <slug>`. Change it later with `fp orgs switch <slug>` |
| `--json` output | `{"logged_in": true, "email": "…", "org": "<slug>", "expires_in_secs": <n>}` |
| Exit 2 | sign-in worked but the org is still unresolved (multi-org, no `--org`, non-interactive). **The token is saved** — re-run with `--org <slug>`, do not re-authenticate |
| Self-signed dashboard | add the global `--insecure` |

`--api-key` / `FP_API_KEY` authenticates CI, but it is not a session and does not
substitute here: under an API key `login`, `orgs`, `agent`, `policies`, `fleet` and
`guardrails` all exit 2.

## Step 4 — verify with `whoami`, on the field, never the exit code

```bash
fp --json whoami
```

**`whoami` exits 0 whether or not you are signed in.** Verified live, logged out:

```json
{
  "logged_in": false,
  "auth_mode": "none"
}
```

`EXIT=0`. Branch on `.logged_in` and `.auth_mode`. Any instruction that says "exit 4 means
not signed in" is wrong and will report a healthy machine as broken, or — worse — a signed-
out one as fine.

```bash
if [ "$(fp --json whoami | jq -r .logged_in)" != "true" ]; then
  echo "not signed in — ask the user to run: fp login"
fi
```

Signed in, `whoami` also gives you the active org and your permissions; `fp orgs perms`
prints the same grants grouped by resource. Check them before you promise an operation:
almost every "the command doesn't work" report at this stage is a missing grant.

## Step 5 — mint a machine key

A machine does not authenticate as you. It carries a scoped API key, and that key drives
exactly two independent capabilities:

| Capability | Permission | What it does |
|---|---|---|
| Pull managed policy | `policies:pull` | the daemon fetches the deployment it is told to run |
| Push events/transcripts | `events:add` | the collector ships sessions to the dashboard |

```bash
fp --json keys create fp-machine-laptop --add events:add,policies:pull
```

Needs `keys:create`. The secret is generated locally, the server stores only a hash, and
`--json`'s `key` field is **the only place it ever appears** — capture it in that one call.

Three traps:

- **`--permission-set read-only` produces a useless machine key.** The read-only set is
  computed as every `:read` permission, so it contains neither `events:add` nor
  `policies:pull`. The key authenticates and the machine still ingests nothing and pulls
  nothing.
- **Do not use an admin key.** `events:add` + `policies:pull` is the entire requirement.
  Human-only permissions (`keys:update`) cannot be granted to a key at all, deliberately —
  an admin *key* is weaker than an admin *user* by design.
- **A key that omits permissions entirely defaults to `events:add`** at the raw API level.
  Always pass `--add` explicitly and read back the expanded `permissions` list from the
  `--json` response.

Name the key after the machine. You will want to disable exactly one of these some day.

## Step 6 — connect the machine

Two commands do overlapping things and only one of them installs the daemon. This is the
single most common broken setup in the product, so state it before you run either.

```bash
failproofai config           # the interactive wizard — the ONLY thing that installs the daemon
```

```bash
failproofai config --connect https://app.befailproof.ai --token "<key>"
```

**`--connect` deliberately never elevates.** It writes credentials, warns that
`failproofaid` is not installed as a service, and exits. With no daemon there is no policy
pull, no transcript capture and no delivery — the machine looks configured and ships
nothing.

The wizard is one linear flow, and it is shorter than it used to be. It installs the daemon,
wires hooks into **all twelve supported agent CLIs at global scope**, offers to connect, and
applies. It does not ask about scope, it does not ask which agents you use, and **it does not
ask about policies** — there is no policy step, no themed bundles, and no recommended set.

| Stage | What happens | Are you asked |
|---|---|---|
| daemon | `failproofaid`, installed **first** because it is the only step needing a password. `sudo -v` primes on a clean terminal, before any frame is drawn | no — required, and setup refuses outright on any platform `failproofaid` does not run on |
| scope | global, always | no |
| harnesses | all twelve, detected or not. An agent installed next week is guarded from its first tool call | no |
| policies | **nothing.** Whatever was already enabled at that scope is read and carried through untouched | no — there is no policy step |
| connect | paste a scoped key, or stay fully local | yes |
| review | shows exactly which files change, then applies | yes, unless off a TTY or `--token` already answered the run |

Three consequences worth stating before you run it:

- **A finished setup enforces almost nothing.** The only policy running is the compiled
  always-on guard. The wizard says so itself on the way out — "Nothing is enforcing yet" —
  and points at `failproofai policies add`. That is the intended end state, not a bug.
- **Re-running it never reduces protection.** Hooks are written with `replace: true` against a
  set that was read off disk first, so a second run cannot switch off a policy you turned on.
  Convention policies are left alone in both modes.
- **Off a TTY it just runs.** There is nothing to confirm when nobody is watching, so it
  applies rather than asking — no flag needed. It exits **1** if anything it was asked to do
  did not happen, including a key the server refused and a machine that could not reach root;
  sudo is never prompted for on that path, it either works without a password or you are told
  the exact commands to run.

Flags on `--connect`:

| Flag | Notes |
|---|---|
| `--connect <url>` | base URL. A pasted `/v1/events` or `/events` suffix is stripped. Plain http is refused for anything but loopback |
| `--token <key>` | the scoped key from step 5. Never an admin key |
| `--machine-id <id>` | explicit id wins; else the id already on disk; else a **random UUID**. Never the hostname, whatever `--help` says |
| `--machine-label <name>` | mutable display name, free to collide. Passed **alone**, it renames an already-connected machine |
| `--no-transcripts` | decisions only, no transcript bodies |
| `--disconnect` | stops pulling and sending — but a *running* daemon cached its bearer key at construction and keeps shipping until it is restarted |

Four traps on this one command:

- **The exit code tracks only the policy half.** An `events:add`-only key writes a working
  ingest credential, prints "Connected … for dashboard reporting only", and exits **1**.
  Never `&&`-chain on `--connect`; read stdout.
- **Transcripts are sent by default**, and `--no-transcripts` is matched by exact string
  while the `config` branch validates no unknown flags at all. `--no-transcript`,
  `--notranscripts`, any typo, is silently ignored and full transcripts — prompts, file
  contents — ship. Confirm the result with `config --status`, not with the exit code.
- **No `--flag=value` form.** `--token=abcdefgh` parses as *no token* and the command exits
  1. Space-separate every value.
- **The machine id does not default to the hostname.** Passing `--machine-id "$(hostname)"`
  across several machines silently merges them into one row in the fleet.

Each capability is probed before anything is written, and only what verified is written, so
a partial success is normal and is reported per half.

## Step 7 — choose what enforces

Step 6 wired the hooks. It chose nothing for them to fire on, and hooks alone enforce nothing.
**Policies are not in the npm package**: they arrive as *packs* — published GitHub releases,
verified by digest, installed by whoever wants them.

```bash
failproofai policies show FailproofAI/policies   # look first: manifest only, no code fetched
failproofai policies add FailproofAI/policies    # ours — 38 policies, 10 on by default
failproofai policies                             # what is on this machine now
```

`FailproofAI/policies` is typed in full because it is a pack like anyone else's. `core`,
`failproofai` and `official` are retired spellings that exit 1 naming the replacement, and
there is **no offline install of anything** — taking a pack needs the network, though a pack
already installed keeps enforcing without it.

| Command | What it does |
|---|---|
| `failproofai policies` | everything on this machine, and whether it is actually enforcing |
| `failproofai policies add` | pick from what is installed. One screen, space toggles. **Needs a terminal** — from a pipe it exits 1 |
| `failproofai policies add block-sudo` | turn one policy on — no slash |
| `failproofai policies add acme/deploy-guard` | install a pack — **a slash means a source** |
| `failproofai policies show acme/deploy-guard` | what a pack holds, before you take it |
| `failproofai policies remove <name>` \| `remove <pack-id>` | one policy, or a whole pack |
| `failproofai publish ./my-policies.mjs` | build, release and upload a pack of your own |

`policy`, `pack` and `p` are all spellings of `policies`, so nothing anyone typed before
breaks. Write `policies`.

Supported harnesses: `claude`, `codex`, `copilot`, `cursor`, `opencode`, `pi`, `hermes`,
`openclaw`, `factory` (binary `droid`), `devin`, `antigravity` (binary `agy`), `goose`. Setup
wires all twelve whether or not they are installed, so this is for picking one to *test* in:

```bash
command -v claude codex copilot cursor-agent opencode pi hermes openclaw droid devin agy goose
```

Six things to get right:

- **The slash is the only disambiguator, and it is total.** A policy name matches
  `/^[A-Za-z0-9._-]+$/` and can never contain one. Everything holding a slash is a pack
  source: `acme/guard`, `acme/guard@v2`, `acme/guard@a1b2c3d` (the release built from that
  commit), `github:acme/guard@v2`, or a release URL. A tagless source is resolved to a
  concrete tag *before* anything is written, and that tag is what gets recorded.
- **Selection flags merge; the picker replaces.** `policies add acme/guard --category Git` on
  an already-installed pack means *also* turn Git on — the command's first word is `add`. The
  interactive picker's list is the complete answer, which is what makes unticking able to turn
  something off at all.
- **Put the pack id immediately after `remove`.** That lane reads the first positional and
  nothing else, so `policies remove --scope user acme/guard` takes `--scope` as the id. Write
  `failproofai policies remove acme/guard`.
- **`policies --install` with no names is not a policy picker any more.** It wires hooks and
  touches no policy at all. With names it turns those on — and on a machine with no pack yet
  it *fetches* `FailproofAI/policies` to get them, so that one path needs the network and
  warns rather than throwing when it cannot reach it.
- **Scope changes the shape of what is written, not just its location.** `--scope project`
  writes a committable `npx -y failproofai` command with no machine-specific paths;
  `user` and `local` write an absolute binary path. `hermes` and `openclaw` are
  user-scope only — they have no project config. `--scope local` is `claude` only.
  Installing at two scopes causes duplicate policy evaluation; the CLI warns and does not
  prevent it. Scope applies to hooks and to the policy-name lane; a **pack** install is
  machine-level, recorded in `~/.failproofai/policies/packs/installed.json`, and `--scope`
  does nothing to it.
- **Convention policies load by filename.** Any file matching `policies.{js,mjs,ts}` in
  `.failproofai/policies/` (project) or `~/.failproofai/policies/` (user) auto-loads with
  no flag. `block-force-push.mjs` does **not** match, is skipped silently, and enforces
  nothing while looking installed. Name it `block-force-push-policies.mjs`.

One policy, `block-failproofai-commands`, is compiled into the package, always on, and cannot
be disabled — not by a session pause, not by an unparseable config, not by an empty machine.
That is deliberate: it is what stops an agent turning off its own guardrails, and it is why a
*pack* may not declare `alwaysOn` and this one guard cannot travel the pack lane. Until you
finish this step it is the only thing enforcing.

## Step 8 — prove a session actually lands

An install that has never evaluated a single event is not a verified install. Four checks,
each proving a different link in the chain. Do not skip to the last one.

**1. The machine's own view.**

```bash
failproofai config --status
```

Read three things: the version triad in the title line (npm CLI · daemon · home layout —
`(STALE)` after the daemon version means skew, which means fail-closed risk), the daemon
row, and the delivery-health verdict. That verdict **overrides** the cheerful "connected"
line above it. Trust it when they disagree: that is how a machine reports connected for
twenty minutes with dozens of batches parked on a 401.

**2. Make one real tool call** in a harness you installed hooks for. Something a policy
you enabled will actually see — a `Bash` call, not a thought.

**3. Local proof.** Run the local dashboard (`failproofai`, port 8020) and look at
Policies → Activity log. A decision row for that tool call is the proof that hooks are
wired and the policy engine ran. This works with no account and no network. If you are
local-only, you are done here.

Cross-check it with `failproofai policies`. Its subtitle answers a different question than the
activity log does: `<scopes> · <N> on` is healthy, `<N> on · NOT ENFORCING` means packs are
installed but no agent CLI is wired, and `nothing installed` means step 7 has not happened. On
a machine with no pack the only decisions you will ever see are the always-on guard's — the
hooks are fine, there is just nothing for them to enforce.

**4. Cloud proof.** Delivery is unhurried by design — the sweeper takes batches older than
120 s, at most 64 per pass, on a 60 s cadence. Give it a minute, then:

```bash
failproofai flush --wait --timeout 180
fp --json events --since 15m | jq '.events | length'
fp --json fleet list
```

`fp fleet list` is the better first look: **a machine appears from its very first check-in,
including the poll that finds nothing deployed** — which is exactly the machine you are
usually looking for. Its columns split two different problems apart: `intended` is the
generation deployed, `applied` is the one the machine last collected, `seen` is when it
last reported anything. A machine can be in sync and dead, or alive and behind.

Two traps in that block:

- **`flush` saying "Nothing spooled — everything already delivered" and exiting 0 is not
  proof of delivery.** It counts the spool and skips the `failed/` directory, so a machine
  with batches parked on a rejected key reports exactly that. Read the `dashboard` row of
  `config --status` instead — it is the only output that describes *now* rather than
  connect time.
- **`flush --wait` exits 1 on timeout, and a timeout is not a failure.** A large backlog
  legitimately outruns the default. Never gate CI on that exit code.

Only step 4 proves the whole chain. `fp policies test` — which needs nothing but `node` on
PATH, no server, no auth, no install — proves a policy *decides* correctly and cannot prove
the daemon feeds it the same context:

```bash
fp policies test ./rule.mjs --command "git push --force origin main"
# {"ok":true,"decision":"deny","policies":[{"name":"no-force-push","decision":"deny",…}]}
```

## When a step does not land

| Symptom | First check | Usual cause |
|---|---|---|
| `whoami` says `logged_in: false` | nothing else | **stop and ask the user to run `fp login`** — you cannot read the emailed code |
| `login` exits 2 | `fp orgs list` | multi-org, no `--org`. The token is saved; re-run with `--org <slug>` |
| `policies`/`fleet`/`guardrails` exit 2 | `fp --json whoami` → `.auth_mode` | you are on an API key. That whole lifecycle is session-only. `policies test` is the one exception |
| Nothing in the cloud dashboard | `config --status` | ran `--connect` only, so there is no daemon — or ingest is being rejected |
| Machine missing from `fp fleet list` | `config --status` policy row | the key lacks `policies:pull`, or the daemon has never checked in |
| Machine appears twice | `--machine-id` history | an ingest-only connect stamped one id, a later policy-capable connect minted another |
| **Every tool call denied, on every CLI** | `config --status` daemon row | daemon unreachable or version-skewed. Enforcement is **failing closed**, deliberately — including `UserPromptSubmit`, so the user cannot even ask their agent why. Run `failproofai update` or restart the unit |
| Custom policy does nothing | the filename | it must end `policies.{js,mjs,ts}` |
| Setup finished and nothing is enforcing | `failproofai policies` | **no pack installed.** That is the state setup leaves behind, deliberately. `failproofai policies add FailproofAI/policies` |
| `policies add core` exits 1 | — | `core`, `failproofai` and `official` are retired. Type the pack in full: `FailproofAI/policies` |
| Header says `NOT ENFORCING` | `failproofai config` | packs are installed but no agent CLI is wired |
| Hooks installed, a pack is on, still nothing enforces | `failproofai policies` | installed at the wrong scope, or for a harness the user does not actually run |

## Upgrading, later

There is a version triad — npm CLI, daemon binary, `~/.failproofai` layout — and the three
move independently.

```bash
npm install -g failproofai@latest    # replaces the CLI and NOTHING else
failproofai update                   # migrations + a matching daemon binary + restart
uv tool upgrade fp-cloud-cli
```

`npm i -g …@latest` alone is never enough on a daemon machine: the old daemon binary stays,
the layout stays, and the machine goes fail-closed on version skew. Always follow with
`failproofai update`.

## Two rules for running any of this as an agent

- **Never run `--connect`, `--disconnect`, `uninstall`, a user-scope install, or
  `fp fleet deploy` on your own initiative.** Enrollment sends data off the machine and a
  deploy can start denying tool calls on someone else's box. Propose the command; let the
  user run it.
- **Two commands never exit:** `failproofai audit` (serves a dashboard until Ctrl+C) and the
  bare `failproofai` dashboard. Wrap them in `timeout`, or hand them to the user.
