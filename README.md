# Local Model Workers MCP

[![CI](https://github.com/gaabrielrd/local-model-workers-mcp/actions/workflows/validate.yml/badge.svg)](https://github.com/gaabrielrd/local-model-workers-mcp/actions/workflows/validate.yml)
[![npm version](https://img.shields.io/npm/v/local-model-workers-mcp.svg)](https://www.npmjs.com/package/local-model-workers-mcp)
[![npm downloads](https://img.shields.io/npm/dm/local-model-workers-mcp.svg)](https://www.npmjs.com/package/local-model-workers-mcp)
[![License: MIT](https://img.shields.io/npm/l/local-model-workers-mcp.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24.18-blue.svg)](package.json)

Run heavy repository work on your own models — without your code leaving your network.

Local Model Workers MCP is a local MCP server that lets your AI coding tools
(Claude Code, Codex, Antigravity, Cursor, VS Code, Neovim) delegate repository
exploration, semantic search, code queries, and test, docs, and lint work to a
local model served by **LM Studio, Ollama, vLLM, or LocalAI** — on the same
machine or a trusted private LAN.

It returns **validated, unapplied diffs** and structured results. The server,
not the model, is the security boundary: it reads your repository, filters what
leaves, validates what comes back, and never writes to your project.

## What you get

- **15 MCP tools** across four feature groups (`exploration`, `tests`, `docs`,
  `lint`) plus always-on health and configuration tools.
- **Bounded repository exploration** — goal-directed, evidence-backed analysis
  with progress streaming and client cancellation.
- **Semantic search & code queries** — a persistent SQLite vector index plus
  symbol, caller, dependency, and export queries across multiple repositories.
- **Validated, unapplied diffs** — test proposals, lint fixes, type fixes, and
  docs patches come back as unified diffs you review and apply yourself.
- **Auto-validated tests** — generated tests run in an isolated temporary copy
  of the repo and are proposed only once they pass.
- **Provider resiliency** — priority routing, health checks, circuit breakers,
  and failover across LM Studio, Ollama, vLLM, and LocalAI.
- **Offload savings you can measure** — weekly, monthly, and lifetime token
  counts with `get_offload_stats`.
- **Private by design** — only filtered inference traffic reaches your local
  model over a trusted LAN; credentials are redacted from configuration output.

## How it works

```
Your harness ──stdio (MCP)──> local-model-workers-mcp ──HTTP (private LAN)──> Your model
```

The local server:

1. **Reads** the repository through a canonical, fail-closed read capability
   (path sandbox, Git ignore rules, sensitive/binary exclusions).
2. **Sends only bounded context** to your model over the trusted LAN.
3. **Validates** the structured response.
4. **Returns** structured results — and writes as unapplied unified diffs.

The remote model can never write to your repository, apply a patch, or run a
project command. Test execution only ever happens in isolated temporary copies.

## Quick start

### 1. Install

```sh
npm install --global local-model-workers-mcp
```

Or run setup without a global install:

```sh
npx local-model-workers-mcp setup
```

### 2. Configure

```sh
local-model-workers-mcp setup
```

The interactive assistant walks you through the base URL, allowed and default
models, optional bearer token, feature groups, and target harnesses
(arrow keys to move, `Space` to toggle, `Enter` to confirm). It then writes the
harness configuration, runs a health check against your model, and installs a
managed steering block so your agent knows to use these tools.

Non-interactive for scripts and CI:

```sh
local-model-workers-mcp setup --target all \
  --features exploration,tests,docs,lint \
  --url "http://localhost:1234/v1" --yes
```

### 3. Use

Setup registers the server for your harness — just start your agent:

- **Claude Code**: run `claude` in your repository (project `.mcp.json`).
- **Codex**: run `codex` (`~/.codex/config.toml`).
- **Antigravity**: start Antigravity (`~/.gemini/config/mcp_config.json`).

Minimal environment:

```sh
export LMW_LM_STUDIO_BASE_URL='http://localhost:1234/v1'
export LMW_ALLOWED_MODELS='["qwen/qwen3.5-9b"]'   # optional: defaults to all served models
```

For multi-provider routing, set `LMW_PROVIDERS` to a protected JSON array — the
router picks the first healthy provider that serves the requested model. See
[docs/configuration.md](docs/configuration.md) for the full contract.

## Tools

| Group | Tools |
| --- | --- |
| Exploration | `explore_repository`, `query_code_graph`, `search_semantic`, `summarize_module` |
| Tests | `propose_tests`, `auto_validate_tests` |
| Docs | `generate_docs_patch`, `analyze_diff` |
| Lint | `fix_lint_violations`, `fix_type_errors` |
| Administration | `check_health`, `get_config`, `get_offload_stats`, `validate_config`, `update_config` |

## Quality

- Published on [npm](https://www.npmjs.com/package/local-model-workers-mcp) and
  attached to the latest
  [GitHub Release](https://github.com/gaabrielrd/local-model-workers-mcp/releases/latest)
  under the MIT license.
- `npm run validate` is green on macOS, Linux, and Windows CI — formatting,
  lint, typecheck, build, and 370 automated tests.
- Release qualification verifies the packaged server registers all 15 tools and
  runs real-model structured-output probes.

## Documentation

- [Architecture](docs/architecture.md) · [Security model](docs/security.md) ·
  [Configuration](docs/configuration.md) · [Installation & harness setup](docs/installation.md)
- [MCP tool reference](docs/mcp-tools.md) · [Testing strategy](docs/testing.md) ·
  [External integrations](docs/integrations.md) · [Architecture decisions](docs/decisions/README.md)
- [Product requirements](prd.md) · [Development process](docs/development-process.md)

## Development

Requires Node.js 24.18.x and npm 11.x (see `.nvmrc`):

```sh
nvm use
npm ci
npm run validate
```

`npm run validate` checks formatting, linting, types, tests, and the production
build. Build and inspect a release candidate with:

```sh
npm run build
npm run pack:check
npm run release:smoke
```

## License

[MIT](LICENSE)
