import { z } from "zod";

export interface VectorChunk {
  readonly chunkOffset?: number | undefined;
  readonly chunkLength?: number | undefined;
}

export interface VectorEntry extends VectorChunk {
  readonly relativePath: string;
  readonly contentHash: string;
  readonly embedding: readonly number[];
  readonly indexedAtMs: number;
}

export interface VectorSearchResult extends VectorChunk {
  readonly path: string;
  readonly score: number;
}

export interface VectorIndexOptions {
  readonly maxEntries?: number | undefined;
  readonly persistencePath?: string | undefined;
}

export const SemanticSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    repository_root: z.string().min(1),
    top_k: z.number().int().min(1).max(50).optional(),
    reindex: z.boolean().optional(),
    additional_repositories: z
      .array(z.string().trim().min(1).max(4_096))
      .max(10)
      .optional(),
  })
  .strict();

export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;

export interface SemanticSearchResultItem {
  readonly path: string;
  readonly score: number;
  readonly excerpt: string;
  readonly line_start: number;
  readonly line_end: number;
}

/**
 * Reported when the repository exceeds the documented indexing ceiling, so a
 * caller can tell "no match" apart from "not indexed".
 */
export interface IndexLimitation {
  readonly code: "repository_too_large";
  readonly reason: "file_count" | "byte_volume";
  readonly files_not_indexed: number;
}

export interface SemanticSearchResult {
  readonly results: readonly SemanticSearchResultItem[];
  readonly stale_warning?: boolean | undefined;
  readonly index_limitation?: IndexLimitation | undefined;
}

export interface VectorIndex {
  indexFile(
    relativePath: string,
    contentHash: string,
    embedding: Float32Array | readonly number[],
    chunk?: VectorChunk,
  ): Promise<void>;
  search(
    queryEmbedding: Float32Array | readonly number[],
    topK?: number,
  ): Promise<readonly VectorSearchResult[]>;
  removeFile(relativePath: string): Promise<void>;
  isStale(relativePath: string, currentContentHash: string): Promise<boolean>;
  getKnownPaths(): Promise<readonly string[]>;
  clear(): Promise<void>;
  size(): number;
  save(): Promise<void>;
  load(): Promise<void>;
}
