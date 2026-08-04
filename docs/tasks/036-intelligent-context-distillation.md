# Task 036: Intelligent Context Distillation & Prompt Compression

**Status:** Completed  
**Depends on:** Tasks 019, 028 (completed)

## Objective

Automatically prune redundant AST nodes, dead code comments, block comments,
docstrings, and repeated whitespace/newlines before sending code context to local
LLMs, reducing prompt token count by up to 40% and accelerating local inference.

## Key Design Decisions

- **Multi-language comment stripping**: `distillContext` in `src/features/code-graph/context-distiller.ts` handles block comments (`/* ... */`), line comments (`// ...`), Python docstrings (`""" ... """`, `''' ... '''`), and Python `#` comments.
- **Empty line collapsing**: Collapses 3+ consecutive newlines down to a max of 2 (`\n\n`) to preserve code readability while removing blank line bloat.
- **Compression metrics**: Calculates `originalLength`, `distilledLength`, and `compressionRatio` for token budgeting.

## Acceptance Criteria

- [x] `distillContext` strips comments and docstrings across TypeScript and Python code.
- [x] Excessive newlines are collapsed cleanly.
- [x] Compression ratio metrics are reported accurately.
- [x] All 355 tests pass (4 new context distillation unit tests + full suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/code-graph/context-distiller.ts` (NEW — `distillContext` implementation)
- `src/features/code-graph/index.ts` (MODIFIED — export `distillContext` and types)
- `test/context-distiller.test.ts` (NEW — 4 unit tests)
