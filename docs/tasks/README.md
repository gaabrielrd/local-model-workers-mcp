# V1 implementation plan

**Status:** Approved product scope; Tasks 001-005 implemented
**Source:** [PRD](../../prd.md)  
**Last reviewed:** 2026-08-02

## Objective

Deliver the complete V1 of Local Model Workers MCP as an installable local
server for Claude Code and Codex. The server must delegate bounded repository
exploration and test proposals to LM Studio while retaining all filesystem,
configuration, validation, concurrency, logging, and approval authority on the
developer's machine.

This directory is the execution plan. Each numbered file is one increment and
must finish with its own acceptance criteria, tests, documentation, and
`npm run validate` passing before the next task begins.

## Requirements summary

The implementation must:

- expose exactly the six tools approved in RF-02 over local MCP `stdio`;
- read repositories only through root-scoped list, search, and snippet
  operations;
- prevent sensitive, ignored, binary, excluded, or out-of-root content from
  reaching LM Studio;
- use authenticated HTTP to an allowlisted LM Studio model on a trusted private
  network;
- isolate tasks and enforce context, exploration, patch, queue, processing,
  cancellation, retry, and global concurrency limits;
- return verified evidence for exploration and a validated test-only unified
  diff for test proposals;
- resolve protected, global, and project configuration and allow only confirmed,
  revision-controlled project updates;
- retain metadata-only operational logs for seven days;
- install without silently overwriting Claude Code or Codex configuration;
- validate V1 on macOS and run basic portability checks on Linux and Windows.

The [PRD](../../prd.md), not this summary, is authoritative when wording differs.

## Assumptions

- The implementation will use TypeScript on a supported Node.js LTS release,
  with npm scripts, because the repository process already mandates
  `npm run validate` and a `src/features` architecture.
- The project starts without compatibility obligations for older releases or
  existing configuration files.
- One developer owns the local machine and LM Studio instance; team
  administration and multi-account isolation remain outside V1.
- Platform APIs are preferred. Dependencies are added only when a task documents
  why a platform API cannot safely implement the requirement.
- Exact SDK versions, configuration paths, schemas, endpoint variants, and
  cross-process coordination mechanisms are implementation details to resolve
  in the tasks that introduce them.
- Automated tests use fake inference and temporary repositories. A real LM
  Studio instance and real harnesses are reserved for opt-in or release-candidate
  validation.
- Technical contracts and documentation are written in English. Human-facing
  explanations follow the request language, including Portuguese scenarios.

## Information gaps to resolve

These gaps do not reopen approved product scope, but code must not proceed past
the owning task without resolving them:

| Gap | Owning task | Required outcome |
| --- | --- | --- |
| Node.js version, module format, test runner, MCP SDK, schema validation, build and lint tools | [Task 001](001-project-foundation.md) | Pinned toolchain and ADR |
| Response envelope and error-code catalog | [Task 002](002-core-contracts.md) | Versioned internal contracts |
| Config filenames, platform locations, environment variables, fields, units, defaults and maxima | [Tasks 003-004](003-configuration-loading.md) | Documented schema and redacted example |
| Sensitive-file and binary classification policy | [Task 006](006-content-filtering.md) | Fail-closed classifier with fixtures |
| LM Studio API endpoints, streaming choice and structured-output protocol | [Task 007](007-lm-studio-and-health.md) | Compatibility contract and adapter tests |
| Cross-process locking and abandoned-owner recovery | [Task 009](009-global-concurrency.md) | ADR and deterministic integration tests |
| Harness configuration formats and supported versions | [Task 014](014-installation-and-harnesses.md) | Versioned installation adapters |
| Package name and release distribution mechanics | [Task 014](014-installation-and-harnesses.md) | Installable artifact and rollback-safe setup |

## Non-scope

The plan does not add native harness subagents, multiple internal workers,
cross-task result consolidation, repository writes, patch application, command
or test execution by the MCP server, production-code changes, dependency
installation inside target repositories, creation of missing test
infrastructure, browser/GUI/mobile tests, calls to real third-party services,
team administration, shared multi-user hosting, public-network exposure,
certificate or reverse-proxy management, container-first installation,
automatic updates, a graphical interface, persistent task memory, or formal
language support beyond the Python and TypeScript release fixtures.

