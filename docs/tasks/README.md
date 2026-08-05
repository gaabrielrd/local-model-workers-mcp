# Implementation plan

**Status:** Tasks 001-048 implemented (released as v1.0-v2.4); Tasks 049-056 implemented (v2.5-v2.12); Task 057 planned for v2.13.0  
**Source:** [PRD](../../prd.md) · [Roadmap](../roadmap.md)  
**Last reviewed:** 2026-08-05

## Objective

Deliver the complete v1.0-v2.4 scope of Local Model Workers MCP as an installable local
server for Claude Code, Codex, Antigravity, Cursor, VS Code, Neovim, and (v2.3)
JetBrains IDEs. The server delegates bounded repository
exploration, code graph, semantic search, module summarization, lint fixes, type fixes, test proposals, doc generation, auto-validation, and offload statistics to local model providers (LM Studio, Ollama, vLLM, LocalAI) while retaining all filesystem,
configuration, validation, concurrency, logging, and approval authority on the
developer's machine.

This directory is the execution plan. Each numbered file is one increment and
must finish with its own acceptance criteria, tests, documentation, and
`npm run validate` passing before the next task begins.

## Requirements summary

The implementation must:

- expose exactly the 15 tools approved in RF-02 & PRD over local MCP `stdio`;
- read repositories only through root-scoped list, search, and snippet
  operations;
- prevent sensitive, ignored, binary, excluded, or out-of-root content from
  reaching local model providers;
- use HTTP with optional Bearer authentication to an allowlisted model
  on a trusted private network;
- isolate tasks and enforce context, exploration, patch, queue, processing,
  cancellation, retry, and global concurrency limits;
- return verified evidence for exploration and a validated test-only unified
  diff for test proposals;
- resolve protected, global, and project configuration and allow only confirmed,
  revision-controlled project updates;
- retain metadata-only operational logs for seven days and expose `get_offload_stats`;
- install without silently overwriting harness configurations (Claude Code, Codex, Antigravity, Cursor, VS Code, Neovim);
- validate v1.0-v2.4 on macOS and run basic portability checks on Linux and Windows.

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

### Overview

