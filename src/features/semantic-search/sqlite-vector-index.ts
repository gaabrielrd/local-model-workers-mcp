import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type {
  VectorChunk,
  VectorIndex,
  VectorIndexOptions,
  VectorSearchResult,
} from "./contracts.js";

const DEFAULT_MAX_ENTRIES = 50_000;

function cosineSimilarity(
  a: readonly number[] | Float32Array | Float64Array,
  b: readonly number[] | Float32Array | Float64Array,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const PersistedEntrySchema = z
  .object({
    relativePath: z.string().min(1),
    contentHash: z.string().min(1),
    embedding: z.array(z.number()),
    indexedAtMs: z.number().int().nonnegative(),
    chunkOffset: z.number().int().nonnegative().optional(),
    chunkLength: z.number().int().nonnegative().optional(),
  })
  .strict();

const PersistedFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(PersistedEntrySchema),
  })
  .strict();

/**
 * SQLite-backed implementation of the VectorIndex interface.
 */
export class SqliteVectorIndex implements VectorIndex {
  private readonly db: DatabaseSync;
  private readonly maxEntries: number;
  private readonly dbPath: string;
  private closed = false;

  /**
   * Creates a new SqliteVectorIndex.
   * @param options Configuration options.
   */
  constructor(options: VectorIndexOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.dbPath = options.persistencePath ?? ":memory:";

    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    // Use DELETE journal mode to avoid WAL sidecar files (.db-wal, .db-shm)
    // that remain locked on Windows even after db.close(), which causes
    // afterEach cleanup (rm) to hang indefinitely in CI.
    this.db.exec("PRAGMA journal_mode=DELETE");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relative_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB NOT NULL,
        chunk_offset INTEGER,
        chunk_length INTEGER,
        indexed_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_path ON vectors(relative_path);
      CREATE INDEX IF NOT EXISTS idx_vectors_indexed_at ON vectors(indexed_at_ms);
    `);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  private evictIfOverCapacity(): void {
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM vectors");
    const countRow = countStmt.get() as { count: number };
    if (countRow.count > this.maxEntries) {
      const toDelete = countRow.count - this.maxEntries;
      const deleteStmt = this.db.prepare(`
        DELETE FROM vectors 
        WHERE id IN (
          SELECT id FROM vectors ORDER BY indexed_at_ms ASC LIMIT ?
        )
      `);
      deleteStmt.run(toDelete);
    }
  }

  /**
   * Index a file's content embedding.
   */
  indexFile(
    relativePath: string,
    contentHash: string,
    embedding: Float32Array | readonly number[],
    chunk?: VectorChunk,
  ): Promise<void> {
    const float64Array = new Float64Array(embedding);
    const buffer = Buffer.from(float64Array.buffer);

    const stmt = this.db.prepare(`
      INSERT INTO vectors (relative_path, content_hash, embedding, chunk_offset, chunk_length, indexed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      relativePath,
      contentHash,
      buffer,
      chunk?.chunkOffset ?? null,
      chunk?.chunkLength ?? null,
      Date.now(),
    );

    this.evictIfOverCapacity();

    return Promise.resolve();
  }

  /**
   * Search for similar vectors.
   */
  search(
    queryEmbedding: Float32Array | readonly number[],
    topK: number = 10,
  ): Promise<readonly VectorSearchResult[]> {
    if (topK < 1) {
      return Promise.resolve([]);
    }

    const stmt = this.db.prepare(
      "SELECT relative_path, embedding, chunk_offset, chunk_length FROM vectors",
    );
    const rows = stmt.all() as Array<{
      relative_path: string;
      embedding: Uint8Array;
      chunk_offset: number | null;
      chunk_length: number | null;
    }>;

    const results: Array<VectorSearchResult> = [];

    for (const row of rows) {
      const blob = row.embedding;
      const float64Array = new Float64Array(
        blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
      );

      const score = cosineSimilarity(queryEmbedding, float64Array);

      results.push({
        path: row.relative_path,
        score,
        chunkOffset: row.chunk_offset !== null ? row.chunk_offset : undefined,
        chunkLength: row.chunk_length !== null ? row.chunk_length : undefined,
      });
    }

    results.sort((a, b) => b.score - a.score);

    return Promise.resolve(results.slice(0, topK));
  }

  /**
   * Remove a file from the index.
   */
  removeFile(relativePath: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM vectors WHERE relative_path = ?");
    stmt.run(relativePath);
    return Promise.resolve();
  }

  /**
   * Check if a file's index is stale.
   */
  isStale(relativePath: string, currentContentHash: string): Promise<boolean> {
    const stmt = this.db.prepare(
      "SELECT content_hash FROM vectors WHERE relative_path = ?",
    );
    const rows = stmt.all(relativePath) as Array<{ content_hash: string }>;

    if (rows.length === 0) {
      return Promise.resolve(true); // No entries exist, it's stale
    }

    for (const row of rows) {
      if (row.content_hash !== currentContentHash) {
        return Promise.resolve(true);
      }
    }

    return Promise.resolve(false);
  }

  /**
   * Get all known file paths in the index.
   */
  getKnownPaths(): Promise<readonly string[]> {
    const stmt = this.db.prepare("SELECT DISTINCT relative_path FROM vectors");
    const rows = stmt.all() as Array<{ relative_path: string }>;
    return Promise.resolve(rows.map((r) => r.relative_path));
  }

  /**
   * Clear the index.
   */
  clear(): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM vectors");
    stmt.run();
    return Promise.resolve();
  }

  /**
   * Get the number of entries in the index.
   */
  size(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM vectors");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Save the index. No-op for SQLite.
   */
  save(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Load the index. Ensures DB is ready.
   */
  load(): Promise<void> {
    // Database is initialized in constructor
    return Promise.resolve();
  }

  /**
   * Migrate from an existing InMemoryVectorIndex JSON persistence file.
   * Returns an empty index if the JSON file is invalid or corrupt.
   */
  static async migrateFromJson(
    jsonPath: string,
    sqlitePath: string,
  ): Promise<SqliteVectorIndex> {
    const index = new SqliteVectorIndex({ persistencePath: sqlitePath });

    try {
      const content = await readFile(jsonPath, "utf-8");
      const json: unknown = JSON.parse(content);
      const parsed = PersistedFileSchema.safeParse(json);

      if (!parsed.success) {
        return index;
      }

      await index.clear();

      const insertStmt = index.db.prepare(`
        INSERT INTO vectors (relative_path, content_hash, embedding, chunk_offset, chunk_length, indexed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      index.db.exec("BEGIN TRANSACTION");
      for (const entry of parsed.data.entries) {
        const float64Array = new Float64Array(entry.embedding);
        const buffer = Buffer.from(float64Array.buffer);

        insertStmt.run(
          entry.relativePath,
          entry.contentHash,
          buffer,
          entry.chunkOffset ?? null,
          entry.chunkLength ?? null,
          entry.indexedAtMs,
        );
      }
      index.db.exec("COMMIT TRANSACTION");
    } catch {
      // Corrupt or unreadable JSON — return empty index
    }

    return index;
  }
}
