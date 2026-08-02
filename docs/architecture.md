# Architecture

**Status:** Target product architecture; project foundation implemented
**Last reviewed:** 2026-08-02

## Purpose

Local Model Workers MCP is a local security and orchestration boundary between
an MCP harness and an LM Studio instance on a private network. It permits only
bounded repository reads and returns either a verified analysis or a validated
test-only patch.

The approved product behavior lives in [the PRD](../prd.md). This document
describes how the implementation must be separated without claiming that the
components already exist.

## System context

```text
Claude Code or Codex
        |
        | MCP over local stdio
        v
Local Model Workers MCP
  |     |              |
  |     |              +-- local configuration and metadata-only logs
  |     +-- read-only, root-scoped repository access
  +-- authenticated HTTP on a private LAN --> LM Studio
```

The harness owns user interaction, approval, patch application, and command
execution. The MCP server owns input validation, repository selection, remote
inference, output validation, concurrency, cancellation, and structured
responses. LM Studio receives only the context selected for one task and has no
direct filesystem access through this product.

## Runtime flow

### Repository exploration

1. The harness calls `explore_repository` with a goal, repository root, and
   optional priority scope.
2. The server validates configuration, canonicalizes the root and scope, and
   snapshots the effective configuration revision.
3. A task enters the shared concurrency queue.
4. The task may list directories, search text, and read bounded snippets through
   the repository access service.
5. The context filter removes prohibited, ignored, binary, and out-of-root
   content before any network request.
6. The LM Studio client requests an analysis from an authorized model.
7. The server validates cited paths and line references against the analyzed
   content and returns a uniform response.

### Test proposal

`propose_tests` follows the same boundary, plus these checks:

- existing test infrastructure must be detectable;
- output must be a unified diff;
- changed paths must be tests, fixtures, mocks, or test-only configuration;
- production changes and ambiguous paths block an applicable result;
- a task may affect at most 10 files and 1,000 changed lines;
- files used to generate the result must not have changed before completion.

The server returns suggested commands as text only. It never runs them.

## Target source organization

Product capabilities belong under `src/features`. Each feature exposes its
supported surface from `index.ts`; another feature must not import its internal
files.

The initial feature boundaries are expected to be:

- `mcp-server`: `stdio` transport, tool registration, input/output mapping, and
  progress notifications;
- `repository-exploration`: bounded discovery, context selection, and evidence
  validation;
- `test-proposal`: test-infrastructure detection and test-only patch validation;
- `configuration`: protected, global, and project configuration resolution,
  validation, revisioning, and atomic project updates;
- `task-execution`: task lifecycle, global concurrency, queueing, timeouts,
  cancellation, and retry policy;
- `health`: configuration and LM Studio diagnostics without repository access;
- `model-inference`: the service boundary around the LM Studio HTTP API;
- `operational-logging`: metadata-only records and seven-day retention.

`src/shared` may contain domain-neutral primitives only. External HTTP and
filesystem access must remain behind services or adapters. No browser storage
is planned for V1; if browser storage is ever introduced, it must also remain
behind an adapter.

These names are architectural boundaries, not a commitment to empty layers or
one directory per noun. The implementation should add abstractions only when a
concrete dependency or test seam requires them.

## Dependency rules

- A feature imports another feature only through its public `index.ts`.
- MCP transport types do not leak into domain rules.
- LM Studio request/response shapes stay inside the inference adapter.
- Filesystem, Git, clock, network, process, and persistence operations are
  injected at boundaries that require deterministic tests.
- `shared` cannot depend on a product feature.
- Tool handlers orchestrate use cases; they do not implement path security,
  patch parsing, or secret redaction inline.

## Task and configuration state

Every task has its own identifier, cancellation signal, context budget,
effective configuration revision, model, timestamps, and terminal result. Task
content cannot be reused by another task or persisted after completion.

Configuration precedence is:

1. protected administrative settings;
2. project preferences over global preferences for editable values;
3. built-in defaults where neither preference layer supplies a value.

An active task retains the resolved revision with which it started. Project
updates are confirmed, revision-checked, validated, and atomically written.
The storage locations and concrete schema remain implementation decisions; see
[configuration.md](configuration.md).

## Cross-process coordination

The default limit of two processing tasks is shared across all local MCP
processes, not enforced independently per process. The coordination mechanism
must support queue timeout, abandoned-owner recovery, and cancellation without
persisting repository content. Its concrete implementation must be recorded in
a dedicated ADR before code depends on it.

## Error and response model

All tools return a consistent structured envelope. Task terminal states are
`completed`, `blocked`, `failed`, `cancelled`, and `timed_out`. Technical field,
tool, state, and error-code names are in English; human explanations follow the
language of the request.

Partial output is diagnostic only and must never be represented as completed.
Secrets are redacted from success and error paths.

The implemented transport-neutral schemas, error catalog, language handling,
and omission rules for non-task tools are documented in
[contracts.md](contracts.md). MCP and LM Studio wire types remain outside these
contracts.

## Known limitations

- Only the TypeScript/Node.js foundation and minimal CLI exist; no product
  feature or MCP tool is implemented yet.
- Configuration filenames, environment-variable names, schemas, and storage
  locations have not been selected.
- The LM Studio endpoint contract and supported API version have not been
  pinned.
- The cross-process concurrency mechanism has not been selected.
- Linux and Windows receive basic automated coverage only in V1; complete
  harness validation is limited to macOS.
