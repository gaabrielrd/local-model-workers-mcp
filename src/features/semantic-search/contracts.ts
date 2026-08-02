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
  readonly maxEntries?: number;
  readonly persistencePath?: string;
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
  clear(): Promise<void>;
  size(): number;
  save(): Promise<void>;
  load(): Promise<void>;
}
