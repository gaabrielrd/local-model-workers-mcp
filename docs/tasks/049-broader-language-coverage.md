# Task 049: Broader Language Coverage

**Status:** Implemented (v2.5.0)
**Depends on:** Task 040 (completed)

## Objective

Extend `parseSourceSymbols` (code graph) and `distillContext` (context
distillation) to six new programming languages so `query_code_graph`,
`summarize_module`, and exploration context stay useful for more ecosystems.

## Key Design Decisions

- **Six new languages:** Kotlin (`.kt`, `.kts`), Swift (`.swift`), Scala
  (`.scala`), PHP (`.php`), Ruby (`.rb`), and Elixir (`.ex`, `.exs`), on top of
  the existing TypeScript/JS, Python, Go, Rust, Java, and C# support.
- **Same symbol kinds:** new languages emit the existing `CodeSymbol` kinds
  (`function`, `class`, `interface`, `type_alias`, `method`, `import`) and map
  onto the current enum; no new kind values were added.
- **Regex-based line parsing:** each new language follows the existing
  per-language parse function patterns; unsupported extensions still return
  `[]` without crashing.
- **Comment-style classification in the distiller:** the binary
  python/else branch becomes a comment-style classifier per language — C-style
  (`//`, `/* */`) for Kotlin/Swift/Scala/PHP, hash (`#`) for Ruby/Elixir/PHP,
  and the existing docstring-aware Python handling. Hash comments were the real
  gap: Ruby and Elixir were not stripped before.
- **Export status heuristics:** Swift and Scala use a leading `public`/`open`
  keyword; Kotlin uses `public`; Ruby and Elixir use a leading `_` for
  non-exported and no underscore for exported, following the Python pattern.
- **Block-ending estimation:** Ruby and Elixir reuse the Python
  `estimatePythonEndLine` indentation approach for `end`-based bodies.

## Acceptance Criteria

- [x] All six languages parse realistic fixtures into the correct kinds and
      export status.
- [x] The distiller strips `#` comments for Ruby, Elixir, and PHP; C-style
      stripping is unchanged.
- [x] Unsupported extensions still return `[]`.
- [x] Public API unchanged (`index.ts` re-exports only).
- [x] `npm run validate` green.

## Files Changed

- `src/features/code-graph/parser.ts` (MODIFIED — six new `parse*Line`
  functions and extension detection)
- `src/features/code-graph/context-distiller.ts` (MODIFIED — comment-style
  classifier: hash-comment support for Ruby/Elixir/PHP)
- `src/features/code-graph/index.ts` (unchanged — public API stable)
- `test/code-graph.test.ts` (MODIFIED — Kotlin/Swift/Scala/PHP/Ruby/Elixir
  fixtures and assertions)
- `test/context-distiller.test.ts` (MODIFIED — Ruby/Elixir/PHP comment
  stripping)
- `docs/tasks/049-broader-language-coverage.md` (NEW — this document)
- `docs/tasks/README.md`, `docs/roadmap.md`, `docs/architecture.md`,
  `docs/mcp-tools.md`, `AGENTS.md` (MODIFIED — coverage list and v2.5.0
  release notes)
