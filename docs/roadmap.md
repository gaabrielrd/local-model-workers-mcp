# Roadmap

**Last reviewed:** 2026-08-03

## Vision

Move heavy code understanding and mechanical edit workloads from expensive cloud models to fast, free, local models. Local Model Workers MCP operates as the local security and validation boundary, empowering AI coding assistants across all major IDEs.

---

## Phase 1 to Phase 7 — V1.0 to V2.1 (Completed)

Releases 1.0.0 through 2.1.0 delivered a complete, 15-tool local offloading engine:

- **15 MCP Tools**: `explore_repository`, `propose_tests`, `check_health`, `get_config`, `validate_config`, `update_config`, `query_code_graph`, `search_semantic`, `summarize_module`, `fix_lint_violations`, `fix_type_errors`, `generate_docs_patch`, `analyze_diff`, `auto_validate_tests`, `get_offload_stats`
- **SQLite Vector Index**: Persistent `SqliteVectorIndex` using built-in `node:sqlite`
- **Circuit Breaker Resiliency**: Automated 3-state circuit breaker pattern for local model endpoints
- **Multi-Repository Cross-Referencing**: Cross-repository symbol and vector retrieval (`additional_repositories`)
- **Intelligent Context Distillation**: Comment, docstring, and newline pruning (`distillContext`)
- **Streaming & SSE Parsing**: Web Streams-based SSE parser (`parseSseStream`)
- **Dynamic Configuration & Profiles**: Configuration profile presets (`fast`, `thorough`, `balanced`)
- **Hardware-Aware Concurrency**: Dynamic task concurrency based on system RAM and CPU core count
- **Containerization**: Official Docker container setup (`Dockerfile`)

Version 3.0 focuses on multi-repository intelligence, enterprise-grade stability, context distillation, and seamless developer environment support.

### 1. Advanced Intelligence & New Features

- **Multi-Repository Cross-Referencing**:
  Query code graphs (`query_code_graph`) and perform semantic searches (`search_semantic`) across multiple dependent local workspace repositories simultaneously.
- **Intelligent Context Distillation & Prompt Compression**:
  Automatically prune redundant AST nodes, dead code comments, and repeated signatures before sending context to local models, reducing prompt token count by up to 40% and accelerating local inference speed.
- **Semantic Code Diff Analysis (`analyze_diff`)**:
  New MCP tool that analyzes git commit history, pull request diffs, and local branch changes using local models to generate human-readable summaries, architectural impact reports, and potential regression alerts.
- **Streaming Tool Call Progress**:
  Stream intermediate local model thoughts and token generation status in real time to supported client harnesses over transport-neutral progress notifications.
- **Custom Post-Processing Hooks**:
  User-defined local scripts executed immediately after patch generation for custom formatting, security policy checks, or lint validations before proposals are returned to the client.

### 2. Improved Stability & Reliability

- **Circuit Breaker & Endpoint Resiliency**:
  Automated circuit breaking for local model endpoints. If a local provider experiences high latency or repeated HTTP timeouts, inference automatically degrades gracefully to alternate local providers or returns fallback hints without crashing active tasks.
- **SQLite / Embedded Vector Storage (`sqlite-vec`)**:
  Upgrade `InMemoryVectorIndex` to an embedded SQLite-backed vector storage option with zero cold-start latency, instant persistence, and scalable vector retrieval for 100k+ file codebases.
- **Daemon Process Supervision & Zero-Leak Memory Management**:
  Built-in memory monitoring and child worker process supervision to ensure long-running stdio MCP server sessions maintain a minimal memory footprint without memory leaks.
- **Hardware-Aware Concurrency Control**:
  Dynamic rate limiting and concurrency tuning based on real-time GPU/CPU utilization and VRAM metrics exposed by Ollama and LM Studio.

### 3. Expanded Ecosystem & Harness Support

- **JetBrains IDE Suite Support**:
  Interactive setup support for IntelliJ IDEA, PyCharm, WebStorm, GoLand, and CLion via `.idea` MCP configuration adapters and steering prompt rules.
- **Containerized Execution & WSL2 Native Setup**:
  Official Docker containerized server image (`ghcr.io/gaabrielrd/local-model-workers-mcp`) and WSL2 setup scripts for Windows developers using Linux containers.
- **Live Hot-Reloadable Configuration**:
  File-watcher integration that reloads configuration changes instantly without requiring an MCP server process restart.
- **Workspace Profiles & Multi-Preset Modes**:
  Instant switching between development, security auditing, refactoring, and documentation presets via `update_config`.

---

## Non-scope (all phases)

- Cloud provider inference APIs (OpenAI, Anthropic, Google)
- Direct repository writes by the MCP server outside temporary auto-validate sandboxes
- Graphical desktop interface or web applications
- Multi-user remote hosting or public network exposure

