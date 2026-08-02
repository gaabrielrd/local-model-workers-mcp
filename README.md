# Local Model Workers MCP

Local Model Workers MCP is a local MCP server that lets Claude Code, Codex, and
Antigravity delegate repository exploration, semantic search, code queries, and
test proposals to a model served by LM Studio on another machine in a private
local network.

The local server remains the security boundary: it selects repository context,
enforces path and content restrictions, validates remote output, and returns a
structured result. The remote model never writes to the repository, applies a
patch, or runs a project command.

## Project status

Release `1.1.0` implements the approved V1 scope, the V1.5 read-offloading
phase, and the V2.0 write-offloading phase. The current `main` additionally
includes the V2.1 auto-validate phase and the interactive harness selection UX.
The implementation includes:

- layered, revision-controlled configuration with atomic writes;
- canonical read-only repository access and fail-closed outbound filtering;
- structured LM Studio inference with optional Bearer authentication;
- explicit trusted-LAN `none` mode for `lms` deployments without token support;
- repository-free health diagnostics and model availability checks;
- isolated task lifecycles with cross-process FIFO capacity;
- bounded repository exploration and validated test-only patch proposals;
- metadata-only operational logging with seven-day retention;
- confirmed Claude Code, Codex, and Antigravity harness configuration via an
  interactive checkbox selector (arrow keys, `Space` to toggle, `Enter` to
  confirm) in the `setup`/`init` assistant, with a `--target` flag for scripts;
- managed prompt-steering instruction files that direct harnesses to the MCP
  tools, with an optional custom `steering_prompt` preference;
- validated lint-fix patches and documentation patches returned as unapplied
  unified diffs, so write-heavy mechanical tasks stay on the developer's side
  of the boundary;
- an auto-validate test loop that iterates test generation in an isolated
  temporary copy of the repository until the tests pass (or the iteration and
  timeout limits are exhausted), so generated tests are only proposed once
  proven green;
- a protocol-clean MCP v2 server over `stdio`.

Local qualification is green as of 2026-08-02:

- `npm run validate` passes formatting, lint, architecture boundaries,
  typechecking, build, and all 290 automated tests;
- `npm run release:smoke` produces reproducible tarballs, installs one in an
  isolated prefix, starts the packaged MCP server, and verifies all twelve tools;
- the compiled MCP reports the real LM Studio instance healthy without a token,
  using `authentication: none` / `not_configured`;
- Qwen 3.5 9B and Gemma 4 12B passed structured-output, required tool-call, and
  vision probes; Nomic Embed returned 768-dimensional embeddings;
- the production dependency audit reports no known vulnerabilities.

