export {
  SemanticSearchInputSchema,
  type SemanticSearchInput,
  type SemanticSearchResult,
  type SemanticSearchResultItem,
  type VectorChunk,
  type VectorEntry,
  type VectorIndex,
  type VectorIndexOptions,
  type VectorSearchResult,
} from "./contracts.js";
export { InMemoryVectorIndex, cosineSimilarity } from "./vector-index.js";
export { SqliteVectorIndex } from "./sqlite-vector-index.js";
export { MultiRepoVectorIndex } from "./multi-repo-index.js";
export { chunkText, type TextChunk } from "./chunking.js";
export {
  executeSemanticSearch,
  reindexRepository,
  type ExecuteSemanticSearchOptions,
  type ReindexOptions,
} from "./search.js";