## Target solution

The application is organized by product capability under `src/features`.
Each feature exports only its public API through `index.ts`. MCP transport,
LM Studio HTTP, filesystem, Git, clock, process, configuration persistence, and
logging remain behind adapters.

The delivery sequence builds rules before orchestration:

1. establish a reproducible toolchain;
2. define stable contracts and configuration;
3. implement the local repository and inference boundaries;
4. implement task lifecycle and cross-process capacity;
5. build exploration and test-proposal use cases;
6. add privacy-preserving operations;
7. compose the six MCP tools;
8. package, install, and qualify the release.

## Sequential tasks

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 001 | [Project foundation](001-project-foundation.md) | Reproducible package, build and validation | — |
| 002 | [Core contracts](002-core-contracts.md) | Uniform states, errors and response types | 001 |
| 003 | [Configuration loading](003-configuration-loading.md) | Protected/global/project resolution and redaction | 001-002 |
| 004 | [Configuration mutation](004-configuration-mutation.md) | Validate and atomic revisioned project updates | 003 |
| 005 | [Repository path sandbox](005-repository-path-sandbox.md) | Root-scoped read-only operations | 001-002 |
| 006 | [Content filtering](006-content-filtering.md) | Git, secrets, binary, ignore and budget controls | 005 |
| 007 | [LM Studio and health](007-lm-studio-and-health.md) | Authenticated inference adapter and diagnostics | 002-003 |
| 008 | [Task lifecycle](008-task-lifecycle.md) | Isolation, timeout, cancellation and retry | 002-003, 007 |
| 009 | [Global concurrency](009-global-concurrency.md) | Cross-process limit and queue | 008 |
| 010 | [Repository exploration](010-repository-exploration.md) | Verified structured exploration | 006-009 |
| 011 | [Test proposal](011-test-proposal.md) | Validated test-only unified diff | 006-010 |
| 012 | [Operational logging](012-operational-logging.md) | Metadata-only logs and retention | 002, 008 |
| 013 | [MCP stdio server](013-mcp-stdio-server.md) | Six composed tools and progress | 004, 007, 010-012 |
| 014 | [Installation and harnesses](014-installation-and-harnesses.md) | Installable CLI and safe harness setup | 003-004, 013 |
| 015 | [Release qualification](015-release-qualification.md) | Cross-platform and V1 success evidence | 001-014 |

Tasks are sequential even where dependencies would allow parallel work. This
keeps one feature increment active at a time and makes failures attributable.

## Global completion rule

Every task must:

1. implement only its stated scope;
2. add tests for observable success, failure, and security behavior;
3. preserve public feature boundaries;
4. update affected operational and architecture documentation;
5. add or update an ADR when it resolves a durable decision;
6. run `npm run validate`;
7. review the final diff for scope, secrets, dead code, and unintended writes.

Task 015 additionally proves the PRD success metrics and all 52 acceptance
criteria. A locally green suite is necessary but not sufficient for release.

## Global risks

- **Remote-model protocol variance:** pin and contract-test the supported LM
  Studio API instead of accepting loosely shaped responses.
- **Filesystem escape and TOCTOU:** canonicalize every access and verify used
  files again before delivering applicable output.
- **Cross-process races:** use an explicitly documented coordination primitive
  with stale-owner recovery and process-level tests.
- **Secret leakage through secondary paths:** inspect outbound HTTP, errors,
  health responses, config views, stdout, stderr, and logs.
- **False patch classification:** fail closed on ambiguous paths and parse diffs
  structurally rather than with filename substrings alone.
- **Harness format drift:** isolate Claude Code and Codex adapters and validate
  supported versions in release checks.
- **Scope accumulation:** finish and validate each numbered increment before
  beginning the next.
- **Platform path differences:** use portable APIs and test filesystem,
  configuration, installation, and process behavior on all three target systems.

## Traceability

Each task lists the RF and CA identifiers it owns. The explicit
[traceability matrix](traceability.md) maps every requirement and acceptance
criterion to its implementation and release evidence. Task 015 performs the
final coverage audit. Requirements shared across layers are assigned to the task
that proves their externally observable result; lower-level prerequisite tests
remain in the earlier task.
