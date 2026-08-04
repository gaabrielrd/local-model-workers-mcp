# Task 035: Multi-Repository Cross-Referencing

**Status:** Completed  
**Depends on:** Tasks 018, 019, 034 (completed)

## Objective

Enable `query_code_graph` and `search_semantic` to query across multiple local
workspace repositories simultaneously via the `additional_repositories` parameter.

## Key Design Decisions

- **Schema Extension**: Added optional `additional_repositories` array parameter (max 10 items) to `SemanticSearchInputSchema` and `CodeGraphQueryInputSchema`.
- **MultiRepoCodeGraph**: Created `MultiRepoCodeGraph` in `src/features/code-graph/multi-repo-graph.ts` to manage per-repository `InMemoryCodeGraph` instances and merge symbol & edge query results across repositories.
- **MultiRepoVectorIndex**: Created `MultiRepoVectorIndex` in `src/features/semantic-search/multi-repo-index.ts` to aggregate vector search results across primary and additional repository vector indices, prefixing paths with their repository root when multi-repository search is active.

## Acceptance Criteria

- [x] `SemanticSearchInputSchema` accepts `additional_repositories`.
- [x] `CodeGraphQueryInputSchema` accepts `additional_repositories`.
- [x] `MultiRepoCodeGraph` aggregates symbols and edges across primary and additional roots.
- [x] `MultiRepoVectorIndex` executes parallel vector searches and ranks aggregated matches.
- [x] All 351 tests pass (3 new multi-repo cross-reference unit tests + full suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/code-graph/contracts.ts` (MODIFIED — add `additional_repositories` to `CodeGraphQueryInputSchema`)
- `src/features/code-graph/multi-repo-graph.ts` (NEW — `MultiRepoCodeGraph` class)
- `src/features/code-graph/index.ts` (MODIFIED — export `MultiRepoCodeGraph`)
- `src/features/semantic-search/contracts.ts` (MODIFIED — add `additional_repositories` to `SemanticSearchInputSchema`)
- `src/features/semantic-search/multi-repo-index.ts` (NEW — `MultiRepoVectorIndex` class)
- `src/features/semantic-search/index.ts` (MODIFIED — export `MultiRepoVectorIndex`)
- `test/multi-repo-cross-ref.test.ts` (NEW — 3 unit tests)
