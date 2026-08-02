<Task 018: Semantic search MCP tool>
**Status:** Not started
**Depends on:** Tasks 013, 016, 017
**PRD coverage:** New capability CAP-07

## Objective

Compose the embedding adapter and vector index into a new `search_semantic` MCP tool that accepts a natural language query, computes its embedding, searches the local vector index, and returns ranked file excerpts with similarity scores.

## Requirements

- Register `search_semantic` as a new MCP tool in the stdio server.
- Input schema: `{ query: string, repository_root: string, top_k?: number (default 10, max 50), reindex?: boolean (default false) }`.
- When `reindex` is true or when the index is empty for the given root, trigger a full reindexing pass: read accepted files via repository access, chunk content, generate embeddings via `embedText`, and store in the vector index.
- Reindexing must respect all existing content filtering rules (skip sensitive, binary, ignored, excluded files).
- Chunk strategy: split files by logical boundaries (function/class for supported languages via AST when available, or fixed-size ~512 token chunks as fallback).
- Generate the query embedding using the same embedding model.
- Return results as `{ results: Array<{ path, score, excerpt, line_start, line_end }> }` sorted by descending similarity.
- Each result excerpt is bounded to 50 lines maximum.
- Staleness check: before searching, verify a sample of top entries for content changes and warn if >20% are stale.
- Reindexing runs within the task lifecycle with the same timeout and cancellation semantics.
- The embedding model is determined by a new optional configuration field `embedding_model` (falls back to `default_model` if unset).

## Non-scope

Real-time file watching, incremental reindexing on file save, cross-repository search, web-based UI.

## Implementation outline

1. Add `embedding_model` optional field to configuration schema.
2. Implement chunking strategy in `src/features/semantic-search/chunking.ts`.
3. Implement reindexing orchestrator that reads files, chunks, embeds, and indexes.
4. Implement `search_semantic` tool handler composing query embedding + vector search + excerpt extraction.
5. Register tool in MCP server with input/output JSON schemas.
6. Add progress reporting during reindexing.

## Expected areas

- `src/features/semantic-search/chunking.ts` — Text/AST chunking
- `src/features/semantic-search/reindex.ts` — Reindexing orchestrator
- `src/features/semantic-search/search.ts` — Search use case
- `src/features/mcp-server/server.ts` — Tool registration
- `test/semantic-search.test.ts` — Integration tests

## Tests

- Searching an indexed repository returns relevant files for a natural language query.
- `reindex: true` rebuilds the index from scratch.
- Empty index triggers automatic reindexing before search.
- Sensitive and binary files are excluded from indexing.
- Results respect `top_k` limit.
- Stale file detection warns when >20% of results have changed.
- Cancellation during reindexing aborts cleanly.
- Timeout during embedding generation is handled gracefully.
- Search with no matches returns empty results array.
- `embedding_model` configuration is respected; fallback to `default_model` works.

## Risks

- Full reindexing of large repositories may be slow; document expected time and provide progress events.
- Embedding model context window limits may truncate large chunks.

## Acceptance criteria

- `search_semantic` returns ranked file excerpts with similarity scores for natural language queries.
- Reindexing respects all content filtering rules.
- The tool is protocol-clean and follows the existing MCP tool conventions.
- Existing 6 tools continue working without regression.
- `npm run validate` passes.
