# MCP stdio tools

**Status:** Implemented with `@modelcontextprotocol/server` 2.0.0  
**Last reviewed:** 2026-08-02

The executable starts a local MCP server over `stdio` when invoked without
arguments. Stdout is reserved for MCP JSON-RPC frames; safe startup diagnostics
use stderr. The server supports the official SDK's legacy 2025 handshake and
the 2026-07-28 negotiation path through `serveStdio`.

Invalid protected or global startup configuration exits with code 78 and the
fixed stderr message `Invalid startup configuration.` before registering tools.
Raw configuration errors and credentials are never printed.

## Registered tools

`check_health`, `get_config`, `validate_config`, and `update_config` are always
registered. The remaining tools are grouped by the global `enabled_features`
preference selected during setup:

| Feature group | Tools |
| --- | --- |
| `exploration` | `explore_repository`, `query_code_graph`, `search_semantic`, `summarize_module` |
| `tests` | `propose_tests`, `auto_validate_tests` |
| `docs` | `generate_docs_patch`, `analyze_diff` |
| `lint` | `fix_lint_violations`, `fix_type_errors` |

Omitting `enabled_features` registers every group for backward compatibility.

| Tool | Required input | Behavior |
| --- | --- | --- |
| `explore_repository` | `goal`, `repository_root` | Bounded exploration; optional `priority_paths` and `language` |
| `propose_tests` | `goal`, `repository_root` | Validated, unapplied test-only diff; optional scope and language |
| `check_health` | none | Repository-free configuration and per-provider health |
| `get_config` | none | Redacted configuration, provider status, and active default-model route; optional `project_root` |
| `get_offload_stats` | none | Weekly, monthly, and lifetime token savings and queries offloaded; optional `period` and `log_directory` |
| `validate_config` | `project_root`, `expected_revision`, `changes` | Read-only project proposal validation |
| `update_config` | validation fields | Atomic write only with matching explicit `confirmation` |
| `query_code_graph` | `repository_root`, `query`, `query_type` | Symbol, caller, dependency, and export queries against the code graph; optional `file_filter` and `additional_repositories` |
| `search_semantic` | `query`, `repository_root` | Ranked embedding search over the local vector index; optional `top_k`, `reindex`, and `additional_repositories` |
| `summarize_module` | `repository_root`, `target` | Structured file or directory summaries from code graph metadata and inference; optional `depth` (`shallow`/`deep`) and `force_refresh` |
| `fix_lint_violations` | `repository_root`, `lint_output` | Validated, unapplied unified diff that fixes only the reported lint violations; optional `linter` (`eslint`/`biome`/`ruff`/`auto`) and `max_files` |
| `fix_type_errors` | `repository_root`, `type_output` | Validated, unapplied unified diff that fixes compiler/type-checker errors; optional `checker` (`tsc`/`mypy`/`pyright`/`auto`) and `max_files` |
| `generate_docs_patch` | `repository_root`, `target`, `doc_type` | Validated, unapplied docs-only unified diff (JSDoc/docstring inline comments and/or a `docs/<slug>.md` guide) for public symbols; optional `style` (`jsdoc`/`tsdoc`/`numpy`/`google`) and `force_refresh` |
| `analyze_diff` | `repository_root` | Semantic analysis of git commit diffs, generating human-readable summaries and architectural impact reports; optional `commit_range` and `file_filter` |
| `auto_validate_tests` | `goal`, `repository_root` | Iterative test generation executed in an isolated temporary copy until green (or the limit is exhausted); optional `test_command`, `max_iterations`, and `timeout_per_iteration_ms` |

Every input object is strict: unknown fields and invalid bounds are rejected by
the MCP SDK before a feature is invoked. Results are returned in both a JSON
text content block and `structuredContent`. Task tools retain the common
terminal envelope; non-task tools retain their domain contracts.

Task calls propagate the MCP request abort signal into queueing, repository
work, and HTTP inference. Client cancellation or orderly process shutdown aborts
owned work and releases global capacity. Legacy clients that request progress
receive the four stable task stages; clients without progress support receive
the same final result.

## Protocol safety

With every feature enabled, the server registers exactly the 15 tools above
and no resources or prompts. A reduced setup registers only the selected
feature tools plus the administrative tools.
It never exposes shell, generic filesystem, generic prompt, command execution,
patch application, or dependency installation. Tool exceptions become a fixed
tool error without raw exception text. Operational terminal observers receive
only the metadata allowlist documented in
[operational-logging.md](operational-logging.md).
