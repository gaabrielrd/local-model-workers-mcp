import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  ExplorationRequestSchema,
  ListDirectoryInputSchema,
  REPOSITORY_OPERATION_LIMITS,
  ReadSnippetInputSchema,
  RepositoryAccessError,
  SearchTextInputSchema,
  type DirectoryEntry,
  type DirectoryListing,
  type ExplorationRequest,
  type ListDirectoryInput,
  type ReadSnippetInput,
  type RepositoryOperation,
  type RepositoryReadCapability,
  type SearchTextInput,
  type TextSearchMatch,
  type TextSearchResult,
  type TextSnippet,
} from "./contracts.js";

export interface RepositoryFileStats {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface RepositoryDirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface RepositoryFileSystem {
  realpath(targetPath: string): Promise<string>;
  stat(targetPath: string): Promise<RepositoryFileStats>;
  readdir(
    targetPath: string,
    options: { withFileTypes: true },
  ): Promise<readonly RepositoryDirectoryEntry[]>;
  readFile(targetPath: string): Promise<Buffer>;
}

export interface CreateRepositoryReadCapabilityInput {
  readonly repositoryRoot: string;
  readonly priorityPaths?: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly fileSystem?: RepositoryFileSystem;
}

interface AuthorizedTarget {
  readonly canonicalPath: string;
  readonly stats: RepositoryFileStats;
}

const nodeFileSystem: RepositoryFileSystem = {
  realpath,
  stat,
  readdir: (targetPath, options) => readdir(targetPath, options),
  readFile: (targetPath) => readFile(targetPath),
};

export function validateExplorationRequest(input: unknown): ExplorationRequest {
  const parsed = ExplorationRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new RepositoryAccessError(
      "invalid_request",
      "open_repository",
      "The exploration goal, repository root, or priority paths are invalid.",
    );
  }
  return Object.freeze({
    goal: parsed.data.goal,
    repository_root: parsed.data.repository_root,
    ...(parsed.data.priority_paths === undefined
      ? {}
      : { priority_paths: Object.freeze([...parsed.data.priority_paths]) }),
  });
}

export async function createRepositoryReadCapability(
  input: CreateRepositoryReadCapabilityInput,
): Promise<RepositoryReadCapability> {
  const fileSystem = input.fileSystem ?? nodeFileSystem;
  const platform = input.platform ?? process.platform;
  const rawPriorityPaths: unknown = input.priorityPaths;
  if (
    rawPriorityPaths !== undefined &&
    (!Array.isArray(rawPriorityPaths) ||
      rawPriorityPaths.some(
        (priorityPath: unknown) =>
          typeof priorityPath !== "string" || priorityPath.length === 0,
      ))
  ) {
    throw invalidRequest("open_repository", "Priority paths are invalid.");
  }
  const canonicalRoot = await canonicalizeRoot(
    input.repositoryRoot,
    fileSystem,
  );
  const rootStats = await safeStat(
    canonicalRoot,
    "open_repository",
    fileSystem,
  );
  if (!rootStats.isDirectory()) {
    throw repositoryNotFound("open_repository");
  }
  const rootIdentity = identityOf(rootStats);

  const authorize = async (
    requestedPath: string,
    operation: RepositoryOperation,
  ): Promise<AuthorizedTarget> => {
    await verifyRoot(canonicalRoot, rootIdentity, operation, fileSystem);
    if (requestedPath.includes("\0")) {
      throw accessDenied(operation);
    }
    const candidate = pathForPlatform(platform).isAbsolute(requestedPath)
      ? requestedPath
      : pathForPlatform(platform).resolve(canonicalRoot, requestedPath);
    let canonicalTarget: string;
    try {
      canonicalTarget = await fileSystem.realpath(candidate);
    } catch (error: unknown) {
      if (isFileSystemError(error, "ENOENT")) {
        throw repositoryNotFound(operation);
      }
      throw accessDenied(operation);
    }
    if (!isPathContained(canonicalRoot, canonicalTarget, platform)) {
      throw accessDenied(operation);
    }
    const targetStats = await safeStat(canonicalTarget, operation, fileSystem);
    await verifyRoot(canonicalRoot, rootIdentity, operation, fileSystem);
    return { canonicalPath: canonicalTarget, stats: targetStats };
  };

  const priorityPaths =
    rawPriorityPaths === undefined
      ? []
      : (rawPriorityPaths as readonly string[]);
  for (const priorityPath of priorityPaths) {
    await authorize(priorityPath, "open_repository");
  }

  const capability: RepositoryReadCapability = {
    listDirectory: (listInput = {}) =>
      listDirectory(
        listInput,
        canonicalRoot,
        rootIdentity,
        fileSystem,
        platform,
        authorize,
      ),
    searchText: (searchInput) =>
      searchText(
        searchInput,
        canonicalRoot,
        rootIdentity,
        fileSystem,
        platform,
        authorize,
      ),
    readSnippet: (snippetInput) =>
      readSnippet(
        snippetInput,
        canonicalRoot,
        rootIdentity,
        fileSystem,
        platform,
        authorize,
      ),
  };
  return Object.freeze(capability);
}

