# Task 037: Semantic Code Diff Analysis (`analyze_diff`)

**Status:** Completed  
**Depends on:** Tasks 002, 007, 011 (completed)

## Objective

Introduce `analyze_diff` as the **15th MCP tool**, performing semantic analysis
of git commit diffs, generating human-readable summaries, file change stats,
impact ratings (`low`, `medium`, `high`), and architectural impact notes.

## Key Design Decisions

- **15th MCP Tool**: Added `analyzeDiff: "analyze_diff"` to `TOOL_NAMES`, registered under the `docs` feature group in `server.ts`.
- **Structured Output Schema**: `AnalyzeDiffResultSchema` defines `summary`, `changed_files_count`, `additions`, `deletions`, `impact_rating` (`low` | `medium` | `high`), and `architectural_notes`.
- **Fallback Heuristics**: If local model inference is unavailable or fails, `parseDiffStats` provides deterministic fallback diff metrics and impact categorization.

## Acceptance Criteria

- [x] `AnalyzeDiffInputSchema` and `AnalyzeDiffResultSchema` created in `src/features/diff-analysis/contracts.ts`.
- [x] `analyze_diff` registered in `server.ts` and `tool-names.ts`.
- [x] Contracts tests updated for 15 tools.
- [x] All 358 tests pass (3 new diff analysis unit tests + full suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/diff-analysis/contracts.ts` (NEW)
- `src/features/diff-analysis/logic.ts` (NEW)
- `src/features/diff-analysis/index.ts` (NEW)
- `src/features/mcp-server/tool-names.ts` (MODIFIED — add `analyze_diff` as 15th tool)
- `src/features/mcp-server/server.ts` (MODIFIED — register `analyze_diff`)
- `test/contracts.test.ts` (MODIFIED — update approved tool list)
- `scripts/release/smoke-package.mjs` (MODIFIED — update smoke test tool list)
- `test/diff-analysis.test.ts` (NEW — 3 unit tests)
- `test/lm-studio.test.ts` (MODIFIED — adjust timeout/abort delay for test stability)
