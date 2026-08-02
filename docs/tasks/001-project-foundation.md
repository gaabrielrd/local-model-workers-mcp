# Task 001: Establish the project foundation

**Status:** Completed
**Completed:** 2026-08-02
**Depends on:** None  
**PRD coverage:** Quality constraints and platform/distribution prerequisites

## Objective

Create the smallest reproducible TypeScript/Node.js package that can build,
test, lint, type-check, format-check, and produce an executable local CLI entry
point without implementing product tools.

## Requirements

- Select and pin a supported Node.js LTS baseline and npm package metadata.
- Decide ESM versus CommonJS, build output, source maps, package exports, and
  executable entry point.
- Select the MCP SDK, schema validator, test runner, formatter, linter, and build
  approach only after documenting why each dependency is necessary.
- Provide `npm run validate` as the single local and CI quality gate.
- Create the `src/features` and domain-neutral `src/shared` boundaries
  without placeholder abstraction layers.
- Keep stdout available for the future MCP protocol.
- Add basic CI jobs for the supported Node.js baseline; platform expansion
  belongs to Task 015.

## Non-scope

No MCP tools, LM Studio request, repository read, configuration behavior,
concurrency, logging, or installer mutation is implemented here.

## Implementation outline

1. Record the toolchain and module-format decision in an ADR.
2. Create `package.json`, lockfile, TypeScript and build configuration.
3. Configure formatting, linting, type checking, unit tests, and build.
4. Add a minimal executable that can report its version to a protocol-safe
   channel and exit cleanly.
5. Add CI for install and `npm run validate`.
6. Update setup commands in README and development/testing documentation.

## Expected areas

- Root package and tool configuration
- `src/cli` or the selected executable boundary
- `src/features` and `src/shared`
- Initial test directory and CI workflow
- Toolchain ADR and contributor documentation

## Tests

- Clean install from the lockfile.
- Build produces the declared executable artifact.
- Executable starts and exits without protocol output on stdout.
- Each validation stage fails on a controlled violation.
- `npm run validate` passes from a clean checkout.

## Risks

- An SDK or test choice may force a module format or unsupported Node version.
- A version command that writes to stdout must not be reused during MCP mode.
- Premature folder scaffolding can create architecture with no demonstrated use.

## Acceptance criteria

- The toolchain decision and dependency rationale are documented.
- A clean checkout can install, validate, and build using documented commands.
- `npm run validate` covers formatting, linting, types, tests, and build.
- No product behavior is presented as implemented.
- README no longer claims that `package.json` is absent.

## Completion evidence

- `npm ci` reproduced all exact development dependencies from
  `package-lock.json`.
- `npm run validate` passed formatting, linting, type checking, 10 tests, and
  the production build.
- Controlled violations proved that formatting, linting, type checking, tests,
  and build each fail when expected.
- The packed CLI entry point retained executable mode and normal startup wrote
  no bytes to stdout.