export function isPathContained(
  root: string,
  target: string,
  platform: NodeJS.Platform,
): boolean {
  const pathApi = pathForPlatform(platform);
  const normalizedRoot = normalizeForComparison(root, platform);
  const normalizedTarget = normalizeForComparison(target, platform);
  const relative = pathApi.relative(normalizedRoot, normalizedTarget);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

async function listDirectory(
  input: ListDirectoryInput,
  canonicalRoot: string,
  rootIdentity: string,
  fileSystem: RepositoryFileSystem,
  platform: NodeJS.Platform,
  authorize: (
    requestedPath: string,
    operation: RepositoryOperation,
  ) => Promise<AuthorizedTarget>,
): Promise<DirectoryListing> {
  const parsedInput = ListDirectoryInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw invalidRequest(
      "list_directory",
      "Directory listing input is invalid.",
    );
  }
  const maxEntries = boundedInteger(
    parsedInput.data.max_entries,
    REPOSITORY_OPERATION_LIMITS.default_list_entries,
    REPOSITORY_OPERATION_LIMITS.max_list_entries,
    "list_directory",
  );
  const target = await authorize(
    parsedInput.data.path ?? ".",
    "list_directory",
  );
  if (!target.stats.isDirectory()) {
    throw invalidRequest(
      "list_directory",
      "Directory listing requires a directory.",
    );
  }
  const entries = await safeReadDirectory(
    target.canonicalPath,
    "list_directory",
    fileSystem,
  );
  await verifyStableTarget(
    canonicalRoot,
    rootIdentity,
    target,
    "list_directory",
    fileSystem,
  );
  const sorted = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  const visible = sorted.slice(0, maxEntries).map((entry): DirectoryEntry => ({
    name: entry.name,
    path: portableRelativePath(
      canonicalRoot,
      pathForPlatform(platform).join(target.canonicalPath, entry.name),
      platform,
    ),
    kind: directoryEntryKind(entry),
  }));
  return deepFreeze({
    entries: visible,
    truncated: sorted.length > visible.length,
  });
}

