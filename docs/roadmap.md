# Roadmap

**Last reviewed:** 2026-08-03

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

## Phase 2 — V1.5: Read offloading and semantic analysis (Completed)

Reduce input tokens consumed by frontier models when understanding repositories.

- **Embedding inference**: `/v1/embeddings` adapter for the LM Studio client
- **Vector index**: in-memory nearest-neighbor search with file persistence
- **Semantic search tool** (`search_semantic`): natural language repository search
- **Code graph** (`query_code_graph`): AST-based symbol extraction via tree-sitter
- **Module summarization** (`summarize_module`): cached, structured file summaries
- **Harness prompt steering**: managed instruction files (`AGENTS.md`,
  `.codex/instructions.md`, `.gemini/instructions.md`) directing harnesses to
  proactively use MCP capabilities, with optional `steering_prompt` directives

## Phase 3 — V2.0: Repetitive write offloading (Completed)

Move mechanical code tasks to local models.

- **Lint fix tool** (`fix_lint_violations`): generate validated patches from lint output
- **Documentation generation** (`generate_docs_patch`): inline and markdown docs
- **Multi-model routing**: map task types to specialized models via configuration

## Phase 4 — V3.0: Autonomous hybrid loop (Completed)

Frontier model as architect/reviewer; local models handle iterative execution.

- **Auto-validate test loop** (`auto_validate_tests`): sandbox-based iterative
  test generation with real execution feedback
- **Multi-provider engine**: Ollama, vLLM, and LocalAI adapters with health-based
  failover — implemented in Task 025

## Phase 5 — V3.5: Dynamic routing, multi-language AST & ecosystem expansion

Refine code intelligence, routing, and developer experience across local environments.

- **Reactive incremental indexing**: file-hash-based incremental updates for `search_semantic`
- **Expanded AST grammars**: Tree-sitter support for Go, Rust, Java, and C# in `query_code_graph`
- **Smart context & task routing**: dynamic model selection based on context window size and task capability (e.g. fast embedding models vs. heavy reasoning models)
- **Type fix tool** (`fix_type_errors`): generate validated, unapplied patches from `tsc` or `mypy` error outputs
- **Expanded IDE & harness setup**: automated setup support for Cursor, VS Code (Roo Code / Continue / Cline), and Neovim (Avante.nvim)

## Phase 6 — V4.0: Token offload observability & model quality benchmarking

Provide historical visibility into local offloading gains and model output quality.

- **Historical token offload statistics tool** (`get_offload_stats`): track and persist local token savings aggregated by week, month, and lifetime (over time) without sending data off-device
- **Coverage delta reporting**: estimate and report test coverage improvements within `auto_validate_tests`
- **Local model quality benchmarks**: automated test suite evaluating local model performance (Qwen, Llama, DeepSeek R1 local) on patch generation and code exploration tasks

## Non-scope (all phases)

- Cloud provider inference (OpenAI, Anthropic, Google)
- Repository writes by the MCP server (except V3.0 temporary sandbox)
- Graphical interface or web application
- Multi-user administration or public network exposure
- Persistent task execution state between sessions (aggregated operational token metrics are persisted locally strictly for historical statistics reporting)

