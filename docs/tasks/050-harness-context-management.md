# Task 050: Harness Context Management

**Status:** Implemented (v2.6.0)
**Depends on:** Task 049 (completed)

## Objective

Reduce how much of the coding assistant's (harness) context window tool
responses consume, while keeping default behavior unchanged. The server cannot
read or rewrite the harness transcript (no context introspection channel in the
MCP SDK), so the levers are the size of tool responses and the steering rules
that shape harness usage.

## Key Design Decisions

- **`result_verbosity` preference** (`"terse" | "standard" | "verbose"`,
  default `"standard"`), settable in project or global preferences and resolved
  with the existing project > global > built-in precedence. It flows through
  `getConfig`, `validateConfig`, `updateConfig`, and the `configure-global`
  CLI flag `--result-verbosity`.
- **Compaction only in `terse` mode.** `standard` and `verbose` render exactly
  as before (full JSON in `content` and `structuredContent`), so there is no
  client regression by default. In `terse` mode the payload itself is trimmed —
  both the text block and `structuredContent` carry the same compacted object,
  guaranteeing a single representation and a real context reduction.
- **Conservative field-level rules** (not recursive heuristics) in a new
  `result-compaction.ts` under the mcp-server feature. Only clearly verbose,
  human-oriented fields are pruned; structural data (paths, line ranges,
  symbols, diffs, status) is preserved:
  - `explore_repository`: drop `risks`, `next_steps`, `limitation_impact`; strip
    `explanation` from each `evidence` entry (paths and line ranges stay).
  - `auto_validate_tests`: drop `patch` from each `attempts` entry (the final
    validated `patch` stays).
  - `analyze_diff`: drop `architectural_notes` (summary and stats stay).
  - `summarize_module`, patches, and config/health/stats tools: unchanged.
- **Context-efficiency steering directives** installed by
  `buildSteeringInstructions`: one universal directive (do not echo large tool
  results into the conversation) plus feature-gated directives that push the
  harness toward targeted lookups (`query_code_graph`, `search_semantic`,
  `summarize_module`) and away from echoing `auto_validate_tests` iteration
  output.

## Acceptance Criteria

- [x] `result_verbosity` resolves with correct precedence and origin; mutation
      via `validateConfig`/`updateConfig` and the `configure-global` CLI flag.
- [x] `terse` compacts the high-payload tools; `standard`/`verbose` are
      byte-identical to previous behavior.
- [x] Steering instructions include the new context-efficiency directives.
- [x] Default behavior unchanged; public tool schemas and API unchanged.
- [x] `npm run validate` green.

## Files Changed

- `src/features/configuration/configuration.ts` (MODIFIED — `result_verbosity`
  schema, resolution, origins, revision, `EffectiveConfiguration`)
- `src/features/configuration/index.ts` (MODIFIED — exports)
- `src/features/configuration/mutation.ts` (MODIFIED — mutable field wiring)
- `src/features/installation/cli.ts` (MODIFIED — `--result-verbosity` flag and
  awaited command dispatch so rejected configuration throws map to exit 65)
- `src/features/installation/global-preferences.ts` (MODIFIED — `result_verbosity`
  carried through `mergePreferences`)
- `src/features/installation/steering.ts` (MODIFIED — context-efficiency
  directives)
- `src/features/mcp-server/result-compaction.ts` (NEW — terse compaction and
  verbosity-aware rendering)
- `src/features/mcp-server/server.ts` (MODIFIED — verbosity-aware rendering in
  `safeToolCall`)
- `test/result-compaction.test.ts` (NEW — compaction and rendering tests)
- `test/harness-steering.test.ts`, `test/configuration.test.ts`,
  `test/configuration-mutation.test.ts` (MODIFIED — verbosity coverage)
- Fixture origin maps in `test/exploration.test.ts`, `test/health.test.ts`,
  `test/test-proposal.test.ts`, `test/auto-validate.test.ts`,
  `test/task-lifecycle.test.ts`, `test/operational-logging.test.ts`
  (MODIFIED — new `result_verbosity` origin field)
- `docs/tasks/050-harness-context-management.md` (NEW — this document)
- `docs/tasks/README.md`, `docs/roadmap.md`, `docs/architecture.md`,
  `docs/configuration.md`, `docs/mcp-tools.md`, `AGENTS.md` (MODIFIED — v2.6.0
  release notes)
