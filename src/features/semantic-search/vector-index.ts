import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  VectorChunk,
  VectorEntry,
  VectorIndex,
  VectorIndexOptions,
  VectorSearchResult,
} from "./contracts.js";

const DEFAULT_MAX_ENTRIES = 50_000;
const PERSISTENCE_VERSION = 1;

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
    version: z.literal(PERSISTENCE_VERSION),
    entries: z.array(PersistedEntrySchema),
  })
  .strict();

export class InMemoryVectorIndex implements VectorIndex {
  private readonly maxEntries: number;
  private readonly persistencePath?: string | undefined;
  private entries: VectorEntry[] = [];

  public constructor(options: VectorIndexOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (options.persistencePath !== undefined) {
      this.persistencePath = options.persistencePath;
    }
  }

  public indexFile(
    relativePath: string,
    contentHash: string,
    embedding: Float32Array | readonly number[],
    chunk?: VectorChunk,
  ): Promise<void> {
    const floatArray = Array.from(embedding);
    const entry: VectorEntry = {
      relativePath,
      contentHash,
      embedding: floatArray,
      indexedAtMs: Date.now(),
      ...(chunk?.chunkOffset !== undefined
        ? { chunkOffset: chunk.chunkOffset }
        : {}),
      ...(chunk?.chunkLength !== undefined
        ? { chunkLength: chunk.chunkLength }
        : {}),
    };

    this.entries.push(entry);
    this.evictIfOverCapacity();
    return Promise.resolve();
  }

  public search(
    queryEmbedding: Float32Array | readonly number[],
    topK = 10,
  ): Promise<readonly VectorSearchResult[]> {
    if (this.entries.length === 0 || topK < 1) {
      return Promise.resolve([]);
    }

    const queryArray = Array.from(queryEmbedding);
    const scored: VectorSearchResult[] = [];

    for (const entry of this.entries) {
      const score = cosineSimilarity(queryArray, entry.embedding);
      scored.push({
        path: entry.relativePath,
        score,
        ...(entry.chunkOffset !== undefined
          ? { chunkOffset: entry.chunkOffset }
          : {}),
        ...(entry.chunkLength !== undefined
          ? { chunkLength: entry.chunkLength }
          : {}),
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, topK));
  }

  public removeFile(relativePath: string): Promise<void> {
    this.entries = this.entries.filter(
      (entry) => entry.relativePath !== relativePath,
    );
    return Promise.resolve();
  }

  public isStale(
    relativePath: string,
    currentContentHash: string,
  ): Promise<boolean> {
    const fileEntries = this.entries.filter(
      (entry) => entry.relativePath === relativePath,
    );
    if (fileEntries.length === 0) {
      return Promise.resolve(true);
    }
    return Promise.resolve(
      fileEntries.some((entry) => entry.contentHash !== currentContentHash),
    );
  }

  public getKnownPaths(): Promise<readonly string[]> {
    const paths = Array.from(
      new Set(this.entries.map((entry) => entry.relativePath)),
    );
    return Promise.resolve(paths);
  }

  public clear(): Promise<void> {
    this.entries = [];
    return Promise.resolve();
  }

  public size(): number {
    return this.entries.length;
  }

  public async save(): Promise<void> {
    if (this.persistencePath === undefined) {
      return;
    }
    const payload = {
      version: PERSISTENCE_VERSION,
      entries: this.entries,
    };

    await mkdir(path.dirname(this.persistencePath), { recursive: true });
    await writeFile(
      this.persistencePath,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  }

  public async load(): Promise<void> {
    if (this.persistencePath === undefined) {
      return;
    }
    try {
      const raw = await readFile(this.persistencePath, "utf8");
      const unparsed: unknown = JSON.parse(raw);
      const parsed = PersistedFileSchema.safeParse(unparsed);
      if (!parsed.success) {
        this.entries = [];
        return;
      }
      this.entries = parsed.data.entries;
      this.evictIfOverCapacity();
    } catch {
      this.entries = [];
    }
  }

  private evictIfOverCapacity(): void {
    if (this.entries.length <= this.maxEntries) {
      return;
    }
    // Evict oldest entries by indexedAtMs
    this.entries.sort((a, b) => b.indexedAtMs - a.indexedAtMs);
    this.entries = this.entries.slice(0, this.maxEntries);
  }
}

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