| Task | Scope | Primary outcome | Status |
| --- | --- | --- | --- |
| 001 | Repository boundary | Canonical path isolation and error model | Completed |
| 002 | Read capability | Root-scoped directory list, search, snippet | Completed |
| 003 | Configuration engine | Protected/global/project config and mutations | Completed |
| 004 | Admin MCP tools | `check_health`, `get_config`, `validate_config`, `update_config` | Completed |
| 005 | Security filter | Content filter and outbound data collector | Completed |
| 006 | Remote client | HTTP inference client for LM Studio | Completed |
| 007 | Inference provider | Model router, retry, timeout, cancellation | Completed |
| 008 | Work manager | Isolated tasks, snapshots, lifecycle state | Completed |
| 009 | Exploration engine | Exploration strategy and interactive loop | Completed |
| 010 | Exploration MCP tool | `explore_repository` MCP tool | Completed |
| 011 | Test proposal engine | Diff parser, policy validator, proposer | Completed |
| 012 | Test proposal tool | `propose_tests` MCP tool | Completed |
| 013 | Operational logging | 7-day metadata log store and cleanup | Completed |
| 014 | Harness setup | Interactive installer for Claude Code & Codex | Completed |
| 015 | Release audit | Metrics, traceability, portability checks | Completed |
| 016 | Embedding inference | `/v1/embeddings` adapter in LM Studio client | Completed |
| 017 | Vector index | In-memory vector index with persistence | Completed |
| 018 | Semantic search tool | `search_semantic` MCP tool | Completed |
| 019 | Code graph | AST symbol extraction & `query_code_graph` tool | Completed |
| 020 | Module summary | `summarize_module` MCP tool | Completed |
| 021 | Lint fix tool | `fix_lint_violations` MCP tool | Completed |
| 022 | Doc generation | `generate_docs_patch` MCP tool | Completed |
| 023 | Multi-model routing | Model routing based on task type | Completed |
| 024 | Auto-validate loop | `auto_validate_tests` MCP tool with sandbox | Completed |
| 025 | Multi-provider engine | Ollama, vLLM, LocalAI adapters with failover | Completed |
| 026 | Prompt steering | Harness instruction files & steering hooks | Completed |
| 027 | Reactive indexing | File-hash incremental updates for `search_semantic` | Completed |
| 028 | Multi-lang AST | Tree-sitter grammars (Go, Rust, Java, C#) | Completed |
| 029 | Smart context routing | Context-length dynamic model selection | Completed |
| 030 | Type fix tool | `fix_type_errors` MCP tool for `tsc` and `mypy` | Completed |
| 031 | Extended IDE setup | Automated setup for Cursor, VS Code, Neovim | Completed |
| 032 | Token offload stats | `get_offload_stats` MCP tool (week, month, lifetime) | Completed |
| 033 | Coverage & quality | Quality benchmarks script & coverage reporting | Completed |
| 034 | SQLite vector storage | Persistent `SqliteVectorIndex` on `node:sqlite` | Completed |
| 035 | Multi-repo cross-ref | Symbol/vector retrieval across dependent workspaces | Completed |
| 036 | Context distillation | Comment/docstring/newline pruning before inference | Completed |
| 037 | Semantic diff analysis | `analyze_diff` commit summaries & impact reports | Completed |
| 038 | Streaming progress | Web Streams SSE parser & `sendNotification` progress | Completed |
| 039 | Circuit breaker | 3-state breaker & retry policy for model endpoints | Completed |
| 040 | Dynamic profiles | `fast`/`thorough`/`balanced` configuration profiles | Completed |
| 041 | Hardware concurrency | Task concurrency scaled by RAM and CPU cores | Completed |
| 042 | Expanded ecosystem | Official `Dockerfile` containerization | Completed |
| 043 | Daemon supervision | Memory/child-worker supervision & zero-leak recovery | Implemented |
| 044 | Hot-reload config | File-watcher config/profile reload without restart | Implemented |
| 045 | WSL2 setup | Official WSL2 setup scripts for Windows/Linux | Implemented |
| 046 | JetBrains support | Setup for IDEA, PyCharm, WebStorm, GoLand, CLion | Implemented |
| 047 | Post-processing hooks | User-defined local scripts after patch generation | Implemented |
| 048 | Workspace profiles | Project/workspace presets switchable via `update_config` | Implemented |
| 049 | Broader language coverage | Code graph and context distillation for Kotlin, Swift, Scala, PHP, Ruby, Elixir | Implemented |
| 050 | Harness context management | `result_verbosity` preference and terse result compaction | Implemented |
| 051 | Prompt-injection hardening | Untrusted-data wrapping and adversarial fixtures | Implemented |
| 052 | Response-path secret redaction | Credential scrubber on returned results | Implemented |
| 053 | Transport hardening | Optional HTTPS + TLS validation for providers | Implemented |
| 054 | Release-qualification gates | Real-harness scenarios and cross-platform CI | Implemented |
| 055 | Fault-injection suite | Resilience under injected transport/state faults | Implemented |
| 056 | Error-rate observability | Failure/retry/breaker metrics in offload stats | Implemented |
| 057 | Large-monorepo degradation | Size ceiling and bounded indexing/exploration | Planned (v2.13.0) |

## Sequential tasks

### Phase 1 — Foundation (v1.0)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 001 | [Repository boundary](001-repository-boundary.md) | Canonical path isolation and error model | - |
| 002 | [Read capability](002-read-capability.md) | Root-scoped directory list, search, snippet | 001 |
| 003 | [Configuration engine](003-configuration-engine.md) | Protected/global/project config and mutations | 001 |
| 004 | [Admin MCP tools](004-admin-mcp-tools.md) | `check_health`, `get_config`, `validate_config`, `update_config` | 002-003 |
| 005 | [Security filter](005-security-filter.md) | Content filter and outbound data collector | 001-002 |
| 006 | [Remote client](006-remote-client.md) | HTTP inference client for LM Studio | - |
| 007 | [Inference provider](007-inference-provider.md) | Model router, retry, timeout, cancellation | 006 |
| 008 | [Work manager](008-work-manager.md) | Isolated tasks, snapshots, lifecycle state | 001 |
| 009 | [Exploration engine](009-exploration-engine.md) | Exploration strategy and interactive loop | 002, 005, 007-008 |
| 010 | [Exploration MCP tool](010-exploration-mcp-tool.md) | `explore_repository` MCP tool | 004, 009 |
| 011 | [Test proposal engine](011-test-proposal-engine.md) | Diff parser, policy validator, proposer | 002, 005, 007-008 |
| 012 | [Test proposal tool](012-test-proposal-tool.md) | `propose_tests` MCP tool | 004, 011 |
| 013 | [Operational logging](013-operational-logging.md) | 7-day metadata log store and cleanup | 008 |
| 014 | [Harness setup](014-harness-setup.md) | Interactive installer for Claude Code & Codex | 003-004 |
| 015 | [Release audit](015-release-audit.md) | Metrics, traceability, portability checks | 001-014 |

### Phase 2 — Read offloading and semantic analysis (v1.1)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 016 | [Embedding inference](016-embedding-inference.md) | `/v1/embeddings` adapter in LM Studio client | 007 |
| 017 | [Vector index](017-vector-index.md) | In-memory vector index with persistence | 005-006, 016 |
| 018 | [Semantic search tool](018-semantic-search-tool.md) | `search_semantic` MCP tool | 013, 016-017 |
| 019 | [Code graph](019-code-graph.md) | AST-based symbol extraction and `query_code_graph` tool | 005-006 |
| 020 | [Module summarization](020-module-summarization.md) | `summarize_module` MCP tool | 007, 019 |
| 026 | [Harness prompt steering](026-harness-prompt-steering.md) | Pre-message hooks and system prompt instructions | 014, 018-019 |

### Phase 3 — Repetitive write offloading (v1.2)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 021 | [Lint fix tool](021-lint-fix-tool.md) | `fix_lint_violations` MCP tool | 011, 018 |
| 022 | [Documentation generation](022-docs-generation-tool.md) | `generate_docs_patch` MCP tool | 011, 020 |
| 023 | [Multi-model routing](023-multi-model-routing.md) | Task-type to model-id configuration routing | 003-004, 007 |

### Phase 4 — Autonomous hybrid loop (v2.0)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 024 | [Auto-validate loop](024-auto-validate-loop.md) | `auto_validate_tests` MCP tool with sandbox | 011, 023 |
| 025 | [Multi-provider engine](025-multi-provider-engine.md) | Ollama, vLLM, LocalAI adapters with failover | 007, 023 |

### Phase 5 — Dynamic routing & multi-language AST (v2.1)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 027 | [Reactive incremental indexing](027-reactive-incremental-indexing.md) | File-hash incremental updates for `search_semantic` | 017-018 |
| 028 | [Multi-language AST grammars](028-multi-language-ast-grammars.md) | Tree-sitter parsers (Go, Rust, Java, C#) for `query_code_graph` | 019 |
| 029 | [Smart context & task routing](029-smart-context-and-task-routing.md) | Task-based and context-length dynamic model selection | 023, 025 |
| 030 | [Type fix tool](030-type-fix-tool.md) | `fix_type_errors` MCP tool for `tsc` and `mypy` patches | 011, 021 |
| 031 | [Extended IDE setup](031-extended-ide-and-harness-setup.md) | Automated setup for Cursor, VS Code, and Neovim | 014, 026 |

### Phase 6 — Offload observability & quality benchmarks (v2.1)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 032 | [Token offload statistics tool](032-token-offload-statistics-tool.md) | `get_offload_stats` MCP tool with time-series aggregation (week, month, lifetime) | 012, 013 |
| 033 | [Coverage delta & quality benchmarks](033-coverage-delta-and-model-benchmarks.md) | Automated test coverage reporting in sandbox and local model benchmarks | 024, 025 |

### Phase 7 — V2.1 feature expansion (v2.1)

| Order | Task | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 034 | [SQLite vector storage](034-sqlite-vector-storage.md) | Persistent `SqliteVectorIndex` on `node:sqlite` | 017-018 |
| 035 | [Multi-repository cross-referencing](035-multi-repository-cross-referencing.md) | Symbol/vector retrieval across dependent workspaces | 017-019 |
| 036 | [Intelligent context distillation](036-intelligent-context-distillation.md) | Comment/docstring/newline pruning before inference | 019, 029 |
| 037 | [Semantic code diff analysis](037-semantic-code-diff-analysis.md) | `analyze_diff` commit summaries & architectural impact | 019, 020 |
| 038 | [Streaming tool-call progress](038-streaming-tool-call-progress.md) | Web Streams SSE parser & `sendNotification` progress | 007 |
| 039 | [Circuit breaker resiliency](039-circuit-breaker-resiliency.md) | 3-state breaker & retry policy for model endpoints | 007, 025 |
| 040 | [Dynamic configuration profiles](040-dynamic-configuration-profiles.md) | `fast`/`thorough`/`balanced` configuration profiles | 003, 013 |
| 041 | [Hardware-aware concurrency](041-hardware-aware-concurrency.md) | Task concurrency scaled by RAM and CPU cores | 005, 014 |
| 042 | [Expanded ecosystem](042-expanded-ecosystem.md) | Official `Dockerfile` containerization | 014 |

### Phase 8 — V2.2/V2.3/V2.4 roadmap

Tasks 043-045 shipped in v2.2.0, task 046 shipped in v2.3.0, and tasks 047-048
are implemented for v2.4.0 (see [roadmap.md](../roadmap.md)).

| Order | Task | Primary outcome | Depends on | Release |
| --- | --- | --- | --- | --- |
| 043 | [Daemon process supervision](043-daemon-process-supervision.md) | Memory/child-worker supervision, zero-leak recovery | 041 | v2.2.0 |
| 044 | [Live hot-reload configuration](044-live-hot-reload-configuration.md) | File-watcher config/profile reload without restart | 003, 040 | v2.2.0 |
| 045 | [WSL2 native setup](045-wsl2-native-setup.md) | Official WSL2 setup scripts for Windows/Linux | 042 | v2.2.0 |
| 046 | [JetBrains IDE suite](046-jetbrains-ide-suite.md) | Setup for IntelliJ IDEA, PyCharm, WebStorm, GoLand, CLion | 031 | v2.3.0 |
| 047 | [Custom post-processing hooks](047-custom-post-processing-hooks.md) | User-defined local scripts after patch generation | 011, 021 | v2.4.0 |
| 048 | [Workspace profiles](048-workspace-profiles.md) | Project/workspace presets switchable via `update_config` | 003, 040 | v2.4.0 |

### Phase 9 — V2.5 roadmap

Task 049 shipped in v2.5.0 (see [roadmap.md](../roadmap.md)).

| Order | Task | Primary outcome | Depends on | Release |
| --- | --- | --- | --- | --- |
| 049 | [Broader language coverage](049-broader-language-coverage.md) | Code graph and context distillation for Kotlin, Swift, Scala, PHP, Ruby, Elixir | 040 | v2.5.0 |

### Phase 10 — V2.6 roadmap

Task 050 shipped in v2.6.0 (see [roadmap.md](../roadmap.md) and
[ADR-0013](../decisions/0013-result-verbosity-compaction.md)).

| Order | Task | Primary outcome | Depends on | Release |
| --- | --- | --- | --- | --- |
| 050 | [Harness context management](050-harness-context-management.md) | `result_verbosity` preference, terse result compaction, context-efficiency steering | 026, 040 | v2.6.0 |

### Phase 11 — Reliability & security hardening

Tasks 051-057 shipped in v2.7.0-v2.13.0 (see [roadmap.md](../roadmap.md)); each
shipped as one minor release. Task 054 is process/QA: its tooling shipped, but
its external gates still require operator execution.

| Order | Task | Primary outcome | Depends on | Release |
| --- | --- | --- | --- | --- |
| 051 | [Prompt-injection hardening](051-prompt-injection-hardening.md) | Untrusted-data wrapping and adversarial fixtures | 026, 036 | v2.7.0 |
| 052 | [Response-path secret redaction](052-response-path-secret-redaction.md) | Credential scrubber on returned results | 051, 007 | v2.8.0 |
| 053 | [Transport hardening for the model hop](053-transport-hardening-model-hop.md) | Optional HTTPS + TLS validation for providers | 006, 007 | v2.9.0 |
| 054 | [Release-qualification gates](054-release-qualification-gates.md) | Real-harness scenarios and cross-platform CI | 015 | v2.10.0 |
| 055 | [Fault-injection test suite](055-fault-injection-test-suite.md) | Resilience under injected transport/state faults | 039, 038, 043 | v2.11.0 |
| 056 | [Error-rate observability](056-error-rate-observability.md) | Failure/retry/breaker metrics in offload stats | 032, 013 | v2.12.0 |
| 057 | [Large-monorepo degradation](057-large-monorepo-degradation.md) | Size ceiling and bounded indexing/exploration | 027, 034, 041 | v2.13.0 |


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
