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

| Tool | Required input | Behavior |
| --- | --- | --- |
| `explore_repository` | `goal`, `repository_root` | Bounded exploration; optional `priority_paths` and `language` |
| `propose_tests` | `goal`, `repository_root` | Validated, unapplied test-only diff; optional scope and language |
| `check_health` | none | Repository-free LM Studio and configuration health |
| `get_config` | none | Redacted global configuration; optional `project_root` |
| `validate_config` | `project_root`, `expected_revision`, `changes` | Read-only project proposal validation |
| `update_config` | validation fields | Atomic write only with matching explicit `confirmation` |
| `query_code_graph` | `repository_root`, `query`, `query_type` | Symbol, caller, dependency, and export queries against the code graph; optional `file_filter` |
| `search_semantic` | `query`, `repository_root` | Ranked embedding search over the local vector index; optional `top_k` and `reindex` |
| `summarize_module` | `repository_root`, `target` | Structured file or directory summaries from code graph metadata and inference; optional `depth` (`shallow`/`deep`) and `force_refresh` |

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

The server registers exactly the nine tools above and no resources or prompts.
It never exposes shell, generic filesystem, generic prompt, command execution,
patch application, or dependency installation. Tool exceptions become a fixed
tool error without raw exception text. Operational terminal observers receive
only the metadata allowlist documented in
[operational-logging.md](operational-logging.md).
