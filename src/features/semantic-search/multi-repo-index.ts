import type {
  VectorIndex,
  VectorIndexOptions,
  VectorSearchResult,
} from "./contracts.js";
import { SqliteVectorIndex } from "./sqlite-vector-index.js";

export interface MultiRepoVectorIndexOptions extends VectorIndexOptions {
  readonly createIndex?: ((repositoryRoot: string) => VectorIndex) | undefined;
}

/**
 * MultiRepoVectorIndex manages vector indices across primary and additional repositories.
 */
export class MultiRepoVectorIndex {
  private readonly indices = new Map<string, VectorIndex>();
  private readonly createIndexFactory: (repositoryRoot: string) => VectorIndex;

  constructor(options: MultiRepoVectorIndexOptions = {}) {
    this.createIndexFactory =
      options.createIndex ??
      (() => new SqliteVectorIndex({ maxEntries: options.maxEntries }));
  }

  /**
   * Get or create a vector index for the specified repository root.
   */
  public getOrCreate(repositoryRoot: string): VectorIndex {
    let index = this.indices.get(repositoryRoot);
    if (index === undefined) {
      index = this.createIndexFactory(repositoryRoot);
      this.indices.set(repositoryRoot, index);
    }
    return index;
  }

  /**
   * Search across the primary repository and optional additional repositories.
   */
  public async searchMulti(
    queryEmbedding: Float32Array | readonly number[],
    primaryRoot: string,
    additionalRoots: readonly string[] = [],
    topK = 10,
  ): Promise<readonly VectorSearchResult[]> {
    const allRoots = [primaryRoot, ...additionalRoots];
    const resultsPromises = allRoots.map(async (root) => {
      const idx = this.getOrCreate(root);
      const res = await idx.search(queryEmbedding, topK);
      if (allRoots.length > 1) {
        return res.map((item) => ({
          ...item,
          path: `${root}:${item.path}`,
        }));
      }
      return res;
    });

    const nestedResults = await Promise.all(resultsPromises);
    const flattened = nestedResults.flat();
    flattened.sort((a, b) => b.score - a.score);
    return Object.freeze(flattened.slice(0, topK));
  }

  /**
   * Clear all managed indices.
   */
  public async clear(): Promise<void> {
    for (const index of this.indices.values()) {
      await index.clear();
    }
    this.indices.clear();
  }
}
