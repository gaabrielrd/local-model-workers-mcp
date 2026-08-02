# Roadmap

**Last reviewed:** 2026-08-02

## Vision

Move simple workloads from expensive frontier AI models to free, local models.
Each phase is independently releasable and builds on the previous.

## Phase 1 — V1.0 (Completed)

Bounded repository exploration and test proposals delegated to LM Studio.

- 6 MCP tools: `explore_repository`, `propose_tests`, `check_health`,
  `get_config`, `validate_config`, `update_config`
- Read-only repository access with content filtering
- Task lifecycle with concurrency, timeout, cancellation, and retry
- Interactive setup for Claude Code, Codex, and Antigravity
- CI/CD with automated GitHub releases

## Phase 2 — V1.5: Read offloading and semantic analysis

Reduce input tokens consumed by frontier models when understanding repositories.

- **Embedding inference**: `/v1/embeddings` adapter for the LM Studio client
- **Vector index**: in-memory nearest-neighbor search with file persistence
- **Semantic search tool** (`search_semantic`): natural language repository search
- **Code graph** (`query_code_graph`): AST-based symbol extraction via tree-sitter
- **Module summarization** (`summarize_module`): cached, structured file summaries

## Phase 3 — V2.0: Repetitive write offloading

Move mechanical code tasks to local models.

- **Lint fix tool** (`fix_lint_violations`): generate validated patches from lint output
- **Documentation generation** (`generate_docs_patch`): inline and markdown docs
- **Multi-model routing**: map task types to specialized models via configuration

## Phase 4 — V3.0: Autonomous hybrid loop

Frontier model as architect/reviewer; local models handle iterative execution.

- **Auto-validate test loop** (`auto_validate_tests`): sandbox-based iterative
  test generation with real execution feedback
- **Multi-provider engine**: Ollama, vLLM, and LocalAI adapters with health-based
  failover

## Non-scope (all phases)

- Cloud provider inference (OpenAI, Anthropic, Google)
- Repository writes by the MCP server (except V3.0 temporary sandbox)
- Graphical interface or web application
- Multi-user administration or public network exposure
- Persistent task memory between sessions
