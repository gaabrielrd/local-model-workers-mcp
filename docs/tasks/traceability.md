# V1 requirements traceability

**Status:** Implementation evidence recorded through Task 010
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
| RF-03 | [007](007-lm-studio-and-health.md), [013](013-mcp-stdio-server.md) | Implemented [health feature tests](../../test/health.test.ts); MCP registration planned |
| RF-04 | [005](005-repository-path-sandbox.md), [010](010-repository-exploration.md) | Implemented path sandbox and [pre-inference request validation](../../test/exploration.test.ts) |
| RF-05, RF-06 | [005](005-repository-path-sandbox.md), [006](006-content-filtering.md), [010](010-repository-exploration.md) | Implemented read capability, collector, and [filtered iterative protocol tests](../../test/exploration.test.ts) |
| RF-07 | [010](010-repository-exploration.md) | Implemented [structured result and evidence-validation tests](../../test/exploration.test.ts) |
| RF-08, RF-09, RF-10, RF-11, RF-12, RF-13 | [011](011-test-proposal.md) | Test-infrastructure and patch-policy tests |
| RF-14 | [008](008-task-lifecycle.md) | Implemented [isolation and cleanup tests](../../test/task-lifecycle.test.ts) |
| RF-15, RF-16 | [009](009-global-concurrency.md) | Implemented [multi-process capacity](../../test/capacity-process.test.ts) and [FIFO/timeout tests](../../test/capacity.test.ts) |
| RF-17, RF-18 | [008](008-task-lifecycle.md) | Implemented [deadline and cancellation race tests](../../test/task-lifecycle.test.ts) |
| RF-19 | [007](007-lm-studio-and-health.md), [008](008-task-lifecycle.md) | Implemented [adapter retry tests](../../test/lm-studio.test.ts) and [original-deadline lifecycle composition](../../test/task-lifecycle.test.ts) |
| RF-20 | [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Implemented [domain progress events](../../test/exploration.test.ts); MCP notifications planned |
| RF-21 | [007](007-lm-studio-and-health.md) | Implemented [model allowlist and availability tests](../../test/lm-studio.test.ts) |
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
| CA-03, CA-04, CA-05 | [007](007-lm-studio-and-health.md), [013](013-mcp-stdio-server.md) | Implemented [health success/auth/model diagnostics](../../test/health.test.ts); MCP exposure planned |
| CA-06 | [005](005-repository-path-sandbox.md), [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Implemented [empty-goal validation before inference](../../test/exploration.test.ts); MCP mapping planned |
| CA-07, CA-08 | [005](005-repository-path-sandbox.md) | Traversal and escaping-symlink tests |
| CA-09, CA-10, CA-11, CA-12, CA-13 | [006](006-content-filtering.md) | Captured outbound-context security tests |
| CA-14, CA-15 | [010](010-repository-exploration.md) | Implemented [evidence and limitation tests](../../test/exploration.test.ts) |
| CA-16, CA-17, CA-18, CA-19, CA-20, CA-21, CA-22, CA-23 | [011](011-test-proposal.md) | Infrastructure, patch-policy and no-write tests |
| CA-24, CA-25 | [009](009-global-concurrency.md) | Implemented [separate-process concurrency/crash recovery](../../test/capacity-process.test.ts) and [queue timeout](../../test/capacity.test.ts) |
| CA-26, CA-27 | [008](008-task-lifecycle.md) | Implemented [processing timeout and cancellation tests](../../test/task-lifecycle.test.ts) |
| CA-28, CA-29 | [007](007-lm-studio-and-health.md), [008](008-task-lifecycle.md) | Implemented [one-retry adapter tests](../../test/lm-studio.test.ts) and [terminal/partial lifecycle tests](../../test/task-lifecycle.test.ts) |
| CA-30 | [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Implemented [progress source tests](../../test/exploration.test.ts); MCP notification mapping planned |
| CA-31, CA-32 | [007](007-lm-studio-and-health.md) | Implemented [unauthorized and unavailable model tests](../../test/lm-studio.test.ts) |
| CA-33 | [003](003-configuration-loading.md), [013](013-mcp-stdio-server.md) | Redacted effective configuration tests |
| CA-34, CA-35, CA-36, CA-37, CA-38, CA-39 | [004](004-configuration-mutation.md), [008](008-task-lifecycle.md), [013](013-mcp-stdio-server.md) | Implemented mutation tests and [active snapshot immutability](../../test/task-lifecycle.test.ts); MCP exposure planned |
| CA-40 | [011](011-test-proposal.md) | Used-file change before patch delivery |
| CA-41, CA-42 | [002](002-core-contracts.md), [010](010-repository-exploration.md), [013](013-mcp-stdio-server.md) | Implemented envelope contracts and [localized exploration fields](../../test/exploration.test.ts); MCP mapping planned |
| CA-43 | [008](008-task-lifecycle.md) | Implemented [cross-task content isolation tests](../../test/task-lifecycle.test.ts) |
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
