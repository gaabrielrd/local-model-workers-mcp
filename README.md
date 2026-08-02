# Local Model Workers MCP

Local Model Workers MCP is a local MCP server that lets Claude Code and Codex
delegate repository exploration and test proposals to a model served by LM
Studio on another machine in a private local network.

The local server remains the security boundary: it selects repository context,
enforces path and content restrictions, validates remote output, and returns a
structured result. The remote model never writes to the repository, applies a
patch, or runs a project command.

## Project status

The approved V1 scope is feature-complete as release candidate `1.0.0-rc.1`.
The implementation includes:

- layered, revision-controlled configuration with atomic writes;
- canonical read-only repository access and fail-closed outbound filtering;
- structured LM Studio inference with optional Bearer authentication;
- explicit trusted-LAN `none` mode for `lms` deployments without token support;
- repository-free health diagnostics and model availability checks;
- isolated task lifecycles with cross-process FIFO capacity;
- bounded repository exploration and validated test-only patch proposals;
- metadata-only operational logging with seven-day retention;
- confirmed Claude Code and Codex harness configuration;
- a protocol-clean MCP v2 server over `stdio`.

Local qualification is green as of 2026-08-02:

- `npm run validate` passes formatting, lint, architecture boundaries,
  typechecking, build, and all 163 automated tests;
- `npm run release:smoke` produces reproducible tarballs, installs one in an
  isolated prefix, starts the packaged MCP server, and verifies all six tools;
- the compiled MCP reports the real LM Studio instance healthy without a token,
  using `authentication: none` / `not_configured`;
- Qwen 3.5 9B and Gemma 4 12B passed structured-output, required tool-call, and
  vision probes; Nomic Embed returned 768-dimensional embeddings;
- the production dependency audit reports no known vulnerabilities.

Publication is not approved yet. The remaining release gates are complete
six-tool scenarios through real Claude Code and Codex sessions, plus successful
remote Linux and Windows portability jobs. See
[release qualification](docs/release-qualification.md) for evidence and the
remaining procedure.

The server exposes exactly six MCP tools:

- `explore_repository`
- `propose_tests`
- `check_health`
- `get_config`
- `validate_config`
- `update_config`

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

Install globally using `npm`:

```sh
npm install --global local-model-workers-mcp
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
- **Target Harness**: Choose `claude-code`, `codex`, `antigravity`, or `all` to configure all harnesses simultaneously.

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
- [V1 implementation plan](docs/tasks/README.md)

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