async function searchText(
  input: SearchTextInput,
  canonicalRoot: string,
  rootIdentity: string,
  fileSystem: RepositoryFileSystem,
  platform: NodeJS.Platform,
  authorize: (
    requestedPath: string,
    operation: RepositoryOperation,
  ) => Promise<AuthorizedTarget>,
): Promise<TextSearchResult> {
  const parsedInput = SearchTextInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw invalidRequest("search_text", "Text search input is invalid.");
  }
  const matcher = createMatcher(
    parsedInput.data.query,
    parsedInput.data.mode,
    parsedInput.data.case_sensitive,
  );
  const maxResults = boundedInteger(
    parsedInput.data.max_results,
    REPOSITORY_OPERATION_LIMITS.default_search_results,
    REPOSITORY_OPERATION_LIMITS.max_search_results,
    "search_text",
  );
  const initial = await authorize(parsedInput.data.path ?? ".", "search_text");
  const pendingDirectories = initial.stats.isDirectory()
    ? [initial.canonicalPath]
    : [];
  const pendingFiles = initial.stats.isFile() ? [initial.canonicalPath] : [];
  if (pendingDirectories.length === 0 && pendingFiles.length === 0) {
    throw invalidRequest(
      "search_text",
      "Text search requires a file or directory.",
    );
  }

  const matches: TextSearchMatch[] = [];
  let visitedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;

  while (
    (pendingDirectories.length > 0 || pendingFiles.length > 0) &&
    matches.length < maxResults
  ) {
    while (pendingDirectories.length > 0 && pendingFiles.length === 0) {
      const directoryPath = pendingDirectories.shift();
      if (directoryPath === undefined) break;
      const directory = await authorize(directoryPath, "search_text");
      const entries = await safeReadDirectory(
        directory.canonicalPath,
        "search_text",
        fileSystem,
      );
      await verifyStableTarget(
        canonicalRoot,
        rootIdentity,
        directory,
        "search_text",
        fileSystem,
      );
      for (const entry of [...entries].sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
      )) {
        const childPath = pathForPlatform(platform).join(
          directory.canonicalPath,
          entry.name,
        );
        if (entry.isFile()) pendingFiles.push(childPath);
        if (entry.isDirectory()) pendingDirectories.push(childPath);
      }
    }

    const filePath = pendingFiles.shift();
    if (filePath === undefined) continue;
    if (visitedFiles >= REPOSITORY_OPERATION_LIMITS.max_search_files) {
      truncated = true;
      break;
    }
    const file = await authorize(filePath, "search_text");
    if (!file.stats.isFile()) continue;
    visitedFiles += 1;
    if (
      file.stats.size > REPOSITORY_OPERATION_LIMITS.max_read_file_bytes ||
      scannedBytes + file.stats.size >
        REPOSITORY_OPERATION_LIMITS.max_search_bytes
    ) {
      truncated = true;
      continue;
    }
    const buffer = await readStableFile(
      canonicalRoot,
      rootIdentity,
      file,
      "search_text",
      fileSystem,
    );
    scannedBytes += buffer.byteLength;
    let text: string;
    try {
      text = decodeText(buffer, "search_text");
    } catch (error: unknown) {
      if (
        initial.stats.isDirectory() &&
        error instanceof RepositoryAccessError &&
        error.code === "invalid_request"
      ) {
        truncated = true;
        continue;
      }
      throw error;
    }
    const lines = text.split(/\r?\n/u);
    for (const [lineIndex, line] of lines.entries()) {
      const boundedLine = line.slice(
        0,
        REPOSITORY_OPERATION_LIMITS.max_search_line_characters,
      );
      if (matcher(boundedLine)) {
        matches.push({
          path: portableRelativePath(
            canonicalRoot,
            file.canonicalPath,
            platform,
          ),
          line: lineIndex + 1,
          preview: boundedLine.slice(0, 500),
        });
      }
      if (matches.length >= maxResults) {
        truncated =
          lineIndex < lines.length - 1 ||
          pendingFiles.length > 0 ||
          pendingDirectories.length > 0;
        break;
      }
    }
  }

  return deepFreeze({
    matches,
    visited_files: visitedFiles,
    scanned_bytes: scannedBytes,
    truncated,
  });
}

