# Local Model Workers MCP

Local Model Workers MCP is a local MCP server that lets Claude Code, Codex,
Antigravity, Cursor, VS Code (Roo Code / Cline), and Neovim (Avante) delegate
repository exploration, semantic search, multi-language code queries, type & lint fixes, and
test proposals to local models served by LM Studio, Ollama, vLLM, or LocalAI
on another machine in a private local network.

The local server remains the security boundary: it selects repository context,
enforces path and content restrictions, validates remote output, and returns a
structured result. The remote model never writes to the repository, applies a
patch, or runs a project command.

## Project status

Release `2.1.0` implements the complete V2.1 scope, including SQLite embedded vector storage (`sqlite-vec`), 3-state circuit breaker endpoint resiliency, multi-repository cross-referencing, intelligent context distillation, semantic diff analysis (`analyze_diff`), Web Streams SSE progress streaming, dynamic configuration profiles, hardware-aware concurrency control, and Docker containerization.
The implementation includes:

- 15 MCP tools registered across 4 feature groups;
- persistent `SqliteVectorIndex` built on native `node:sqlite`;
- automated `CircuitBreaker` state machine (`closed`, `open`, `half-open`);
- multi-repository cross-referencing via `additional_repositories` in `query_code_graph` and `search_semantic`;
- AST comment, docstring, and newline context distillation (`distillContext`);
- new `analyze_diff` tool for git commit diff summaries and architectural impact reports;
- Web Streams SSE stream parser (`parseSseStream`);
- preset configuration profiles (`fast`, `thorough`, `balanced`);
- hardware-aware concurrency scaling based on system RAM and CPU cores;
- official `Dockerfile` containerization;
- layered, revision-controlled configuration with atomic writes;
- canonical read-only repository access and fail-closed outbound filtering;
- structured inference through LM Studio, Ollama, vLLM, and LocalAI adapters;
- priority and model-aware routing, startup health checks, transient failover,
  and lazy recovery checks for failed providers;
- explicit trusted-LAN `none` mode for `lms` deployments without token support;
- repository-free health diagnostics and model availability checks;
- isolated task lifecycles with cross-process FIFO capacity;
- bounded repository exploration and validated test-only patch proposals;
- metadata-only operational logging with seven-day retention and time-series token offload statistics (`get_offload_stats`);
- confirmed Claude Code, Codex, Antigravity, Cursor, VS Code, and Neovim harness configuration via an
  interactive checkbox selector (arrow keys, `Space` to toggle, `Enter` to
  confirm) in the `setup`/`init` assistant, with a `--target` flag for scripts;
- selectable MCP feature groups during `setup`/`init` (`exploration`, `tests`,
  `docs`, and `lint`), with all groups enabled by default and `--features` for
  scripts;
- managed prompt-steering instruction files that direct harnesses to the MCP
  tools, with an optional custom `steering_prompt` preference;
- validated lint-fix patches, type-fix patches (`fix_type_errors` for `tsc` & `mypy`), and documentation patches returned as unapplied
  unified diffs, so write-heavy mechanical tasks stay on the developer's side
  of the boundary;
- an auto-validate test loop that iterates test generation in an isolated
  temporary copy of the repository until the tests pass (or the iteration and
  timeout limits are exhausted), so generated tests are only proposed once
  proven green;
- a protocol-clean MCP v2 server over `stdio`.

Local qualification is green as of 2026-08-04:

- `npm run validate` passes formatting, lint, architecture boundaries,
  typechecking, build, and all 368 automated tests;
- `npm run release:smoke` produces reproducible tarballs, installs one in an
  isolated prefix, starts the packaged MCP server, and verifies all 15 tools;
- the compiled MCP reports the real LM Studio instance healthy without a token,
  using `authentication: none` / `not_configured`;
- Qwen 3.5 9B and Gemma 4 12B passed structured-output, required tool-call, and
  vision probes; Nomic Embed returned 768-dimensional embeddings;
- the production dependency audit reports no known vulnerabilities.

The package is published under the open MIT license on npm as [`local-model-workers-mcp`](https://www.npmjs.com/package/local-model-workers-mcp) as well as attached as a release tarball to the [latest GitHub Release](https://github.com/gaabrielrd/local-model-workers-mcp/releases/latest).

The server exposes exactly fourteen MCP tools:

- `auto_validate_tests`
- `check_health`
- `explore_repository`
- `fix_lint_violations`
- `fix_type_errors`
- `generate_docs_patch`
- `get_config`
- `get_offload_stats`
- `propose_tests`
- `query_code_graph`
- `search_semantic`
- `summarize_module`
- `update_config`
- `validate_config`

See [prd.md](prd.md) for the complete requirements and acceptance criteria.

## V1 boundaries

- The MCP server runs locally over `stdio`.
- Only inference traffic reaches configured local model providers over HTTP on
  a trusted private network. Bearer authentication is optional per provider.
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

Install globally from npm:

```sh
npm install --global local-model-workers-mcp
```

Or run interactive setup directly without global installation via `npx`:

```sh
npx local-model-workers-mcp setup
```

Alternatively, install directly from the latest GitHub Release:

```sh
# Resolve the asset URL of the latest release and install it globally
TARBALL_URL="$(curl -fsSL https://api.github.com/repos/gaabrielrd/local-model-workers-mcp/releases/latest \
  | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).assets[0].browser_download_url")"
npm install --global "$TARBALL_URL"
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
- **MCP Features**: Press `Space` to enable or disable `exploration`, `tests`, `docs`, and `lint`. Administrative configuration and health tools remain available.
- **Target Harness(es)**: Press `Space` to toggle `claude-code`, `codex`, and/or `antigravity` on and off, arrow keys to move the cursor, `Enter` to confirm, and `Ctrl+C` to cancel. Use `--target` to skip the prompt in scripts.

Non-interactive setup for scripts or CI pipelines is also supported:

```sh
local-model-workers-mcp setup --target all --features exploration,tests \
  --url "http://localhost:1234/v1" --yes
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

For multi-provider routing, set `LMW_PROVIDERS` to a protected JSON array. A
lower numeric `priority` is preferred; the router selects the first healthy
provider that advertises and allows the requested model. See
[configuration.md](docs/configuration.md) for the schema and compatibility
behavior.

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
