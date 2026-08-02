import {
  PatchPolicyError,
  createRepositoryPatchPathInspector,
} from "../test-proposal/index.js";
import {
  LINT_FIX_CONTEXT_RADIUS,
  LINT_FIX_MAX_CHANGED_LINES,
  LINT_FIX_MAX_FILES,
} from "./contracts.js";

export interface LintPatchHunk {
  readonly new_start: number;
  readonly new_lines: number;
}

export interface ParsedLintPatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changed_lines: number;
  readonly hunks: readonly LintPatchHunk[];
}

export interface ValidatedLintPatch {
  readonly patch: string;
  readonly files: readonly ParsedLintPatchFile[];
  readonly changed_lines: number;
}

export interface ValidateLintPatchInput {
  readonly patch: string;
  readonly repositoryRoot: string;
  readonly allowedFiles: readonly string[];
  readonly violationLines: ReadonlyMap<string, readonly number[]>;
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
  readonly contextRadius?: number;
  readonly inspectPath?: (path: string) => Promise<"safe" | "unsafe">;
}

export async function validateLintPatch(
  input: ValidateLintPatchInput,
): Promise<ValidatedLintPatch> {
  const maxFiles = input.maxFiles ?? LINT_FIX_MAX_FILES;
  const maxChangedLines = input.maxChangedLines ?? LINT_FIX_MAX_CHANGED_LINES;
  const contextRadius = input.contextRadius ?? LINT_FIX_CONTEXT_RADIUS;

  if (Buffer.byteLength(input.patch, "utf8") > 2 * 1_024 * 1_024) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch exceeds the parser byte limit.",
    );
  }
  const files = parseLintPatch(input.patch);
  if (files.length > maxFiles) {
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
  if (changedLines > maxChangedLines) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch changes too many lines.",
      files.map((file) => file.path),
    );
  }

  const allowed = new Set(input.allowedFiles);
  const inspectPath =
    input.inspectPath ??
    createRepositoryPatchPathInspector(input.repositoryRoot);
  for (const file of files) {
    if (!allowed.has(file.path)) {
      throw new PatchPolicyError(
        "patch_not_allowed",
        "The proposed patch modifies files not reported by the linter.",
        [file.path],
      );
    }
    if ((await inspectPath(file.path)) !== "safe") {
      throw new PatchPolicyError(
        "patch_not_allowed",
        "The proposed patch contains unsafe paths.",
        [file.path],
      );
    }
  }

  for (const file of files) {
    const windows = allowedWindows(
      input.violationLines.get(file.path) ?? [],
      contextRadius,
    );
    for (const hunk of file.hunks) {
      if (!intersectsWindow(hunk, windows)) {
        throw new PatchPolicyError(
          "patch_not_allowed",
          `The proposed patch changes lines outside the reported violation area in ${file.path}.`,
          [file.path],
        );
      }
    }
  }

  return { patch: input.patch, files, changed_lines: changedLines };
}

function parseLintPatch(patch: string): ParsedLintPatchFile[] {
  if (
    patch.length === 0 ||
    patch.includes("\r") ||
    patch.includes("GIT binary patch")
  ) {
    throw malformed();
  }
  const lines = patch.split("\n");
  const files: ParsedLintPatchFile[] = [];
  let current:
    | {
        readonly path: string;
        additions: number;
        deletions: number;
        hunks: LintPatchHunk[];
      }
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
      current = { path: match[2], additions: 0, deletions: 0, hunks: [] };
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
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (match?.[3] === undefined) throw malformed();
      current.hunks.push({
        new_start: Number(match[3]),
        new_lines: match[4] === undefined ? 1 : Number(match[4]),
      });
    } else if (
      current.hunks.length > 0 &&
      line.startsWith("+") &&
      !line.startsWith("+++")
    ) {
      current.additions += 1;
    } else if (
      current.hunks.length > 0 &&
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
  readonly hunks: readonly LintPatchHunk[];
}): ParsedLintPatchFile {
  if (current.hunks.length === 0) throw malformed();
  return {
    path: current.path,
    additions: current.additions,
    deletions: current.deletions,
    changed_lines: current.additions + current.deletions,
    hunks: [...current.hunks],
  };
}

function allowedWindows(
  lines: readonly number[],
  radius: number,
): readonly (readonly [number, number])[] {
  const clamped = lines
    .map((line) => Math.max(1, line - radius))
    .map(
      (start, index) =>
        [start, Math.max(start, lines[index]! + radius)] as const,
    )
    .sort((left, right) => left[0] - right[0]);
  const merged: (readonly [number, number])[] = [];
  for (const window of clamped) {
    const previous = merged.at(-1);
    if (previous !== undefined && window[0] <= previous[1] + 1) {
      merged[merged.length - 1] = [
        previous[0],
        Math.max(previous[1], window[1]),
      ];
    } else {
      merged.push(window);
    }
  }
  return merged;
}

function intersectsWindow(
  hunk: LintPatchHunk,
  windows: readonly (readonly [number, number])[],
): boolean {
  if (windows.length === 0) return false;
  const start = hunk.new_start;
  const end = hunk.new_start + Math.max(1, hunk.new_lines) - 1;
  return windows.some((window) => start <= window[1] && end >= window[0]);
}

function malformed(): PatchPolicyError {
  return new PatchPolicyError(
    "malformed_patch",
    "The unified diff is malformed.",
  );
}
