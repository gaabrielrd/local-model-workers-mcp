import { createHash } from "node:crypto";

import { z } from "zod";

import { parseSourceSymbols } from "../code-graph/index.js";
import {
  composeSystemProtocol,
  composeUntrustedPrompt,
  type ModelInferencePort,
} from "../model-inference/index.js";
import {
  RepositoryAccessError,
  createOutboundContextCollector,
  defaultContentClassifier,
  type CreateOutboundContextCollectorInput,
  type DirectoryListing,
  type OutboundContextCollector,
  type RepositoryReadCapability,
} from "../repository-exploration/index.js";

import {
  SUMMARIZATION_MAX_FILES,
  SUMMARIZATION_MAX_INPUT_LINES,
  SummarizationError,
  SummarizationInputSchema,
  type FileSummaryResult,
  type SummarizationCache,
  type SummarizationCacheValue,
  type SummarizationDepth,
  type SummarizationInput,
  type SummarizationResult,
} from "./contracts.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const FILE_GOAL = "Summarize repository modules.";

const FileSummaryInferenceSchema = z
  .object({
    summary: z.string().trim().min(1).max(8_000),
  })
  .strict();

export interface SummarizeModuleOptions {
  readonly input: SummarizationInput;
  readonly inference: ModelInferencePort;
  readonly repositoryRead: RepositoryReadCapability;
  readonly model: string;
  readonly collectorFactory?: (
    input: CreateOutboundContextCollectorInput,
  ) => Promise<OutboundContextCollector>;
  readonly cache?: SummarizationCache;
  readonly timeout_ms?: number;
  readonly signal?: AbortSignal;
}