async function readSnippet(
  input: ReadSnippetInput,
  canonicalRoot: string,
  rootIdentity: string,
  fileSystem: RepositoryFileSystem,
  platform: NodeJS.Platform,
  authorize: (
    requestedPath: string,
    operation: RepositoryOperation,
  ) => Promise<AuthorizedTarget>,
): Promise<TextSnippet> {
  const parsedInput = ReadSnippetInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw invalidRequest("read_snippet", "Snippet input is invalid.");
  }
  const startLine = boundedInteger(
    parsedInput.data.start_line,
    1,
    Number.MAX_SAFE_INTEGER,
    "read_snippet",
  );
  const lineCount = boundedInteger(
    parsedInput.data.line_count,
    REPOSITORY_OPERATION_LIMITS.default_snippet_lines,
    REPOSITORY_OPERATION_LIMITS.max_snippet_lines,
    "read_snippet",
  );
  const target = await authorize(parsedInput.data.path, "read_snippet");
  if (!target.stats.isFile()) {
    throw invalidRequest(
      "read_snippet",
      "Snippet reading requires a regular file.",
    );
  }
  if (target.stats.size > REPOSITORY_OPERATION_LIMITS.max_read_file_bytes) {
    throw new RepositoryAccessError(
      "context_limit_exceeded",
      "read_snippet",
      "The requested file exceeds the bounded read size.",
    );
  }
  const buffer = await readStableFile(
    canonicalRoot,
    rootIdentity,
    target,
    "read_snippet",
    fileSystem,
  );
  const lines = decodeText(buffer, "read_snippet").split(/\r?\n/u);
  if (startLine > lines.length) {
    throw invalidRequest(
      "read_snippet",
      "The requested start line is outside the file.",
    );
  }
  const requestedLines = lines.slice(startLine - 1, startLine - 1 + lineCount);
  const bounded = boundSnippetLines(requestedLines);
  const endLine = startLine + bounded.lines.length - 1;
  return deepFreeze({
    path: portableRelativePath(canonicalRoot, target.canonicalPath, platform),
    start_line: startLine,
    end_line: endLine,
    content: bounded.lines.join("\n"),
    truncated:
      bounded.truncated || startLine - 1 + requestedLines.length < lines.length,
  });
}

function createMatcher(
  queryInput: string,
  mode: "literal" | "regex" | undefined,
  caseSensitiveInput: boolean | undefined,
): (line: string) => boolean {
  if (
    queryInput.length === 0 ||
    queryInput.length >
      REPOSITORY_OPERATION_LIMITS.max_search_pattern_characters
  ) {
    throw invalidRequest("search_text", "Search query is empty or too long.");
  }
  const caseSensitive = caseSensitiveInput ?? true;
  if ((mode ?? "literal") === "literal") {
    const query = caseSensitive
      ? queryInput
      : queryInput.toLocaleLowerCase("en");
    return (line) =>
      (caseSensitive ? line : line.toLocaleLowerCase("en")).includes(query);
  }
  if (!isSafeRegularExpression(queryInput)) {
    throw invalidRequest(
      "search_text",
      "Regular expression uses an unsupported construct.",
    );
  }
  let expression: RegExp;
  try {
    expression = new RegExp(queryInput, caseSensitive ? "u" : "iu");
  } catch {
    throw invalidRequest("search_text", "Regular expression is invalid.");
  }
  return (line) => expression.test(line);
}

function isSafeRegularExpression(source: string): boolean {
  if (source.includes("(") || source.includes(")") || /\\[1-9]/u.test(source)) {
    return false;
  }
  const quantifiers = source.match(/[*+?{]/gu)?.length ?? 0;
  return quantifiers <= 4;
}

function boundSnippetLines(lines: readonly string[]): {
  readonly lines: readonly string[];
  readonly truncated: boolean;
} {
  const selected: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const separatorBytes = selected.length === 0 ? 0 : 1;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (
      bytes + separatorBytes + lineBytes >
      REPOSITORY_OPERATION_LIMITS.max_snippet_bytes
    ) {
      if (selected.length === 0) {
        selected.push(
          Buffer.from(line, "utf8")
            .subarray(0, REPOSITORY_OPERATION_LIMITS.max_snippet_bytes)
            .toString("utf8"),
        );
      }
      return { lines: selected, truncated: true };
    }
    selected.push(line);
    bytes += separatorBytes + lineBytes;
  }
  return { lines: selected, truncated: false };
}

