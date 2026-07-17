# Installing the SDK

## `pip install agenteye` installs the wrong thing

Read this before running any install command.

**`agenteye` on public PyPI is the AgentEye *CLI*, not this SDK.** They are two
different products that publish under one distribution name. The SDK is not on
PyPI at all — it ships as a private wheel attached to GitHub Releases.

What goes wrong, in the two orders it happens:

| You run | You get | Symptom |
|---|---|---|
| `pip install agenteye` with no SDK present | the CLI | `import agenteye` → `ModuleNotFoundError`. The CLI ships the module `agenteye_cli`, not `agenteye`. |
| `pip install agenteye` with the SDK present | the CLI, **replacing the SDK** | The import that worked five minutes ago stops working. Same distribution name, and the CLI's version is higher, so pip treats it as an upgrade. |

The second one is the dangerous one, because it usually happens *after* a working
integration — someone wants the CLI to check that events arrived and installs it
into the agent's own environment. Nothing warns them.

**Never `pip install agenteye` into the environment your agent runs in.** If you
want the CLI, install it in its own environment:

```bash
pipx install agenteye        # or: uv tool install agenteye
```

## The ladder

Work down; stop at the first rung that applies.

1. **Already installed?** Check before you install anything:

   ```bash
   python -c "import agenteye; print(agenteye.__version__)"
   ```

   A `0.0.1bN` version means you have the SDK — stop here.

2. **From the private release.** Wheels are attached to GitHub Releases on
   `agenteye-enterprise/releases`, tagged `python-sdk/v<version>`. You need a
   customer token with access to that repo.

   Private release assets redirect to S3, which strips the auth header — so
   **download the wheel first, then install it**. Installing straight from the
   URL fails in a way that looks like a 404.

   ```bash
   VERSION=<version>          # ask your Failproof AI contact for the current one
   GITHUB_TOKEN=$AGENTEYE_TOKEN gh release download "python-sdk/v${VERSION}" \
     --repo agenteye-enterprise/releases \
     --pattern 'agenteye-*.whl'
   pip install ./agenteye-${VERSION}-py3-none-any.whl
   ```

   With `uv`:

   ```bash
   uv add ./agenteye-${VERSION}-py3-none-any.whl
   ```

   Without the `gh` CLI:

   ```bash
   curl -fsSL -H "Authorization: Bearer $AGENTEYE_TOKEN" -L \
     "https://github.com/agenteye-enterprise/releases/releases/download/python-sdk/v${VERSION}/agenteye-${VERSION}-py3-none-any.whl" \
     -o "agenteye-${VERSION}-py3-none-any.whl"
   pip install "./agenteye-${VERSION}-py3-none-any.whl"
   ```

3. **Neither works** → stop and ask the user to get the wheel from their Failproof
   AI contact. Do not improvise an install from an index. A wrong package in an
   agent's environment is a supply-chain problem, not a typo.

## Confirm what you have

```bash
python -c "import agenteye; print(agenteye.__version__)"
```

- A version string (e.g. `0.0.1b9`) → the SDK. Good.
- `ModuleNotFoundError: No module named 'agenteye'` → you do not have the SDK. If
  `agenteye --version` works on your PATH, you have the CLI instead (rung 2 above).

To be certain which one is installed:

```bash
pip show agenteye | grep -i version
```

The SDK's versions look like `0.0.1bN` (beta). The CLI's look like `0.N.N`.

## Pinning

Commit the wheel to a private artifact store, or pin the version explicitly in
your dependency file. Do **not** leave an unpinned `agenteye` requirement in a
`requirements.txt` or `pyproject.toml` that a CI job will resolve from PyPI — it
will silently pull the CLI on the next clean build and break the agent's import.

This is the single most likely way a working integration breaks weeks later.
