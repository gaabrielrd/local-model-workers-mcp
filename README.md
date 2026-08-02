# Local Model Workers MCP

Local Model Workers MCP is a local MCP server under development that will let Claude Code and
Codex delegate repository exploration and test proposals to a model served by
LM Studio on another machine in a private local network.

The local server remains the security boundary: it selects repository context,
enforces path and content restrictions, validates remote output, and returns a
structured result. The remote model never writes to the repository, applies a
patch, or runs a project command.

## Project status

The product requirements and implementation plan are approved. The project
foundation is implemented: the repository has a pinned TypeScript/Node.js
toolchain, a buildable CLI entry point, automated tests, and a CI validation
workflow. Product tools, the MCP server, configuration files, and the
environment-variable contract are not implemented yet.

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
- Only inference traffic reaches LM Studio over authenticated HTTP on a trusted
  private network.
- Repository access is read-only and restricted to the requested root.
- Sensitive, ignored, binary, and explicitly excluded files are never sent to
  LM Studio.
- Test generation returns a validated unified diff; the MCP server never
  applies it or executes tests.
- Task content is ephemeral. Operational logs contain metadata only and are
  retained for seven days.
- macOS is the fully validated platform for V1. Basic portability checks are
  planned for Linux and Windows.

## Documentation

- [Product requirements](prd.md)
- [Architecture](docs/architecture.md)
- [Development process](docs/development-process.md)
- [Testing strategy](docs/testing.md)
- [Configuration model](docs/configuration.md)
- [Security model](docs/security.md)
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
production build. The current minimal CLI can also be built and inspected:

```sh
npm run build
node dist/cli/index.js --version
```

The version is written to stderr so stdout remains reserved for the future MCP
`stdio` protocol. Running the CLI without arguments currently exits cleanly and
does not start a server.

Do not create a local `.env` from guessed variable names. The supported names,
validation rules, and a redacted `.env.example` must be added together when the
configuration contract is implemented.
