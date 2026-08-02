# Testing strategy

**Status:** Target product strategy; foundation test suite implemented
**Last reviewed:** 2026-08-02

## Goals

Tests must demonstrate observable behavior at the server boundary and give
special weight to path security, data minimization, patch safety, configuration
integrity, and task lifecycle rules. Tests should not assert internal structure
when a public tool response or adapter interaction provides a stronger signal.

## Test layers

### Unit tests

Use unit tests for deterministic rules such as:

- input schema and configuration validation;
- path canonicalization and root containment;
- ignore and sensitive-file classification;
- context and exploration budgets;
- patch path and size classification;
- response-envelope construction and redaction;
- task state transitions, retry, and timeout decisions;
- configuration precedence and revision conflicts.

### Component tests

Exercise each feature through its public API with controlled filesystem, Git,
clock, and LM Studio adapters. These tests should verify orchestration without a
real network or a developer repository.

### MCP contract tests

Start the built server over `stdio` and verify that it:

- exposes exactly the six approved tools;
- accepts and rejects inputs according to their schemas;
- emits supported progress stages;
- returns uniform terminal states and error envelopes;
- never writes protocol-breaking output to stdout.

### Integration tests

Use temporary fixture repositories and a local fake LM Studio HTTP server to
test the complete local boundary. Fixtures must include:

- TypeScript and Python projects with working test infrastructure;
- a project without test infrastructure;
- Git-ignored, binary, `.env`, and `.mcp-agent-ignore` files;
- relative paths, path traversal attempts, and symlinks escaping the root;
- valid, oversized, production-changing, and ambiguous patches;
- files changed while a task is active;
- transient and permanent inference failures.

Integration tests must verify what leaves the HTTP adapter, not only the final
response, so prohibited content cannot pass unnoticed.

### Cross-process and platform tests

Run multiple server processes against the same coordination state to prove that
the default concurrency of two is global, the third task queues, queue and
processing timeouts differ, cancellation releases capacity, and abandoned
owners do not permanently consume a slot.

Installation, startup, and configuration-reading smoke tests are required on
macOS, Linux, and Windows. Full release-candidate validation of both Claude Code
and Codex is required on macOS for V1.

### Release-candidate validation

The official Python and TypeScript fixture projects measure the PRD success
criteria:

- 100% of evidence paths and lines are valid;
- at least 80% of proposed patches apply without conflict;
- at least 80% of applied patches start executable tests;
- 100% of patch paths are allowed;
- logs contain no repository content, prompt, response, patch, token, or
  credential.

The harness, never the MCP server, applies candidate patches and runs the
suggested commands during this validation.

## Required security cases

The automated suite must cover PRD acceptance criteria CA-07 through CA-13 and
CA-33 through CA-45. Include both expected attacks and malformed inputs:

- path traversal and symlink escape;
- prompt injection stored in repository content;
- secret leakage through errors, health checks, logs, or configuration reads;
- attempts to change protected configuration;
- stale configuration revisions and interrupted atomic writes;
- production-file changes hidden in a patch;
- stale evidence or a repository change before result delivery;
- partial remote output represented as success.

## Determinism and test data

- Use temporary directories; never inspect the developer's active repository in
  automated tests.
- Use fake clocks for retention, queue, and processing deadlines.
- Stub randomness or assert stable properties of task identifiers.
- Keep model responses as explicit fixtures and validate them as untrusted input.
- Do not place real tokens, credentials, or personal paths in fixtures or
  snapshots.
- Do not require a real LM Studio instance in the default validation suite.

## Validation command

The current foundation suite runs through `npm run validate` together with
formatting, linting, type checking, and the production build. It verifies that
package/runtime versions remain aligned, the compiled CLI exists, normal startup
does not write to stdout, version output uses stderr, and unknown options fail
without protocol output. Later tasks extend the same command with product,
security, MCP, and cross-process coverage described above.

The core-contract suite additionally verifies all terminal variants, required
task identity, strict success/diagnostic separation, evidence line ranges,
English technical names with Portuguese human text, known-secret redaction, and
feature import boundaries. Negative boundary fixtures prove that internal
cross-feature imports and shared-to-feature dependencies fail validation.
