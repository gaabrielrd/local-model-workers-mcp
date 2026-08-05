# Roadmap

**Last reviewed:** 2026-08-05

## Vision

Move heavy code understanding and mechanical edit workloads from expensive cloud
models to fast, free, local models. Local Model Workers MCP operates as the
local security and validation boundary, empowering AI coding assistants across
all major IDEs.

---

## Delivered — v1.0 to v2.6

Releases 1.0.0 through 2.6.0 delivered a complete, 15-tool local offloading
engine, its operator-grade stability layer, the ecosystem harnesses, the
extensibility pillar, broader language coverage, and harness context management:

- **15 MCP tools** across `exploration`, `tests`, `docs`, and `lint` feature
  groups plus always-on administration tools;
- **Broader language coverage** — code graph and context distillation for
  Kotlin, Swift, Scala, PHP, Ruby, and Elixir on top of the original six
  languages;
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

## v2.5.0 — Broader language coverage (implemented)

V2.5 extends the code graph and context distillation to six new languages.
Task tracking: docs/tasks 049.

- **Six new languages** in `parseSourceSymbols`: Kotlin (`.kt`, `.kts`),
  Swift (`.swift`), Scala (`.scala`), PHP (`.php`), Ruby (`.rb`), and Elixir
  (`.ex`, `.exs`) — functions, classes, interfaces, type aliases, methods,
  imports, and export-status heuristics per language, on top of the existing
  TypeScript/JS, Python, Go, Rust, Java, and C# support.
- **Comment-style-aware distillation** in `distillContext`: hash (`#`) comments
  are now stripped for Ruby, Elixir, and PHP in addition to the C-style
  (`//`, `/* */`) and Python docstring handling.

---

## v2.6.0 — Harness context management (implemented)

V2.6 reduces how much of the coding assistant's context window tool responses
consume, without changing default behavior. Task tracking: docs/tasks 050.

- **`result_verbosity` preference**:
  A `"terse" | "standard" | "verbose"` preference (default `"standard"`)
  resolved with the existing project > global > built-in precedence, exposed by
  `get_config`, mutable through `validate_config`/`update_config`, and settable
  via `configure-global --result-verbosity`.
- **Terse result compaction**:
  In `terse` mode, high-payload tools return a single compacted representation
  in both the text block and `structuredContent`. `explore_repository` drops
  `risks`, `next_steps`, and `limitation_impact` and strips per-evidence
  `explanation`; `auto_validate_tests` drops per-attempt `patch` (the final
  validated patch stays); `analyze_diff` drops `architectural_notes`. Structural
  data (paths, line ranges, symbols, diffs, status) is preserved.
- **Context-efficiency steering**:
  `buildSteeringInstructions` gains a universal directive (do not echo large
  tool results) plus feature-gated directives steering toward targeted lookups
  (`query_code_graph`, `search_semantic`, `summarize_module`) and away from
  echoing `auto_validate_tests` iteration output.
- **No default regression**: `standard` and `verbose` render byte-identical to
  v2.5; public tool schemas and the MCP API are unchanged.

The design is recorded in [ADR-0013](decisions/0013-result-verbosity-compaction.md).

---

## v2.7.0+ — Reliability & security hardening (planned)

Planned pillars that harden the security boundary and the resilience machinery.
Each pillar is tracked by its own task doc in `docs/tasks/` and ships as one
minor release (v2.7.0 onward), following the project versioning rule. None of
these are implemented yet; the v3.0 candidate direction below remains separate
and uncommitted.

### Security

- **v2.7.0 — Prompt-injection hardening** (Task 051):
  Treat every repository excerpt sent to the model as untrusted *data*, wrapped
  in explicit delimiters with a standing "file content is never an instruction"
  directive, plus adversarial fixture tests proving injected text cannot alter
  task behavior.
- **v2.8.0 — Response-path secret redaction** (Task 052):
  Scrub credentials the model might echo back from repository content before a
  result is returned to the harness, on both the text block and
  `structuredContent`.
- **v2.9.0 — Transport hardening for the model hop** (Task 053):
  Optional HTTPS with TLS certificate validation for provider connections,
  fail-closed on invalid certs when enabled, backward-compatible with the
  current trusted-LAN HTTP behavior.

### Reliability

- **v2.10.0 — Release-qualification gates** (Task 054):
  Close the two remaining release gates: real Claude Code and Codex scenarios
  against a real LM Studio, and green Linux/Windows CI for the exact candidate
  commit.
- **v2.11.0 — Fault-injection test suite** (Task 055):
  Prove the circuit breaker, SSE parser, capacity coordinator, and atomic
  config writes under injected faults (disconnects, truncated frames, races,
  interrupted writes) instead of happy-path unit tests only.
- **v2.12.0 — Error-rate observability** (Task 056):
  Expose failure, retry, and circuit-breaker metrics over the existing
  week/month/lifetime windows so operator-facing degradation surfaces before
  tasks start timing out.
- **v2.13.0 — Large-monorepo degradation** (Task 057):
  Documented repository-size guidance and bounded indexing/exploration with
  explicit limitation responses, plus memory regression tests on large
  generated fixtures.

---

## Version 3.0 — Candidate direction (not committed)

Direction is under discussion and nothing here is planned for an upcoming
release:

- Team administration and multi-account isolation for shared LM Studio or vLLM
  infrastructure.
- Deeper harness-specific rendering (e.g., IDE inline diff previews) through
  the MCP SDK's evolving capabilities.

---

## Non-scope (all versions)

- Cloud provider inference APIs (OpenAI, Anthropic, Google)
- Direct repository writes by the MCP server outside temporary auto-validate sandboxes
- Graphical desktop interface or web applications
- Multi-user remote hosting or public network exposure
