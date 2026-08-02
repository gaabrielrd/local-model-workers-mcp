# ADR-0002: Use a pinned TypeScript and Node.js toolchain

- **Status:** Accepted
- **Date:** 2026-08-02
- **Scope:** Project foundation and future MCP implementation

## Context

The project needs a reproducible local executable for macOS, basic portability
to Linux and Windows, an official MCP implementation, strict static checks, and
a single validation command. The repository process already requires npm and a
feature-oriented TypeScript source tree.

As of this decision, Node.js 24.18.0 is the current LTS baseline. The official
MCP TypeScript SDK has a maintained stable v1 line while its newly published v2
line is still described as a beta release.

## Decision

- Use Node.js 24.18.0 and npm 11 as the pinned development and CI baseline.
- Use ECMAScript modules with TypeScript `NodeNext` resolution and emit source
  maps plus declarations to `dist/`.
- Expose only a package executable for now. Do not expose a library entry point
  until a concrete public library API exists.
- Use `tsc` for static type checking and production builds.
- Use the built-in `node:test` runner with `tsx` only as the development loader
  for TypeScript test files.
- Use ESLint flat configuration with `typescript-eslint` recommended
  type-checked rules.
- Use an exact local Prettier version for deterministic code formatting.
- Use the official stable v1 `@modelcontextprotocol/sdk` line for the V1 MCP
  server. Pin the exact package version when MCP code is introduced rather than
  installing an unused runtime dependency in the foundation.
- Use Zod 4 for runtime schemas starting with the core contracts. Pin it when
  those schemas are introduced in Task 002.
- Keep all development dependencies exact in `package.json` and commit the npm
  lockfile.

## Consequences

### Positive

- Local development and CI run the same LTS runtime and npm generation.
- ESM matches the official MCP SDK direction and avoids dual-module output.
- The test runner, build, and cleanup use Node platform APIs with few tools.
- Exact formatter and lockfile versions reduce non-deterministic validation.
- Runtime dependencies are introduced only when concrete code uses them.

### Negative

- Contributors need the pinned Node.js 24 release rather than any recent Node
  version.
- `tsx` is still required because the production build does not include tests.
- The stable MCP v1 choice may require a deliberate future migration after v2
  leaves beta; such a migration is outside this foundation task.
- Package metadata and the small compiled version constant must remain aligned,
  so the test suite enforces that invariant.

## Alternatives considered

### Adopt the MCP SDK v2 immediately

Rejected because its first published release is currently beta and the official
project continues to identify v1 as the production-safe line.

### Use the current non-LTS Node.js release

Rejected because the Node.js project recommends Active or Maintenance LTS for
production applications.

### Use a third-party test framework

Rejected for the foundation because `node:test` already provides the required
runner. `tsx` supplies TypeScript loading without adding a second test API.

### Publish both ESM and CommonJS

Rejected because the product is an executable and has no demonstrated CommonJS
consumer. Dual output would add build and package-surface complexity.
