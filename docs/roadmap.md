# Roadmap

**Last reviewed:** 2026-08-04

## Vision

Move heavy code understanding and mechanical edit workloads from expensive cloud
models to fast, free, local models. Local Model Workers MCP operates as the
local security and validation boundary, empowering AI coding assistants across
all major IDEs.

---

## Delivered — v1.0 to v2.4

Releases 1.0.0 through 2.4.0 delivered a complete, 15-tool local offloading
engine, its operator-grade stability layer, the ecosystem harnesses, and the
extensibility pillar:

- **15 MCP tools** across `exploration`, `tests`, `docs`, and `lint` feature
  groups plus always-on administration tools;
- **SQLite vector storage** — persistent `SqliteVectorIndex` on native
  `node:sqlite`;
- **Circuit breaker resiliency** — automated 3-state breaker for model
  endpoints;
- **Multi-repository cross-referencing** — symbol and vector retrieval across
  dependent workspaces (`additional_repositories`);
- **Intelligent context distillation** — comment, docstring, and newline
  pruning before inference;
- **Semantic diff analysis** — `analyze_diff` for commit summaries and
  architectural impact reports;
- **Streaming & SSE parsing** — Web Streams SSE parser for progress
  notifications;
- **Dynamic configuration profiles** — `fast`, `thorough`, `balanced` presets;
- **Hardware-aware concurrency** — task concurrency scaled by RAM and CPU cores;
- **Containerization** — official `Dockerfile`;
- **Custom post-processing hooks** — user-defined local scripts after patch
  generation with temp-dir isolation and fail-closed blocking;
- **Workspace profiles** — project/workspace presets switchable at runtime via
  `update_config` without a restart.

### v2.2.0 — Stability & operator experience

- **Daemon process supervision**:
  Built-in memory monitoring and child-worker supervision so long-running
  `stdio` MCP sessions keep a minimal memory footprint without leaks, with
  automatic recovery from a wedged worker.
- **Live hot-reloadable configuration**:
  File-watcher integration that applies configuration and profile changes
  instantly without restarting the MCP server process, using atomic swaps that
  never apply a partial file.
- **WSL2 native setup**:
  Official WSL2 setup scripts for Windows developers running Linux containers,
  complementing the existing `Dockerfile`.

### v2.3.0 — Ecosystem & harnesses

- **JetBrains IDE suite support**:
  Interactive setup support for IntelliJ IDEA, PyCharm, WebStorm, GoLand, and
  CLion via the shared JetBrains AI Assistant MCP configuration and managed
  steering prompt rules (`.aiassistant/rules/`), matching the existing Claude
  Code, Codex, Antigravity, Cursor, VS Code, and Neovim flows.

---

## v2.4.0 — Extensibility & automation (implemented)

V2.4 ships the remaining extensibility pillar. The security boundary is
unchanged: the server remains read-only against the developer's repository, and
every write proposal stays an unapplied, validated diff. Task tracking:
docs/tasks 047–048.

- **Custom post-processing hooks**:
  User-defined local scripts executed immediately after patch generation for
  custom formatting, security-policy checks, or lint validation before a
  proposal is returned to the client. Hooks run only with explicit developer
  configuration and never alter the repository (temp-dir isolation, fail
  closed, transforms re-validated).
- **Workspace profiles & multi-preset switching**:
  Extend the global `fast`/`thorough`/`balanced` presets to project and
  workspace scope, switchable at runtime via `update_config`, so a repository
  can move between development, security-audit, refactoring, and documentation
  modes without a server restart (project > global > preset resolution,
  explicit limits beat presets).

### V2.4 non-scope

- Cloud provider inference APIs (OpenAI, Anthropic, Google).
- Direct repository writes by the MCP server outside temporary auto-validate
  sandboxes.
- Public network exposure or multi-user remote hosting.
- A graphical desktop interface or web application.

---

## Version 3.0 — Candidate direction (not committed)

Direction is under discussion and nothing here is planned for an upcoming
release:

- Team administration and multi-account isolation for shared LM Studio or vLLM
  infrastructure.
- Broader language coverage for the code graph and context distillation.
- Deeper harness-specific rendering (e.g., IDE inline diff previews) through
  the MCP SDK's evolving capabilities.

---

## Non-scope (all versions)

- Cloud provider inference APIs (OpenAI, Anthropic, Google)
- Direct repository writes by the MCP server outside temporary auto-validate sandboxes
- Graphical desktop interface or web applications
- Multi-user remote hosting or public network exposure
