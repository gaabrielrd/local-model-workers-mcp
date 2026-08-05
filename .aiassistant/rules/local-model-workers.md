# local-model-workers-mcp:start
# Managed by local-model-workers-mcp. Edit only outside these markers.

## Offload repository work to local MCP tools

Do not echo large tool results verbatim into the conversation; reference paths and summarize findings instead.
Use `explore_repository` for goal-directed repository exploration instead of scanning raw files directly.
Use `search_semantic` for natural-language code search.
Use `query_code_graph` for symbol, caller, dependency, and export queries.
Use `summarize_module` for structured file or directory summaries.
Prefer targeted `query_code_graph`, `search_semantic`, and `summarize_module` calls over a broad `explore_repository` when a focused lookup suffices.
Use `propose_tests` when generating unit test proposals.
Use `auto_validate_tests` to generate and run unit tests iteratively in an isolated sandbox.
Do not echo `auto_validate_tests` iteration output; rely on its progress notifications and the final patch.
Use `generate_docs_patch` for documentation proposals.
Use `analyze_diff` for semantic git commit diff summaries and architectural impact analysis.
Use `fix_lint_violations` to repair linter errors.
Use `fix_type_errors` to repair compiler and type checker errors.

# local-model-workers-mcp:end
