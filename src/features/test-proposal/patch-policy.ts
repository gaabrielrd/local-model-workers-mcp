import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { isPathContained } from "../repository-exploration/index.js";

export interface ParsedPatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changed_lines: number;
}

export interface ValidatedTestPatch {
  readonly patch: string;
  readonly files: readonly ParsedPatchFile[];
  readonly changed_lines: number;
}

export type PatchFailureCode =
  "malformed_patch" | "patch_not_allowed" | "patch_limit_exceeded";

export class PatchPolicyError extends Error {
  public readonly code: PatchFailureCode;
  public readonly affectedPaths: readonly string[];

  public constructor(
    code: PatchFailureCode,
    message: string,
    affectedPaths: readonly string[] = [],
  ) {
    super(message);
    this.name = "PatchPolicyError";
    this.code = code;
    this.affectedPaths = affectedPaths;
  }
}

export interface ValidateTestPatchInput {
  readonly patch: string;
  readonly repositoryRoot: string;
  readonly maxFiles: number;
  readonly maxChangedLines: number;
  readonly inspectPath?: (path: string) => Promise<"safe" | "unsafe">;
}

export async function validateTestPatch(
  input: ValidateTestPatchInput,
): Promise<ValidatedTestPatch> {
  if (Buffer.byteLength(input.patch, "utf8") > 2 * 1_024 * 1_024) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch exceeds the parser byte limit.",
    );
  }
  const files = parseUnifiedDiff(input.patch);
  if (files.length > input.maxFiles) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch changes too many files.",
      files.map((file) => file.path),
    );
  }
  const changedLines = files.reduce(
    (total, file) => total + file.changed_lines,
    0,
  );
  if (changedLines > input.maxChangedLines) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch changes too many lines.",
      files.map((file) => file.path),
    );
  }
  const inspectPath =
    input.inspectPath ??
    createRepositoryPatchPathInspector(input.repositoryRoot);
  const unsafe: string[] = [];
  for (const file of files) {
    if (
      !isTestOnlyPath(file.path) ||
      (await inspectPath(file.path)) !== "safe"
    ) {
      unsafe.push(file.path);
    }
  }
  if (unsafe.length > 0) {
    throw new PatchPolicyError(
      "patch_not_allowed",
      "The proposed patch contains production, ambiguous, or unsafe paths.",
      unsafe,
    );
  }
  return { patch: input.patch, files, changed_lines: changedLines };
}

export function isTestOnlyPath(candidatePath: string): boolean {
  const normalized = candidatePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return false;
  }
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  const testDirectory = segments.some((segment) =>
    [
      "test",
      "tests",
      "__tests__",
      "spec",
      "specs",
      "fixture",
      "fixtures",
      "__fixtures__",
      "mock",
      "mocks",
      "__mocks__",
    ].includes(segment),
  );
  const testFilename =
    /(?:^test_.*|.*_test)\.py$/u.test(basename) ||
    /\.(?:test|spec)\.[a-z0-9]+$/u.test(basename);
  const testOnlyConfig =
    /^(?:jest|vitest)\.config\.[a-z0-9]+$/u.test(basename) ||
    basename === "pytest.ini" ||
    basename === "conftest.py";
  return testDirectory || testFilename || testOnlyConfig;
}

export function createRepositoryPatchPathInspector(
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform,
): (candidatePath: string) => Promise<"safe" | "unsafe"> {
  return async (candidatePath) => {
    const pathApi = platform === "win32" ? path.win32 : path;
    let root: string;
    try {
      root = await realpath(repositoryRoot);
    } catch {
      return "unsafe";
    }
    const target = pathApi.resolve(root, candidatePath);
    if (!isPathContained(root, target, platform)) {
      return "unsafe";
    }
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        return "unsafe";
      }
      const canonical = await realpath(target);
      return isPathContained(root, canonical, platform) ? "safe" : "unsafe";
    } catch (error: unknown) {
      if (!isFileSystemError(error, "ENOENT")) {
        return "unsafe";
      }
      try {
        const parent = await realpath(pathApi.dirname(target));
        return isPathContained(root, parent, platform) ? "safe" : "unsafe";
      } catch {
        return "unsafe";
      }
    }
  };
}

function parseUnifiedDiff(patch: string): ParsedPatchFile[] {
  if (
    patch.length === 0 ||
    patch.includes("\r") ||
    patch.includes("GIT binary patch")
  ) {
    throw malformed();
  }
  const lines = patch.split("\n");
  const files: ParsedPatchFile[] = [];
  let current:
    | { path: string; additions: number; deletions: number; hunks: number }
    | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) {
        files.push(finishFile(current));
      }
      const match = /^diff --git a\/([^\s"]+) b\/([^\s"]+)$/u.exec(line);
      if (
        match?.[1] === undefined ||
        match[2] === undefined ||
        match[1] !== match[2]
      ) {
        throw malformed();
      }
      current = { path: match[2], additions: 0, deletions: 0, hunks: 0 };
      continue;
    }
    if (current === undefined) {
      if (line.length > 0) throw malformed();
      continue;
    }
    if (
      line.startsWith("rename ") ||
      line.startsWith("copy ") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("Binary files")
    ) {
      throw new PatchPolicyError(
        "patch_not_allowed",
        "Rename, copy, deletion, and binary patches are not allowed.",
        [current.path],
      );
    }
    if (
      line.startsWith("--- ") &&
      line !== `--- a/${current.path}` &&
      line !== "--- /dev/null"
    ) {
      throw malformed();
    }
    if (line.startsWith("+++ ") && line !== `+++ b/${current.path}`) {
      throw new PatchPolicyError(
        "patch_not_allowed",
        "File deletion and mismatched patch paths are not allowed.",
        [current.path],
      );
    }
    if (line.startsWith("@@ ")) {
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(line)) throw malformed();
      current.hunks += 1;
    } else if (
      current.hunks > 0 &&
      line.startsWith("+") &&
      !line.startsWith("+++")
    ) {
      current.additions += 1;
    } else if (
      current.hunks > 0 &&
      line.startsWith("-") &&
      !line.startsWith("---")
    ) {
      current.deletions += 1;
    }
  }
  if (current !== undefined) files.push(finishFile(current));
  if (
    files.length === 0 ||
    new Set(files.map((file) => file.path)).size !== files.length
  ) {
    throw malformed();
  }
  return files;
}

function finishFile(current: {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: number;
}): ParsedPatchFile {
  if (current.hunks === 0) throw malformed();
  return {
    path: current.path,
    additions: current.additions,
    deletions: current.deletions,
    changed_lines: current.additions + current.deletions,
  };
}

function malformed(): PatchPolicyError {
  return new PatchPolicyError(
    "malformed_patch",
    "The unified diff is malformed.",
  );
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
