<Task 017: Local vector index>
**Status:** Completed
**Depends on:** Tasks 005, 006, 016
**PRD coverage:** New capability CAP-07 prerequisite

## Objective

Implement a local vector index that stores file-level embeddings for a repository, supports nearest-neighbor similarity search, and automatically invalidates stale entries when file contents change.

## Requirements

- Define `VectorIndex` interface with methods: `indexFile(path, content, embedding)`, `search(queryEmbedding, topK)`, `removeFile(path)`, `isStale(path, contentHash)`, `clear()`, `size()`.
- Store each entry as: `{ relativePath, contentHash (SHA-256), embedding (Float32Array), chunkOffset?, chunkLength? }`.
- Implement cosine similarity for nearest-neighbor search.
- Return results sorted by descending similarity score with `{ path, score, chunkOffset?, chunkLength? }` shape.
- Detect stale entries by comparing stored `contentHash` against current file SHA-256.
- Support chunking: a single file may produce multiple index entries (one per chunk), each with distinct `chunkOffset` and `chunkLength`.
- Persist the index to a single file in the platform-appropriate application data directory (alongside operational logs).
- Load persisted index on startup; rebuild automatically if the persistence file is corrupt or missing.
- Bound the index: maximum 50,000 entries (configurable). Evict oldest entries (LRU by last-indexed timestamp) when limit is reached.
- Thread-safe for concurrent read access (single-writer, multiple-reader).

## Non-scope

Automatic file watching, real-time reindexing triggers, embedding generation (handled by Task 016), MCP tool exposure, HNSW or ANN algorithms (brute-force cosine is sufficient for v1.1 scale).

## Implementation outline

1. Define `VectorIndex` and `VectorEntry` interfaces in `src/features/semantic-search/contracts.ts`.
2. Implement in-memory `InMemoryVectorIndex` with cosine similarity.
3. Add persistence layer: serialize to/from a binary file (entries + metadata header).
4. Add content-hash staleness check.
5. Add LRU eviction when entry count exceeds maximum.
6. Export public API from `src/features/semantic-search/index.ts`.

## Expected areas

- `src/features/semantic-search/contracts.ts` — Interface and types
- `src/features/semantic-search/vector-index.ts` — Implementation
- `src/features/semantic-search/index.ts` — Public exports
- `test/vector-index.test.ts` — Unit tests

## Tests

- Indexing 3 files and searching returns results sorted by descending cosine similarity.
- Searching with topK=2 returns exactly 2 results.
- `isStale` returns true when content hash differs from stored hash.
- `removeFile` removes all chunks for a given path.
- `clear()` empties the index; `size()` returns 0.
- Eviction kicks in at the configured maximum and removes LRU entries.
- Persistence: index survives a save/load cycle with identical search results.
- Corrupt persistence file triggers automatic rebuild (empty index, no crash).
- Cosine similarity of identical vectors returns 1.0; orthogonal vectors return 0.0.
- Chunked file with 3 chunks returns up to 3 separate search results with correct offsets.

## Risks

- Brute-force cosine search may be slow for very large repositories (>30,000 files); document the performance envelope.
- Binary serialization format must be versioned for forward compatibility.

## Acceptance criteria

- Cosine similarity search returns correct nearest neighbors for known test vectors.
- Stale entries are correctly detected and can be removed/reindexed.
- Persistence round-trip preserves all entries and metadata.
- Feature boundary: no imports from other features except `shared`.
- `npm run validate` passes.
