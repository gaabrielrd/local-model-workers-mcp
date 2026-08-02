import { z } from "zod";

export const REPOSITORY_OPERATION_LIMITS = Object.freeze({
  default_list_entries: 100,
  max_list_entries: 500,
  default_search_results: 20,
  max_search_results: 100,
  max_search_pattern_characters: 128,
  max_search_line_characters: 4_096,
  max_search_files: 2_000,
  max_search_bytes: 8 * 1_024 * 1_024,
  max_read_file_bytes: 1_024 * 1_024,
  default_snippet_lines: 80,
  max_snippet_lines: 200,
  max_snippet_bytes: 64 * 1_024,
} as const);

export const ExplorationRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    repository_root: z.string().trim().min(1).max(4_096),
    priority_paths: z
      .array(z.string().trim().min(1).max(4_096))
      .max(50)
      .optional(),
  })
  .strict();

export interface ExplorationRequest {
  readonly goal: string;
  readonly repository_root: string;
  readonly priority_paths?: readonly string[];
}

export type RepositoryAccessErrorCode =
  | "invalid_request"
  | "repository_not_found"
  | "repository_access_denied"
  | "context_limit_exceeded";

export type RepositoryOperation =
  "open_repository" | "list_directory" | "search_text" | "read_snippet";

export class RepositoryAccessError extends Error {
  public readonly code: RepositoryAccessErrorCode;
  public readonly operation: RepositoryOperation;

  public constructor(
    code: RepositoryAccessErrorCode,
    operation: RepositoryOperation,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryAccessError";
    this.code = code;
    this.operation = operation;
  }
}

export interface DirectoryEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface DirectoryListing {
  readonly entries: readonly DirectoryEntry[];
  readonly truncated: boolean;
}

export interface TextSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly preview: string;
}

export interface TextSearchResult {
  readonly matches: readonly TextSearchMatch[];
  readonly visited_files: number;
  readonly scanned_bytes: number;
  readonly truncated: boolean;
}

export interface TextSnippet {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly content: string;
  readonly truncated: boolean;
}

export interface ListDirectoryInput {
  readonly path?: string;
  readonly max_entries?: number;
}

export const ListDirectoryInputSchema = z
  .object({
    path: z.string().min(1).max(4_096).optional(),
    max_entries: z
      .number()
      .int()
      .min(1)
      .max(REPOSITORY_OPERATION_LIMITS.max_list_entries)
      .optional(),
  })
  .strict();

export interface SearchTextInput {
  readonly path?: string;
  readonly query: string;
  readonly mode?: "literal" | "regex";
  readonly case_sensitive?: boolean;
  readonly max_results?: number;
}

export const SearchTextInputSchema = z
  .object({
    path: z.string().min(1).max(4_096).optional(),
    query: z
      .string()
      .min(1)
      .max(REPOSITORY_OPERATION_LIMITS.max_search_pattern_characters),
    mode: z.enum(["literal", "regex"]).optional(),
    case_sensitive: z.boolean().optional(),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(REPOSITORY_OPERATION_LIMITS.max_search_results)
      .optional(),
  })
  .strict();

export interface ReadSnippetInput {
  readonly path: string;
  readonly start_line?: number;
  readonly line_count?: number;
}

export const ReadSnippetInputSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    start_line: z.number().int().min(1).optional(),
    line_count: z
      .number()
      .int()
      .min(1)
      .max(REPOSITORY_OPERATION_LIMITS.max_snippet_lines)
      .optional(),
  })
  .strict();

export interface RepositoryReadCapability {
  listDirectory(input?: ListDirectoryInput): Promise<DirectoryListing>;
  searchText(input: SearchTextInput): Promise<TextSearchResult>;
  readSnippet(input: ReadSnippetInput): Promise<TextSnippet>;
}
