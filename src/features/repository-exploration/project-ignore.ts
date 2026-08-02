import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { isPathContained } from "./repository-access.js";

export const PROJECT_IGNORE_FILENAME = ".mcp-agent-ignore";

export interface ProjectIgnorePolicy {
  excludes(repositoryRelativePath: string): boolean;
  readonly ignored_negation_rules: number;
}

export interface ProjectIgnoreFileSystem {
  realpath(targetPath: string): Promise<string>;
  readFile(targetPath: string, encoding: "utf8"): Promise<string>;
}

export class ProjectIgnorePolicyError extends Error {
  public constructor() {
    super("Project ignore policy is invalid or inaccessible.");
    this.name = "ProjectIgnorePolicyError";
  }
}

const nodeProjectIgnoreFileSystem: ProjectIgnoreFileSystem = {
  realpath,
  readFile,
};

export async function loadProjectIgnorePolicy(
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform,
  fileSystem: ProjectIgnoreFileSystem = nodeProjectIgnoreFileSystem,
): Promise<ProjectIgnorePolicy> {
  const canonicalRoot = await canonicalize(repositoryRoot, fileSystem);
  const requestedPath = pathForPlatform(platform).join(
    canonicalRoot,
    PROJECT_IGNORE_FILENAME,
  );
  let canonicalPolicyPath: string;
  try {
    canonicalPolicyPath = await fileSystem.realpath(requestedPath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return parseProjectIgnorePolicy("");
    }
    throw new ProjectIgnorePolicyError();
  }
  if (!isPathContained(canonicalRoot, canonicalPolicyPath, platform)) {
    throw new ProjectIgnorePolicyError();
  }
  try {
    return parseProjectIgnorePolicy(
      await fileSystem.readFile(canonicalPolicyPath, "utf8"),
    );
  } catch (error: unknown) {
    if (error instanceof ProjectIgnorePolicyError) throw error;
    throw new ProjectIgnorePolicyError();
  }
}

export function parseProjectIgnorePolicy(
  contents: string,
): ProjectIgnorePolicy {
  if (
    contents.includes("\0") ||
    Buffer.byteLength(contents, "utf8") > 64 * 1_024
  ) {
    throw new ProjectIgnorePolicyError();
  }
  const expressions: RegExp[] = [];
  let ignoredNegations = 0;
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      ignoredNegations += 1;
      continue;
    }
    if (
      line.length > 512 ||
      line.includes("\\") ||
      line.split("/").includes("..") ||
      /^[A-Za-z]:/u.test(line)
    ) {
      throw new ProjectIgnorePolicyError();
    }
    expressions.push(globToExpression(line));
  }
  return Object.freeze({
    ignored_negation_rules: ignoredNegations,
    excludes(repositoryRelativePath: string): boolean {
      const normalized = normalizeRelativePath(repositoryRelativePath);
      return expressions.some((expression) => expression.test(normalized));
    },
  });
}

function globToExpression(patternInput: string): RegExp {
  let pattern = patternInput;
  const directoryPattern = pattern.endsWith("/");
  if (directoryPattern) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  if (pattern.length === 0) throw new ProjectIgnorePolicyError();

  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegularExpression(character ?? "");
    }
  }

  const hasSlash = pattern.includes("/");
  const prefix = anchored || hasSlash ? "^" : "(?:^|/)";
  const suffix = directoryPattern ? "(?:/.*)?$" : "$";
  return new RegExp(`${prefix}${source}${suffix}`, "u");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new ProjectIgnorePolicyError();
  }
  return normalized;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function canonicalize(
  repositoryRoot: string,
  fileSystem: ProjectIgnoreFileSystem,
): Promise<string> {
  try {
    return await fileSystem.realpath(repositoryRoot);
  } catch {
    throw new ProjectIgnorePolicyError();
  }
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