The package is private and is not published to the public npm registry. It is
distributed as an installable tarball attached to the
[latest GitHub Release](https://github.com/gaabrielrd/local-model-workers-mcp/releases/latest).
The remaining release gates are complete twelve-tool scenarios through real
Claude Code and Codex sessions, plus successful remote Linux and Windows
portability jobs. See [release qualification](docs/release-qualification.md)
for evidence and the remaining procedure.

The server exposes exactly twelve MCP tools:

- `auto_validate_tests`
- `explore_repository`
- `propose_tests`
- `check_health`
- `get_config`
- `validate_config`
- `update_config`
- `query_code_graph`
- `search_semantic`
- `summarize_module`
- `fix_lint_violations`
- `generate_docs_patch`

See [prd.md](prd.md) for the complete requirements and acceptance criteria.

## V1 boundaries

- The MCP server runs locally over `stdio`.
- Only inference traffic reaches LM Studio over HTTP on a trusted private
  network. Bearer authentication is optional and used when the server supports
  it.
- Repository access is read-only and restricted to the requested root.
- Sensitive, ignored, binary, and explicitly excluded files are never sent to
  LM Studio.
- Test generation returns a validated unified diff; the MCP server never
  applies it or executes tests.
- Task content is ephemeral. Operational logs contain metadata only and are
  retained for seven days.
- macOS is the full harness-validation platform for V1. Linux and Windows run
  basic install, startup, and configuration-read checks in the CI matrix.

## Installation and First Use

### 1. Installation

The package is not on the public npm registry. Install (or update) it from the
latest GitHub Release using the attached tarball:

```sh
# Resolve the asset URL of the latest release and install it globally
TARBALL_URL="$(curl -fsSL https://api.github.com/repos/gaabrielrd/local-model-workers-mcp/releases/latest \
  | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).assets[0].browser_download_url")"
npm install --global "$TARBALL_URL"
```

Or, for the current release specifically:

```sh
npm install --global \
  https://github.com/gaabrielrd/local-model-workers-mcp/releases/download/v1.1.0/local-model-workers-mcp-1.1.0.tgz
```

To update, repeat the same command after a new release is published. There is no
automatic updater; reinstalling the newer tarball replaces the previous install.

Verify the install:

```sh
local-model-workers-mcp --version
```

### 2. Single-Command Interactive Setup

Run the single interactive onboarding assistant to configure your environment, harness integration, and test connectivity in one step:

```sh
local-model-workers-mcp setup
# or:
local-model-workers-mcp init
```

The setup assistant will interactively prompt for:
- **LM Studio Base URL**: `http://localhost:1234/v1` (or your private LAN IP).
- **Allowed Models** *(Optional)*: Press Enter to automatically query LM Studio's `/v1/models` endpoint and auto-populate all available active models.
- **Default Model**: Select your preferred default model.
- **Bearer Token** *(Optional)*: Leave empty for local unauthenticated LM Studio instances.
- **Target Harness(es)**: Press `Space` to toggle `claude-code`, `codex`, and/or `antigravity` on and off, arrow keys to move the cursor, `Enter` to confirm, and `Ctrl+C` to cancel. Use `--target` to skip the prompt in scripts.

Non-interactive setup for scripts or CI pipelines is also supported:

```sh
local-model-workers-mcp setup --target all --url "http://localhost:1234/v1" --yes
```

### 3. First Use

Once setup is complete and passes the health check, start your chosen harness:

- **Claude Code**: Run `claude` in your repository directory. The MCP server `local-model-workers` is automatically loaded from `.mcp.json`.
- **Codex**: Run `codex` from any directory. The MCP server is loaded from `~/.codex/config.toml`.
- **Antigravity**: Start Antigravity. The MCP server is registered in `~/.gemini/config/mcp_config.json`.

Make sure your shell exports the connection environment variables (or rely on the auto-configured harness defaults):

```sh
export LMW_LM_STUDIO_BASE_URL='http://localhost:1234/v1'
# Optional: if omitted, all models available at /v1/models are allowed:
export LMW_ALLOWED_MODELS='["qwen/qwen3.5-9b"]'
```

---

## Documentation

- [Product requirements](prd.md)
- [Architecture](docs/architecture.md)
- [Development process](docs/development-process.md)
- [Testing strategy](docs/testing.md)
- [Configuration model](docs/configuration.md)
- [Security model](docs/security.md)
- [Repository read capability](docs/repository-access.md)
- [Outbound content filtering](docs/content-filtering.md)
- [Repository exploration](docs/repository-exploration.md)
- [Safe test proposals](docs/test-proposals.md)
- [Operational logging](docs/operational-logging.md)
- [MCP tool reference](docs/mcp-tools.md)
- [Installation and harness configuration](docs/installation.md)
- [V1 release qualification](docs/release-qualification.md)
- [External integrations](docs/integrations.md)
- [Core contracts](docs/contracts.md)
- [Architecture decisions](docs/decisions/README.md)
- [Implementation plan](docs/tasks/README.md)

## Development

Use Node.js 24.18.0 and npm 11.16.0. With `nvm`, the repository baseline can be
selected from `.nvmrc`.

```sh
nvm use
npm ci
npm run validate
```

`npm run validate` checks formatting, linting, static types, tests, and the
production build. The CLI can also be built, inspected, and packed as a local
npm candidate:

```sh
npm run build
node dist/cli/index.js --version
npm run pack:check
npm run release:smoke
```

Official harness evidence is measured with:

```sh
npm run release:measure -- /absolute/path/to/release-evidence.json
```

The version and configuration diagnostics are written to stderr so stdout
remains reserved for MCP `stdio`. Every push to `main` automatically runs CI
validation and creates a GitHub Release with the package installer.

The protected environment contract and editable file examples are documented
in [configuration.md](docs/configuration.md). [`.env.example`](.env.example)
contains placeholders only; the application does not load `.env` files. When
configured, the Bearer token is not retained in effective configuration
snapshots.
