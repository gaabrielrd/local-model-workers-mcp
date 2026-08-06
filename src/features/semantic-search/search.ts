import { createHash } from "node:crypto";

import { FIXED_LIMITS } from "../configuration/index.js";
import type { ModelInferencePort } from "../model-inference/index.js";
import type { RepositoryReadCapability } from "../repository-exploration/index.js";

import { chunkText } from "./chunking.js";
import type {
  IndexLimitation,
  SemanticSearchInput,
  SemanticSearchResult,
  SemanticSearchResultItem,
  VectorIndex,
} from "./contracts.js";

const DEFAULT_TOP_K = 10;
const MAX_EXCERPT_LINES = 50;

export interface ExecuteSemanticSearchOptions {
  readonly input: SemanticSearchInput;
  readonly inference: ModelInferencePort;
  readonly vectorIndex: VectorIndex;
  readonly repositoryRead: RepositoryReadCapability;
  readonly embeddingModel: string;
  readonly timeout_ms?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((message: string) => void) | undefined;
  /** Overrides the documented indexing ceiling. Tests use it to stay small. */
  readonly maxFiles?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export async function executeSemanticSearch(
  options: ExecuteSemanticSearchOptions,
): Promise<SemanticSearchResult> {
  const {
    input,
    inference,
    vectorIndex,
    repositoryRead,
    embeddingModel,
    timeout_ms = 30_000,
    signal,
    onProgress,
  } = options;

  const topK = input.top_k ?? DEFAULT_TOP_K;
  let indexOutcome: ReindexOutcome | undefined;

  // Reindex if requested or index is empty
  if (input.reindex === true || vectorIndex.size() === 0) {
    onProgress?.("Indexing repository files for semantic search...");
    indexOutcome = await reindexRepository({
      repositoryRead,
      inference,
      vectorIndex,
      embeddingModel,
      timeout_ms,
      signal,
      onProgress,
      ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    });
  }

  // Generate query embedding
  onProgress?.("Generating query embedding...");
  const queryResult = await inference.embedText({
    model: embeddingModel,
    input: input.query,
    timeout_ms,
    signal,
  });

  const queryVector = queryResult.embeddings[0];
  if (queryVector === undefined) {
    const revision =
      "rev:" +
      createHash("sha256")
        .update(JSON.stringify({ query: input.query, topK, items: [] }))
        .digest("hex");
    if (
      input.since_revision !== undefined &&
      input.since_revision === revision
    ) {
      return { results: [], revision, unchanged: true };
    }
    return { results: [], revision };
  }

  // Vector search
  const limitation: IndexLimitation | undefined =
    indexOutcome?.truncated === true
      ? {
          code: "repository_too_large",
          reason: indexOutcome.limit_reason ?? "file_count",
          files_not_indexed: indexOutcome.over_limit_files,
        }
      : undefined;

  const matches = await vectorIndex.search(queryVector, topK);
  if (matches.length === 0) {
    const revision =
      "rev:" +
      createHash("sha256")
        .update(JSON.stringify({ query: input.query, topK, items: [] }))
        .digest("hex");
    if (
      input.since_revision !== undefined &&
      input.since_revision === revision
    ) {
      return {
        results: [],
        revision,
        unchanged: true,
        ...(limitation === undefined ? {} : { index_limitation: limitation }),
      };
    }
    return {
      results: [],
      revision,
      ...(limitation === undefined ? {} : { index_limitation: limitation }),
    };
  }

  // Staleness check on sample of top results
  let staleCount = 0;
  const items: SemanticSearchResultItem[] = [];

  for (const match of matches) {
    let snippetText: string;
    let lineStart = 1;
    let lineEnd = 1;

    try {
      // Read snippet for excerpt extraction
      const snippet = await repositoryRead.readSnippet({
        path: match.path,
        start_line: 1,
        line_count: MAX_EXCERPT_LINES,
      });

      snippetText = snippet.content;
      lineStart = snippet.start_line;
      lineEnd = snippet.end_line;

      // Staleness check
      const currentHash = createHash("sha256")
        .update(snippetText)
        .digest("hex");
      const isStale = await vectorIndex.isStale(match.path, currentHash);
      if (isStale) {
        staleCount += 1;
      }
    } catch {
      staleCount += 1;
      snippetText = "[Unable to read file content]";
    }

    items.push({
      path: match.path,
      score: Math.round(match.score * 1_000) / 1_000,
      excerpt: snippetText,
      line_start: lineStart,
      line_end: lineEnd,
    });
  }

  const staleRatio = staleCount / matches.length;
  const staleWarning = staleRatio > 0.2;

  const revision =
    "rev:" +
    createHash("sha256")
      .update(
        JSON.stringify({
          query: input.query,
          topK,
          items: items.map((i) => ({
            path: i.path,
            line_start: i.line_start,
            line_end: i.line_end,
            excerpt: i.excerpt,
          })),
        }),
      )
      .digest("hex");

  if (input.since_revision !== undefined && input.since_revision === revision) {
    return {
      results: [],
      revision,
      unchanged: true,
      ...(staleWarning ? { stale_warning: true } : {}),
      ...(limitation === undefined ? {} : { index_limitation: limitation }),
    };
  }

  return {
    results: items,
    revision,
    ...(staleWarning ? { stale_warning: true } : {}),
    ...(limitation === undefined ? {} : { index_limitation: limitation }),
  };
}

/**
 * What a reindex pass actually covered.
 *
 * A repository past the documented ceiling is indexed up to that ceiling and
 * reports the shortfall, rather than consuming unbounded memory or time.
 */
export interface ReindexOutcome {
  readonly indexed_files: number;
  readonly skipped_unchanged: number;
  readonly pruned_files: number;
  /** Files present in the repository but beyond the ceiling. */
  readonly over_limit_files: number;
  readonly truncated: boolean;
  readonly limit_reason?: "file_count" | "byte_volume";
}

export interface ReindexOptions {
  readonly repositoryRead: RepositoryReadCapability;
  readonly inference: ModelInferencePort;
  readonly vectorIndex: VectorIndex;
  readonly embeddingModel: string;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((message: string) => void) | undefined;
  /** Overrides the documented ceiling. Tests use it to keep fixtures small. */
  readonly maxFiles?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export async function reindexRepository(
  options: ReindexOptions,
): Promise<ReindexOutcome> {
  const {
    repositoryRead,
    inference,
    vectorIndex,
    embeddingModel,
    timeout_ms,
    signal,
    onProgress,
  } = options;

  // Root directory listing
  const listing = await repositoryRead.listDirectory({});
  const currentRepoFiles = new Set<string>();

  for (const entry of listing.entries) {
    if (entry.kind === "file") {
      currentRepoFiles.add(entry.path);
    }
  }

  // Prune index entries for files no longer present in the repository
  const knownPaths = await vectorIndex.getKnownPaths();
  for (const knownPath of knownPaths) {
    if (!currentRepoFiles.has(knownPath)) {
      await vectorIndex.removeFile(knownPath);
    }
  }

  const maxFiles = options.maxFiles ?? FIXED_LIMITS.index_max_files;
  const maxBytes = options.maxBytes ?? FIXED_LIMITS.index_max_bytes;
  const allFiles = Array.from(currentRepoFiles);

  // Stop at the ceiling rather than walking an unbounded monorepo. The
  // selection is deterministic so repeated runs cover the same subset.
  const filesToIndex = allFiles.slice(0, maxFiles);
  const overLimitFiles = allFiles.length - filesToIndex.length;
  let truncated = overLimitFiles > 0;
  let limitReason: "file_count" | "byte_volume" | undefined =
    overLimitFiles > 0 ? "file_count" : undefined;

  let processed = 0;
  let skipped = 0;
  let reembedded = 0;
  let indexedBytes = 0;
  let byteLimitStoppedAt: number | undefined;

  for (const relativePath of filesToIndex) {
    signal?.throwIfAborted();
    processed += 1;

    try {
      const snippet = await repositoryRead.readSnippet({
        path: relativePath,
        start_line: 1,
        line_count: 200,
      });

      const content = snippet.content;
      if (content.trim().length === 0) {
        await vectorIndex.removeFile(relativePath);
        continue;
      }

      indexedBytes += Buffer.byteLength(content, "utf8");
      if (indexedBytes > maxBytes) {
        truncated = true;
        limitReason = "byte_volume";
        byteLimitStoppedAt = processed;
        break;
      }

      const contentHash = createHash("sha256").update(content).digest("hex");
      const isStale = await vectorIndex.isStale(relativePath, contentHash);
      if (!isStale) {
        skipped += 1;
        onProgress?.(
          `Skipping unchanged file ${processed}/${filesToIndex.length}: ${relativePath}`,
        );
        continue;
      }

      // File is new or modified: remove previous entries before re-embedding
      await vectorIndex.removeFile(relativePath);

      const chunks = chunkText(content);
      if (chunks.length === 0) {
        continue;
      }

      onProgress?.(
        `Indexing file ${processed}/${filesToIndex.length}: ${relativePath}`,
      );

      const chunkTexts = chunks.map((c) => c.text);
      const embedResult = await inference.embedText({
        model: embeddingModel,
        input: chunkTexts,
        timeout_ms,
        signal,
      });

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        const embedding = embedResult.embeddings[i];
        if (embedding !== undefined) {
          await vectorIndex.indexFile(relativePath, contentHash, embedding, {
            chunkOffset: chunk.chunkOffset,
            chunkLength: chunk.chunkLength,
          });
        }
      }
      reembedded += 1;
    } catch {
      // Content filtering or read error — skip file
      continue;
    }
  }

  const prunedCount = knownPaths.filter(
    (knownPath) => !currentRepoFiles.has(knownPath),
  ).length;
  const notCovered =
    overLimitFiles +
    (byteLimitStoppedAt === undefined
      ? 0
      : filesToIndex.length - byteLimitStoppedAt);

  onProgress?.(
    `Incremental sync complete: ${skipped} skipped, ${reembedded} re-embedded, ${prunedCount} pruned.`,
  );
  if (truncated) {
    onProgress?.(
      `Repository exceeds the indexing ceiling (${limitReason}); ${notCovered} file(s) were not indexed.`,
    );
  }

  await vectorIndex.save();

  return {
    indexed_files: reembedded,
    skipped_unchanged: skipped,
    pruned_files: prunedCount,
    over_limit_files: notCovered,
    truncated,
    ...(limitReason === undefined ? {} : { limit_reason: limitReason }),
  };
}
