# Testing strategy

**Status:** Implemented automated strategy; external release scenarios pending
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

Installation, startup, and configuration-reading smoke tests run on macOS,
Linux, and Windows through `.github/workflows/validate.yml`. Full
release-candidate validation of both Claude Code and Codex remains a manual
macOS release gate for V1.

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

The complete automated suite runs through `npm run validate` together with
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

The configuration suite uses temporary profiles and projects to verify strict
schemas, all precedence layers, administrative maxima, missing protected
settings, model allowlisting, deterministic secret-independent revisions,
redacted views, deeply immutable snapshots, portable global paths, invalid
project roots, and project preference symlinks escaping the root. It never reads
the developer's profile or requires a real LM Studio instance.

Configuration mutation tests additionally prove that validation is read-only,
confirmation binds one proposal and revision, protected and invalid fields fail
closed, stale and concurrent same-revision updates conflict, `null` removes an
override, existing snapshots remain unchanged, successful replacement changes
the revision, and simulated write/rename failures preserve original bytes and
clean the exact temporary file.

The repository-access suite uses only temporary directories and injected
filesystem fakes. It covers missing, file, and inaccessible roots; traversal,
absolute and sibling-prefix escapes; in-root and escaping symlinks; a symlink
changed after authorization; root identity replacement; priority-scope
validation; deterministic bounded listing; literal and safe-regex search;
snippet line/byte/file bounds; binary rejection; fixed redaction-safe errors;
and POSIX/Windows containment semantics. The public capability is asserted to
contain only its three read methods.

The outbound-filter suite captures the final context and proves that `.env`,
credential paths/content, private keys, Git/project ignores, NUL/binary data,
and invalid UTF-8 markers never appear. It also covers additive ignore
negation, malformed rules, Git and classifier uncertainty, the exact 15/50
interaction boundary, exact serialized multibyte byte accounting, whole-excerpt
budget omission, metadata-only limitations, unread relevant paths, duplicate
minimization, changing fingerprints, untrusted prompt-injection labeling, and a
real temporary Git repository exercised without a shell.

The LM Studio suite runs only against ephemeral loopback fake servers. It
captures request payloads and verifies that authorization is sent only when a
token is configured; verifies model allowlisting and
catalog availability without fallback; checks JSON Schema, reasoning-disabled
non-streaming requests and local output validation; bounds responses; rejects
partial or model-mismatched output; exercises one transient retry and permanent
non-retry; and proves cancellation/deadlines abort without an extra request.
Health component tests cover invalid configuration, unreachable endpoints,
authentication absent by configuration, failure, or non-enforcement, malformed catalogs, timeouts, and
default/per-allowed-model availability without a repository dependency. Real LM
Studio compatibility probes are opt-in operational evidence, not part of
`npm run validate`.

The task-lifecycle suite uses fake clocks, identifiers, inference, and retained
content-scope references. It proves unique task identity and cross-task content
isolation; immutable starting configuration; queued time excluded from the
processing deadline; default/configured timeout; cancellation propagation;
remaining-deadline inference composition; exactly one terminal result under
races and repeated `run`; diagnostic-only partial failure; transport-neutral
progress sequencing; and overwritten, empty, closed content after every
terminal category.

The capacity suite uses real temporary state directories and separate Node.js
worker processes. It proves that two workers acquire the default two slots, a
third waits, and a killed owner is recovered. Component cases cover committed
FIFO ordering, configured capacity without oversubscription, exact queue
timeout, queued and processing cancellation, normal release, stale state and
transaction-lock recovery, corrupt-state and live-capacity mismatch failures,
platform-standard state paths, administrative maxima, and a strict
metadata-only artifact schema.

The exploration suite drives fake structured model decisions through the public
use case. It verifies validation before inference; filtered list/search/read
observations; direct and iterative completion; exact evidence paths, lines, and
fingerprints; changed and invented evidence blocking; interaction and context
exhaustion; Portuguese human text with English technical fields; closed-protocol
rejection of unknown actions; progress events; and task-scoped prompt cleanup.
