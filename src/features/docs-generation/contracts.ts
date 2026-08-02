import { z } from "zod";

export const DOCS_GENERATION_MAX_FILES = 15;
export const DOCS_GENERATION_MAX_CHANGED_LINES = 800;
export const DOCS_GENERATION_MAX_SOURCE_LINES_PER_FILE = 600;
export const DOCS_GENERATION_MAX_INPUT_BYTES = 2 * 1_024 * 1_024;
export const DOCS_GENERATION_MARKDOWN_MAX_CHARACTERS = 20_000;

export const DOC_TYPES = Object.freeze(["inline", "markdown", "both"] as const);
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_STYLES = Object.freeze([
  "jsdoc",
  "tsdoc",
  "numpy",
  "google",
] as const);
export type DocStyle = (typeof DOC_STYLES)[number];

export const SOURCE_LANGUAGES = Object.freeze([
  "typescript",
  "python",
] as const);
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];

export const GenerateDocsPatchInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    target: z.string().trim().min(1).max(4_096),
    doc_type: z.enum(["inline", "markdown", "both"]),
    style: z.enum(["jsdoc", "tsdoc", "numpy", "google"]).optional(),
    force_refresh: z.boolean().default(false),
  })
  .strict();

export type GenerateDocsPatchInput = z.infer<
  typeof GenerateDocsPatchInputSchema
>;

export interface UndocumentedSymbol {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
  readonly start_line: number;
  readonly end_line: number;
}

export interface DocumentableFile {
  readonly path: string;
  readonly language: SourceLanguage;
  readonly style: DocStyle;
  readonly symbols: readonly UndocumentedSymbol[];
}

export const GeneratedSymbolDocSchema = z
  .object({
    name: z.string().trim().min(1).max(4_096),
    content: z.string().trim().min(1).max(8_000),
  })
  .strict();

export type GeneratedSymbolDoc = z.infer<typeof GeneratedSymbolDocSchema>;

export const GeneratedFileDocsSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    symbol_docs: z.array(GeneratedSymbolDocSchema).max(500),
  })
  .strict();

export const GeneratedDocsSchema = z
  .object({
    files: z.array(GeneratedFileDocsSchema).max(DOCS_GENERATION_MAX_FILES),
    markdown: z
      .string()
      .trim()
      .min(1)
      .max(DOCS_GENERATION_MARKDOWN_MAX_CHARACTERS)
      .optional(),
    summary: z.string().trim().min(1).max(8_000),
  })
  .strict();

export type GeneratedDocs = z.infer<typeof GeneratedDocsSchema>;

export const DocsPatchFileSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    changed_lines: z.number().int().min(0),
  })
  .strict();

export type DocsPatchFile = z.infer<typeof DocsPatchFileSchema>;

export const GenerateDocsPatchResultSchema = z
  .object({
    patch: z.string().max(DOCS_GENERATION_MAX_INPUT_BYTES),
    files: z.array(DocsPatchFileSchema).max(DOCS_GENERATION_MAX_FILES),
    changed_lines: z.number().int().min(0),
    summary: z.string().trim().min(1).max(8_000),
  })
  .strict();

export type GenerateDocsPatchResult = z.infer<
  typeof GenerateDocsPatchResultSchema
>;

export type DocsGenerationErrorCode =
  | "invalid_request"
  | "no_documentable_files"
  | "invalid_output"
  | "invalid_evidence";

export class DocsGenerationError extends Error {
  public readonly code: DocsGenerationErrorCode;

  public constructor(code: DocsGenerationErrorCode, message: string) {
    super(message);
    this.name = "DocsGenerationError";
    this.code = code;
  }
}
