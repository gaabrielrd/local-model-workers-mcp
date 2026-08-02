# Local Model Workers MCP

Local Model Workers MCP is a local MCP server that lets Claude Code and Codex
delegate repository exploration and test proposals to a model served by LM
Studio on another machine in a private local network.

The local server remains the security boundary: it selects repository context,
enforces path and content restrictions, validates remote output, and returns a
structured result. The remote model never writes to the repository, applies a
patch, or runs a project command.

## Project status

The product requirements and implementation plan are approved. The repository
has a pinned TypeScript/Node.js foundation, layered atomic configuration,
canonical read-only access, fail-closed outbound filtering, LM Studio structured
inference with optional Bearer authentication and health diagnostics, isolated task lifecycle,
cross-process FIFO capacity, and the complete transport-neutral repository
exploration and safe test-proposal use cases, plus metadata-only operational
logging and a protocol-clean MCP v2 `stdio` server exposing exactly six tools.
The approved V1 feature scope is implemented as release candidate
`1.0.0-rc.1`. Automated validation and installed-package smoke pass; publication
remains blocked on real-harness scenarios and remote portability
jobs documented in [release qualification](docs/release-qualification.md).

The intended V1 exposes exactly six MCP tools:

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
```

The version and configuration diagnostics are written to stderr so stdout
remains reserved for MCP `stdio`. Running the CLI without arguments starts the
six-tool server. Use `configure-harness` and `configure-global` as documented in
[installation.md](docs/installation.md); both support non-destructive dry runs
and exact confirmation before writes.

The protected environment contract and editable file examples are documented
in [configuration.md](docs/configuration.md). [`.env.example`](.env.example)
contains placeholders only; the application does not load `.env` files. When
configured, the Bearer token is not retained in effective configuration
snapshots.
