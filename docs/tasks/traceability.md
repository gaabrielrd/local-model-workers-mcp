# V1 requirements traceability

**Status:** Planned coverage  
**Source:** [PRD](../../prd.md)  
**Last reviewed:** 2026-08-02

This matrix assigns every approved functional requirement and acceptance
criterion to the task that implements or proves it. A task reference is planned
coverage, not evidence that the criterion already passes. Task 015 must replace
planned coverage with links to actual automated or release evidence.

## Functional requirements

| Requirement | Owning task(s) | Planned evidence |
| --- | --- | --- |
| RF-01, RF-02 | [013](013-mcp-stdio-server.md), [014](014-installation-and-harnesses.md) | MCP process discovery and installed harness smoke tests |
| RF-03 | [007](007-lm-studio-and-health.md), [013](013-mcp-stdio-server.md) | Health feature and MCP contract tests |
| RF-04 | [005](005-repository-path-sandbox.md), [010](010-repository-exploration.md) | Request validation and exploration integration tests |
| RF-05, RF-06 | [005](005-repository-path-sandbox.md), [006](006-content-filtering.md), [010](010-repository-exploration.md) | Read-capability, outbound-context and budget tests |
| RF-07 | [010](010-repository-exploration.md) | Structured result and evidence-validation tests |
| RF-08, RF-09, RF-10, RF-11, RF-12, RF-13 | [011](011-test-proposal.md) | Test-infrastructure and patch-policy tests |
| RF-14 | [008](008-task-lifecycle.md) | Isolation and cleanup tests |
| RF-15, RF-16 | [009](009-global-concurrency.md) | Multi-process capacity and queue tests |
| RF-17, RF-18 | [008](008-task-lifecycle.md) | Deadline and cancellation race tests |
| RF-19 | [007](007-lm-studio-and-health.md), [008](008-task-lifecycle.md) | Retry classification and deadline composition tests |
| RF-20 | [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Domain event and MCP progress tests |
| RF-21 | [007](007-lm-studio-and-health.md) | Model allowlist and availability tests |
| RF-22 | [003](003-configuration-loading.md), [013](013-mcp-stdio-server.md) | Effective-config and MCP redaction tests |
| RF-23, RF-24, RF-25 | [004](004-configuration-mutation.md), [013](013-mcp-stdio-server.md) | Validation, atomic update and snapshot tests |
| RF-26 | [006](006-content-filtering.md), [010](010-repository-exploration.md), [011](011-test-proposal.md) | Fingerprint and stale-result tests |
| RF-27 | [002](002-core-contracts.md), [013](013-mcp-stdio-server.md) | Type/serialization and MCP envelope tests |
| RF-28 | [014](014-installation-and-harnesses.md) | Harness setup fixture and smoke tests |
| RF-29 | [012](012-operational-logging.md) | Log allowlist and retention tests |

## Acceptance criteria

| Criterion | Owning task(s) | Planned evidence |
| --- | --- | --- |
| CA-01, CA-02 | [013](013-mcp-stdio-server.md), [014](014-installation-and-harnesses.md), [015](015-release-qualification.md) | Installed Claude Code and Codex discovery |
| CA-03, CA-04, CA-05 | [007](007-lm-studio-and-health.md), [013](013-mcp-stdio-server.md) | Health success/auth/model diagnostics |
| CA-06 | [005](005-repository-path-sandbox.md), [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Empty-goal validation before network access |
| CA-07, CA-08 | [005](005-repository-path-sandbox.md) | Traversal and escaping-symlink tests |
| CA-09, CA-10, CA-11, CA-12, CA-13 | [006](006-content-filtering.md) | Captured outbound-context security tests |
| CA-14, CA-15 | [010](010-repository-exploration.md) | Evidence and limitation tests |
| CA-16, CA-17, CA-18, CA-19, CA-20, CA-21, CA-22, CA-23 | [011](011-test-proposal.md) | Infrastructure, patch-policy and no-write tests |
| CA-24, CA-25 | [009](009-global-concurrency.md) | Separate-process concurrency and queue timeout |
| CA-26, CA-27 | [008](008-task-lifecycle.md) | Processing timeout and cancellation tests |
| CA-28, CA-29 | [007](007-lm-studio-and-health.md), [008](008-task-lifecycle.md) | One-retry and partial-result tests |
| CA-30 | [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Progress event and notification tests |
| CA-31, CA-32 | [007](007-lm-studio-and-health.md) | Unauthorized and unavailable model tests |
| CA-33 | [003](003-configuration-loading.md), [013](013-mcp-stdio-server.md) | Redacted effective configuration tests |
| CA-34, CA-35, CA-36, CA-37, CA-38, CA-39 | [004](004-configuration-mutation.md), [013](013-mcp-stdio-server.md) | Validation, confirmation, conflict, policy and snapshot tests |
| CA-40 | [011](011-test-proposal.md) | Used-file change before patch delivery |
| CA-41, CA-42 | [002](002-core-contracts.md), [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Envelope completeness and language tests |
| CA-43 | [008](008-task-lifecycle.md) | Cross-task content isolation tests |
| CA-44, CA-45 | [012](012-operational-logging.md) | Metadata allowlist and exact retention boundary |
| CA-46 | [014](014-installation-and-harnesses.md) | Existing-config conflict confirmation |
| CA-47 | [015](015-release-qualification.md) | Real macOS Claude Code and Codex qualification |
| CA-48 | [010](010-repository-exploration.md), [015](015-release-qualification.md) | Python/TypeScript evidence metrics |
| CA-49, CA-50, CA-51 | [011](011-test-proposal.md), [015](015-release-qualification.md) | Patch applicability, executable tests and allowed paths |
| CA-52 | [015](015-release-qualification.md) | Linux and Windows install/start/config smoke tests |

## Coverage completion rule

Before V1 release, every row must link to named test cases, CI jobs, or a
documented release-candidate run. Percentage targets cannot compensate for a
failed criterion that requires 100% security, privacy, path, patch, or
configuration protection.