async function canonicalizeRoot(
  root: string,
  fileSystem: RepositoryFileSystem,
): Promise<string> {
  if (
    typeof root !== "string" ||
    root.trim().length === 0 ||
    root.includes("\0")
  ) {
    throw repositoryNotFound("open_repository");
  }
  try {
    return await fileSystem.realpath(root);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      throw repositoryNotFound("open_repository");
    }
    throw accessDenied("open_repository");
  }
}

async function verifyRoot(
  canonicalRoot: string,
  expectedIdentity: string,
  operation: RepositoryOperation,
  fileSystem: RepositoryFileSystem,
): Promise<void> {
  const current = await safeStat(canonicalRoot, operation, fileSystem);
  if (!current.isDirectory() || identityOf(current) !== expectedIdentity) {
    throw accessDenied(operation);
  }
}

async function verifyStableTarget(
  canonicalRoot: string,
  rootIdentity: string,
  target: AuthorizedTarget,
  operation: RepositoryOperation,
  fileSystem: RepositoryFileSystem,
): Promise<void> {
  await verifyRoot(canonicalRoot, rootIdentity, operation, fileSystem);
  const current = await safeStat(target.canonicalPath, operation, fileSystem);
  if (identityOf(current) !== identityOf(target.stats)) {
    throw accessDenied(operation);
  }
}

async function readStableFile(
  canonicalRoot: string,
  rootIdentity: string,
  target: AuthorizedTarget,
  operation: RepositoryOperation,
  fileSystem: RepositoryFileSystem,
): Promise<Buffer> {
  let contents: Buffer;
  try {
    contents = await fileSystem.readFile(target.canonicalPath);
  } catch {
    throw accessDenied(operation);
  }
  await verifyStableTarget(
    canonicalRoot,
    rootIdentity,
    target,
    operation,
    fileSystem,
  );
  return contents;
}

async function safeReadDirectory(
  directoryPath: string,
  operation: RepositoryOperation,
  fileSystem: RepositoryFileSystem,
): Promise<readonly RepositoryDirectoryEntry[]> {
  try {
    return await fileSystem.readdir(directoryPath, { withFileTypes: true });
  } catch {
    throw accessDenied(operation);
  }
}

async function safeStat(
  targetPath: string,
  operation: RepositoryOperation,
  fileSystem: RepositoryFileSystem,
): Promise<RepositoryFileStats> {
  try {
    return await fileSystem.stat(targetPath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      throw repositoryNotFound(operation);
    }
    throw accessDenied(operation);
  }
}

function decodeText(buffer: Buffer, operation: RepositoryOperation): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw new Error("unsupported text");
    return text;
  } catch {
    throw invalidRequest(
      operation,
      "The requested content is not supported text.",
    );
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  operation: RepositoryOperation,
): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) {
    throw invalidRequest(
      operation,
      "The requested operation limit is invalid.",
    );
  }
  return selected;
}

function directoryEntryKind(
  entry: RepositoryDirectoryEntry,
): DirectoryEntry["kind"] {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

function identityOf(stats: RepositoryFileStats): string {
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

function portableRelativePath(
  root: string,
  target: string,
  platform: NodeJS.Platform,
): string {
  const relative = pathForPlatform(platform).relative(root, target);
  return relative === "" ? "." : relative.replaceAll("\\", "/");
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizeForComparison(
  value: string,
  platform: NodeJS.Platform,
): string {
  const normalized = pathForPlatform(platform).resolve(value);
  return platform === "win32" ? normalized.toLocaleLowerCase("en") : normalized;
}

function repositoryNotFound(
  operation: RepositoryOperation,
): RepositoryAccessError {
  return new RepositoryAccessError(
    "repository_not_found",
    operation,
    "The requested repository path does not exist or is invalid.",
  );
}

function accessDenied(operation: RepositoryOperation): RepositoryAccessError {
  return new RepositoryAccessError(
    "repository_access_denied",
    operation,
    "Repository access was denied by the canonical root boundary.",
  );
}

function invalidRequest(
  operation: RepositoryOperation,
  message: string,
): RepositoryAccessError {
  return new RepositoryAccessError("invalid_request", operation, message);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}
