<Task 027: Reactive incremental indexing for search_semantic>
**Status:** In Progress
**Depends on:** Tasks 017, 018
**PRD coverage:** Extended CAP-07

## Objective

Evolve `reindexRepository` and the vector index integration to perform reactive incremental indexing. Instead of discarding all existing embeddings on every reindex request, the engine checks content hashes against the repository state, re-embeds only new or modified files, removes deleted files, and preserves valid cached embeddings.

## Requirements

- Update `reindexRepository` to support incremental synchronization.
- **Unmodified file skip**: For each repository file, compute its content hash. If the vector index already contains entries for that file matching the exact hash, skip embedding generation.
- **Stale file update**: If a file's content hash has changed, remove its existing embeddings from the index and generate new chunk embeddings.
- **Deleted file pruning**: Remove index entries for files that no longer exist in the repository listing.
- **Incremental force reindex**: Setting `reindex: true` runs an incremental synchronization sweep across all repository files rather than clearing non-stale embeddings.
- Save the updated index state to disk via `vectorIndex.save()`.
- Progress reporting must indicate how many files were skipped vs. re-embedded.

## Non-scope

- File system OS daemon / `chokidar` background watcher process outside MCP tool invocations.

## Implementation outline

1. Modify `reindexRepository` in `src/features/semantic-search/search.ts` to perform hash-based diffing against `vectorIndex`.
2. Add `getKnownPaths()` or entry inspection methods to `VectorIndex` contract if needed.
3. Update tests in `test/semantic-search.test.ts` to verify incremental sync behavior (unmodified skipped, modified updated, deleted pruned).

## Expected areas

- `src/features/semantic-search/contracts.ts` — Vector index contract updates if needed
- `src/features/semantic-search/vector-index.ts` — `InMemoryVectorIndex` helpers
- `src/features/semantic-search/search.ts` — `reindexRepository` incremental logic
- `test/semantic-search.test.ts` — Unit & integration tests

## Acceptance criteria

- Unmodified files are skipped during reindexing without calling the inference adapter.
- Modified files have old embeddings replaced with newly generated chunk embeddings.
- Deleted files are pruned from the vector index.
- `npm run validate` passes with all 314+ tests green.
