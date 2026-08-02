import { z } from "zod";

export const SUMMARIZATION_MAX_FILES = 20;
export const SUMMARIZATION_MAX_INPUT_LINES = 200;

export const SummarizationInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    target: z.string().trim().min(1).max(4_096),
    depth: z.enum(["shallow", "deep"]).default("shallow"),
    force_refresh: z.boolean().default(false),
  })
  .strict();

export type SummarizationDepth = "shallow" | "deep";

export interface SummarizationInput {
  readonly repository_root: string;
  readonly target: string;
  readonly depth?: SummarizationDepth | undefined;
  readonly force_refresh?: boolean | undefined;
}

export const SummarizedSymbolSchema = z
  .object({
    name: z.string().trim().min(1).max(4_096),
    kind: z.string().trim().min(1).max(128),
    signature: z.string().trim().max(4_096),
  })
  .strict();

export interface SummarizedSymbol {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
}

export const FileSummaryResultSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    summary: z.string().trim().max(8_000),
    symbols: z.array(SummarizedSymbolSchema),
    exports: z.array(z.string().trim().min(1).max(4_096)),
    dependencies: z.array(z.string().trim().min(1).max(4_096)),
  })
  .strict();

export interface FileSummaryResult {
  readonly path: string;
  readonly summary: string;
  readonly symbols: readonly SummarizedSymbol[];
  readonly exports: readonly string[];
  readonly dependencies: readonly string[];
}

export const SummarizationResultSchema = z
  .object({
    target: z.string().trim().min(1).max(4_096),
    depth: z.enum(["shallow", "deep"]),
    files: z.array(FileSummaryResultSchema),
    aggregate_summary: z.string().trim().min(1).optional(),
  })
  .strict();

export interface SummarizationResult {
  readonly target: string;
  readonly depth: SummarizationDepth;
  readonly files: readonly FileSummaryResult[];
  readonly aggregate_summary?: string | undefined;
}

export type SummarizationCacheValue = FileSummaryResult | string;

export interface SummarizationCache {
  get(key: string): SummarizationCacheValue | undefined;
  set(key: string, value: SummarizationCacheValue): void;
  clear(): void;
  size(): number;
}

export type SummarizationErrorCode = "too_many_files" | "invalid_request";

export class SummarizationError extends Error {
  public readonly code: SummarizationErrorCode;

  public constructor(code: SummarizationErrorCode, message: string) {
    super(message);
    this.name = "SummarizationError";
    this.code = code;
  }
}
