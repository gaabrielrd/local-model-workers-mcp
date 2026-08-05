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

## v2.7.0 — Prompt-injection hardening (implemented)

V2.7 changes how accepted repository content is presented to the model, without
changing which content may leave the machine. Task tracking: docs/tasks 051.

- **Nonce-delimited untrusted-data blocks**:
  Every inference request carrying repository text is composed by
  `composeUntrustedPrompt`. The trusted task envelope (goal, constraints,
  requested language) stays outside a fenced block that holds only
  repository-derived payload. Delimiters carry 16 random bytes generated per
  request, so scanned content cannot forge a terminator and escape the fence.
- **One standing directive**: `composeSystemProtocol` appends the
  untrusted-data directive to every feature protocol, replacing six copy-pasted
  sentences and covering `analyze_diff`, which previously had none.
- **Adversarial fixtures**: a hostile-content suite (ignore-previous-instructions,
  fake system roles, fake tool calls, smuggled schemas, forged terminators,
  exfiltration prompts) asserts golden task results are unchanged.

See [ADR-0014](decisions/0014-nonce-delimited-untrusted-data.md).

## v2.8.0 — Response-path secret redaction (implemented)

V2.8 guarantees that credentials never reach the harness transcript, whichever
channel a result travels on. Task tracking: docs/tasks 052.

- **One scrubber at the MCP boundary**: `redactSecrets` runs in `callTool` on
  the final payload before it is split into `content[0].text` and
  `structuredContent`, so both channels and tool error messages are covered by
  construction.
- **Two layers**: exact match on credentials this process holds (the Bearer
  token and every configured provider token), plus shape matching on
  issuer-prefixed credentials, PEM private-key blocks, `Authorization` headers,
  and secret-named assignments.
- **No entropy heuristics**: git SHAs, `sha256:` content hashes, and
  fingerprints are legitimate output and are never redacted.
- **Redact, never drop**: values become a stable `[REDACTED]` placeholder, so
  result shape and parsability are unchanged.

## v2.9.0 — Transport hardening for the model hop (implemented)

V2.9 adds an opt-in verified transport for provider connections without
changing the default trusted-LAN posture. Task tracking: docs/tasks 053.

- **Protected `tls_verify` per provider**: set on `LMW_PROVIDERS` in the process
  environment, so editable preferences and repository content cannot weaken it.
- **Fails closed when enabled**: plain HTTP to a non-loopback host and
  `NODE_TLS_REJECT_UNAUTHORIZED=0` are both refused at adapter construction, so
  the failure surfaces at startup rather than mid-task.
- **Certificate failures are no longer retried**: adapters previously discarded
  the transport error and raised a retryable `endpoint_unreachable`; a rejected
  certificate now maps to a non-retryable `invalid_configuration`.
- **Backward compatible**: with the flag absent, HTTP on a trusted LAN behaves
  exactly as before.

## v2.10.0 — Release-qualification gates (tooling implemented)

V2.10 makes release-gate status mechanically checkable instead of a claim in a
document. Task tracking: docs/tasks 054.

- **`npm run release:gates`**: reports every gate as `met`, `unmet`, or
  `unverifiable` and exits non-zero unless all are met. "Unverifiable" is a
  distinct outcome so a missing artifact never reads as a pass.
- **`npm run release:scenarios`**: drives the official fixtures through real
  Claude Code and Codex in isolated profiles against a live provider, verifying
  prerequisites first and refusing to fabricate a run.
- **CI `gates` job**: reports status per commit before `release`. It is
  report-only, so existing publish behavior is unchanged.

The external gates themselves (CA-47..CA-52) still require an operator: a real
harness session and a confirmed three-OS matrix cannot be proven locally.

## v2.11.0 — Fault-injection test suite (implemented)

V2.11 proves the resilience machinery under injected faults rather than only on
the happy path. Task tracking: docs/tasks 055.

- **Fault responder**: an in-test HTTP server that dies mid-body, truncates SSE,
  returns HTML error pages, answers slowly, or returns empty bodies on demand.
- **Three fault classes covered**: transport, stream, and capacity state.
- **Contract-level assertions**: every fault yields a typed `InferenceError`,
  and the shared capacity state always ends with zero active and zero queued
  entries however the task settled.

## v2.12.0 — Error-rate observability (implemented)

V2.12 gives an operator a degradation signal before users see timeouts. Task
tracking: docs/tasks 056.

- **Additive `reliability` section on `get_offload_stats`**:
  failure/retry/cancellation counters over the same week, month, and lifetime
  windows, split by error code and by provider, plus a per-provider live
  circuit-breaker state (`closed`/`open`/`half-open`) from the real breaker.
- **Durable daily rollup**: events are rolled up into an owner-only
  `rollup.json`, so month/lifetime windows survive the seven-day raw-event
  pruning; pre-rollup logs fall back to raw events.
- **Provider attribution at the router boundary**: the router names the serving
  provider and retry count (adapter retries + provider failovers) on results
  and the failing provider on total failure; terminal metadata carries both into
  the operational log.
- **No content change**: counters, codes, and names only; the redaction and
  content-filtering boundaries are unchanged. Existing stats fields and the MCP
  API are byte-compatible.

The design is recorded in [ADR-0015](decisions/0015-error-rate-observability.md).

## v2.13.0 — Large-monorepo degradation (implemented)

V2.13 makes very large repositories degrade predictably instead of consuming
unbounded memory or time. Task tracking: docs/tasks 057.

- **Documented ceiling**: `index_max_files` (25,000) and `index_max_bytes`
  (512 MiB) join the existing fixed limits. Policy, not security.
- **Bounded work with an explicit report**: `reindexRepository` stops at the
  ceiling and returns what it covered and what it left out.
- **Callers can tell "not indexed" from "no match"**: `search_semantic` attaches
  an `index_limitation` when coverage was truncated.
- **No change under the ceiling**: in-scope repositories behave exactly as
  before.

Documented repository-size guidance and bounded indexing/exploration with
explicit limitation responses, plus memory regression tests on large generated
fixtures. Task tracking: docs/tasks 057.

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