export async function summarizeModule(
  options: SummarizeModuleOptions,
): Promise<SummarizationResult> {
  const input = SummarizationInputSchema.parse(options.input);
  const collectorFactory =
    options.collectorFactory ?? createOutboundContextCollector;
  const collector = await collectorFactory({
    repositoryRoot: input.repository_root,
    goal: FILE_GOAL,
  });
  const cache = options.cache ?? new InMemorySummarizationCache();
  const timeout_ms = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const target = await resolveTarget(options.repositoryRead, input.target);

  if (target.kind === "file") {
    const entry = await summarizeFile({
      path: input.target,
      depth: input.depth,
      forceRefresh: input.force_refresh,
      repositoryRead: options.repositoryRead,
      collector,
      cache,
      model: options.model,
      inference: options.inference,
      timeout_ms,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const files = entry === undefined ? [] : [entry];
    const revision =
      "rev:" +
      createHash("sha256")
        .update(
          JSON.stringify({ target: input.target, depth: input.depth, files }),
        )
        .digest("hex");
    if (
      input.since_revision !== undefined &&
      input.since_revision === revision
    ) {
      return {
        target: input.target,
        depth: input.depth,
        files: [],
        revision,
        unchanged: true,
      };
    }
    return {
      target: input.target,
      depth: input.depth,
      files,
      revision,
    };
  }

  const files = await collectFiles(options.repositoryRead, target.listing);
  const allowedFiles: string[] = [];
  for (const filePath of files) {
    if ((await collector.assessPath(filePath)).accepted) {
      allowedFiles.push(filePath);
      if (allowedFiles.length > SUMMARIZATION_MAX_FILES) {
        throw new SummarizationError(
          "too_many_files",
          `The directory contains more than ${SUMMARIZATION_MAX_FILES} summarizable files. Subdivide the request to a smaller directory.`,
        );
      }
    }
  }

  const entries: FileSummaryResult[] = [];
  for (const filePath of allowedFiles) {
    options.signal?.throwIfAborted();
    const entry = await summarizeFile({
      path: filePath,
      depth: input.depth,
      forceRefresh: input.force_refresh,
      repositoryRead: options.repositoryRead,
      collector,
      cache,
      model: options.model,
      inference: options.inference,
      timeout_ms,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (entry !== undefined) {
      entries.push(entry);
    }
  }

  let aggregateSummary: string | undefined;
  if (entries.length > 1 && entries.some((entry) => entry.summary.length > 0)) {
    const aggregateKey = aggregateCacheKey(input.target, entries, input.depth);
    const cachedAggregate = input.force_refresh
      ? undefined
      : cache.get(aggregateKey);
    if (typeof cachedAggregate === "string") {
      aggregateSummary = cachedAggregate;
    } else {
      aggregateSummary = await inferAggregate({
        target: input.target,
        depth: input.depth,
        entries,
        model: options.model,
        inference: options.inference,
        timeout_ms,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      cache.set(aggregateKey, aggregateSummary);
    }
  }

  const revision =
    "rev:" +
    createHash("sha256")
      .update(
        JSON.stringify({
          target: input.target,
          depth: input.depth,
          files: entries,
          aggregateSummary,
        }),
      )
      .digest("hex");

  if (input.since_revision !== undefined && input.since_revision === revision) {
    return {
      target: input.target,
      depth: input.depth,
      files: [],
      revision,
      unchanged: true,
      ...(aggregateSummary === undefined
        ? {}
        : { aggregate_summary: aggregateSummary }),
    };
  }

  return {
    target: input.target,
    depth: input.depth,
    files: entries,
    revision,
    ...(aggregateSummary === undefined
      ? {}
      : { aggregate_summary: aggregateSummary }),
  };
}

interface SummarizeFileOptions {
  readonly path: string;
  readonly depth: SummarizationDepth;
  readonly forceRefresh: boolean;
  readonly repositoryRead: RepositoryReadCapability;
  readonly collector: OutboundContextCollector;
  readonly cache: SummarizationCache;
  readonly model: string;
  readonly inference: ModelInferencePort;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
}

async function summarizeFile(
  options: SummarizeFileOptions,
): Promise<FileSummaryResult | undefined> {
  const { path, depth, forceRefresh, signal } = options;

  const assessed = await options.collector.assessPath(path);
  if (!assessed.accepted) {
    return undefined;
  }

  let content: string;
  try {
    const snippet = await options.repositoryRead.readSnippet({
      path,
      start_line: 1,
      line_count: SUMMARIZATION_MAX_INPUT_LINES,
    });
    content = snippet.content;
  } catch (error: unknown) {
    if (error instanceof RepositoryAccessError) {
      return undefined;
    }
    throw error;
  }

  if (!defaultContentClassifier.classify(path, content).allowed) {
    return undefined;
  }

  if (!isCodeFile(path)) {
    return { path, summary: "", symbols: [], exports: [], dependencies: [] };
  }

  const contentHash = sha256(content);
  const cacheKey = fileCacheKey(path, contentHash, depth);
  if (!forceRefresh) {
    const cached = options.cache.get(cacheKey);
    if (cached !== undefined && typeof cached !== "string") {
      return cached;
    }
  }

  const symbols = parseSourceSymbols(path, content);
  const structuralSymbols = symbols.filter(
    (symbol) => symbol.kind !== "import",
  );
  const exports = unique(
    symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name),
  );
  const dependencies = unique(
    symbols
      .filter((symbol) => symbol.kind === "import")
      .map((symbol) => symbol.name),
  );

  const summary = await inferFileSummary({
    path,
    depth,
    content,
    structuralSymbols,
    exports,
    dependencies,
    model: options.model,
    inference: options.inference,
    timeout_ms: options.timeout_ms,
    ...(signal === undefined ? {} : { signal }),
  });

  const entry: FileSummaryResult = {
    path,
    summary,
    symbols: structuralSymbols.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      signature: symbol.signature,
    })),
    exports,
    dependencies,
  };
  options.cache.set(cacheKey, entry);
  return entry;
}

interface InferFileSummaryOptions {
  readonly path: string;
  readonly depth: SummarizationDepth;
  readonly content: string;
  readonly structuralSymbols: readonly {
    readonly name: string;
    readonly kind: string;
    readonly signature: string;
  }[];
  readonly exports: readonly string[];
  readonly dependencies: readonly string[];
  readonly model: string;
  readonly inference: ModelInferencePort;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
}

async function inferFileSummary(
  options: InferFileSummaryOptions,
): Promise<string> {
  const { text: prompt } = composeUntrustedPrompt({
    task: { task: "summarize_module", depth: options.depth },
    data: {
      path: options.path,
      symbols: options.structuralSymbols,
      exports: options.exports,
      dependencies: options.dependencies,
      source_preview_lines: options.content
        .split(/\r?\n/u)
        .slice(0, SUMMARIZATION_MAX_INPUT_LINES),
    },
  });
  const systemPrompt = composeSystemProtocol([
    "You summarize a source module from structural metadata and quoted source lines.",
    options.depth === "shallow"
      ? "Produce a single concise paragraph explaining what the module does and its main responsibilities."
      : "Produce a multi-paragraph summary. Include dependency analysis, internal call patterns, and architectural observations in separate paragraphs.",
    "Return exactly the required JSON schema.",
  ]);

  const result = await options.inference.inferStructured({
    model: options.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    output_name: "module_summary",
    output_schema: FileSummaryInferenceSchema,
    max_tokens: 2_048,
    timeout_ms: options.timeout_ms,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return result.output.summary;
}

interface InferAggregateOptions {
  readonly target: string;
  readonly depth: SummarizationDepth;
  readonly entries: readonly FileSummaryResult[];
  readonly model: string;
  readonly inference: ModelInferencePort;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
}

async function inferAggregate(options: InferAggregateOptions): Promise<string> {
  const { text: prompt } = composeUntrustedPrompt({
    task: {
      task: "summarize_module_aggregate",
      depth: options.depth,
      target: options.target,
    },
    data: {
      file_summaries: options.entries.map((entry) => ({
        path: entry.path,
        summary: entry.summary,
        exports: entry.exports,
        dependencies: entry.dependencies,
      })),
    },
  });
  const systemPrompt = composeSystemProtocol([
    "You synthesize one directory-level summary from individual module summaries.",
    options.depth === "deep"
      ? "Produce a multi-paragraph directory summary with architectural observations and inter-module relationships."
      : "Produce a single paragraph describing the directory as a whole.",
    "Return exactly the required JSON schema.",
  ]);

  const result = await options.inference.inferStructured({
    model: options.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    output_name: "module_aggregate_summary",
    output_schema: FileSummaryInferenceSchema,
    max_tokens: 2_048,
    timeout_ms: options.timeout_ms,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return result.output.summary;
}

export class InMemorySummarizationCache implements SummarizationCache {
  private readonly entries = new Map<string, SummarizationCacheValue>();

  public get(key: string): SummarizationCacheValue | undefined {
    return this.entries.get(key);
  }

  public set(key: string, value: SummarizationCacheValue): void {
    this.entries.set(key, value);
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}

type TargetResolution =
  | { readonly kind: "directory"; readonly listing: DirectoryListing }
  | { readonly kind: "file" };

async function resolveTarget(
  repositoryRead: RepositoryReadCapability,
  target: string,
): Promise<TargetResolution> {
  try {
    const listing = await repositoryRead.listDirectory({
      path: target,
      max_entries: 500,
    });
    return { kind: "directory", listing };
  } catch (error: unknown) {
    if (
      error instanceof RepositoryAccessError &&
      error.code === "invalid_request"
    ) {
      return { kind: "file" };
    }
    throw error;
  }
}

async function collectFiles(
  repositoryRead: RepositoryReadCapability,
  initialListing: DirectoryListing,
): Promise<string[]> {
  const files: string[] = [];
  const pending: DirectoryListing[] = [initialListing];
  while (pending.length > 0) {
    const listing = pending.shift();
    if (listing === undefined) break;
    for (const entry of listing.entries) {
      if (entry.kind === "file") {
        files.push(entry.path);
      } else if (entry.kind === "directory") {
        try {
          pending.push(
            await repositoryRead.listDirectory({
              path: entry.path,
              max_entries: 500,
            }),
          );
        } catch (error: unknown) {
          if (!(error instanceof RepositoryAccessError)) {
            throw error;
          }
        }
      }
    }
  }
  return files;
}

function isCodeFile(filePath: string): boolean {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".py")
  );
}

function fileCacheKey(
  filePath: string,
  contentHash: string,
  depth: SummarizationDepth,
): string {
  return `file:${filePath}\u0000${contentHash}\u0000${depth}`;
}

function aggregateCacheKey(
  target: string,
  entries: readonly FileSummaryResult[],
  depth: SummarizationDepth,
): string {
  const joined = entries
    .map((entry) => `${entry.path}\u0000${entry.summary}`)
    .sort()
    .join("\u0001");
  return `aggregate:${target}\u0000${sha256(joined)}\u0000${depth}`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
