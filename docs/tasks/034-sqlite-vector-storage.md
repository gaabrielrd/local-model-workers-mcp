# Task 034: SQLite Embedded Vector Storage

**Status:** Completed  
**Depends on:** Tasks 017, 027 (completed)

## Objective

Replace the default `InMemoryVectorIndex` with a persistent `SqliteVectorIndex`
backed by Node.js built-in `node:sqlite` (Node 24+), enabling zero cold-start
latency and scalable vector retrieval for 100k+ file codebases.

## Key Design Decisions

- **Zero new dependencies**: Uses `node:sqlite` built-in module (Node 24+)
  instead of `better-sqlite3` or `sql.js`, aligning with project rule
  "Prefer platform APIs and existing dependencies."
- **`Float64Array` BLOB storage**: Embeddings are stored as `Float64Array`
  buffers for full precision.
- **Cosine similarity computed in JavaScript**: No `sqlite-vec` extension
  needed; uses the same algorithm as `InMemoryVectorIndex`.
- **Migration from JSON format**: `SqliteVectorIndex.migrateFromJson()` reads
  the `InMemoryVectorIndex` JSON persistence format and imports entries.
- **Backward compatible**: `InMemoryVectorIndex` remains available for tests
  and lightweight use cases. Both implement the `VectorIndex` interface.

## Acceptance Criteria

- [x] `SqliteVectorIndex` implements the full `VectorIndex` interface.
- [x] SQLite database persists between process restarts.
- [x] Eviction policy removes oldest entries when `maxEntries` exceeded.
- [x] Migration from JSON persistence format succeeds.
- [x] Corrupt JSON migration files do not crash.
- [x] In-memory mode works without persistence path.
- [x] `server.ts` uses `SqliteVectorIndex` with persistent path.
- [x] All 336 tests pass (14 new SQLite tests + existing suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/semantic-search/sqlite-vector-index.ts` (NEW)
- `src/features/semantic-search/index.ts` (MODIFIED — export SqliteVectorIndex)
- `src/features/mcp-server/server.ts` (MODIFIED — use SqliteVectorIndex)
- `test/sqlite-vector-index.test.ts` (NEW — 14 tests)
