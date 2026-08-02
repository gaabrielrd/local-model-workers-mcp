import {
  PatchPolicyError,
  createRepositoryPatchPathInspector,
} from "../test-proposal/index.js";

import {
  DOCS_GENERATION_MAX_CHANGED_LINES,
  DOCS_GENERATION_MAX_FILES,
  DOCS_GENERATION_MAX_INPUT_BYTES,
} from "./contracts.js";

export interface ParsedDocsPatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changed_lines: number;
  readonly is_new: boolean;
}

export interface ValidatedDocsPatch {
  readonly patch: string;
  readonly files: readonly ParsedDocsPatchFile[];
  readonly changed_lines: number;
}

export interface ValidateDocsPatchInput {
  readonly patch: string;
  readonly repositoryRoot: string;
  readonly allowedFiles: readonly string[];
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
  readonly inspectPath?: (path: string) => Promise<"safe" | "unsafe">;
}

export async function validateDocsPatch(
  input: ValidateDocsPatchInput,
): Promise<ValidatedDocsPatch> {
  const maxFiles = input.maxFiles ?? DOCS_GENERATION_MAX_FILES;
  const maxChangedLines =
    input.maxChangedLines ?? DOCS_GENERATION_MAX_CHANGED_LINES;

  if (
    Buffer.byteLength(input.patch, "utf8") > DOCS_GENERATION_MAX_INPUT_BYTES
  ) {
    throw new PatchPolicyError(
      "patch_limit_exceeded",
      "The proposed patch exceeds the parser byte limit.",
    );
  }
  const files = parseDocsPatch(input.patch);
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
        "The proposed patch modifies files outside the requested documentation scope.",
        [file.path],
      );
    }
    if (!file.is_new && file.deletions > 0 && !isDocsDirectoryPath(file.path)) {
      throw new PatchPolicyError(
        "patch_not_allowed",
        "The proposed patch removes functional code lines; only comments and documentation may change.",
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

  return { patch: input.patch, files, changed_lines: changedLines };
}

export function docsMarkdownPathForTarget(target: string): string {
  let normalized = target.replaceAll("\\", "/").replace(/^\.\//u, "");
  normalized = normalized.replace(/^\/+|\/+$/gu, "");
  normalized = normalized.replace(/\.(ts|tsx|js|jsx|py)$/iu, "");
  const slug = normalized.replaceAll("/", "-");
  return `docs/${slug}.md`;
}

export function isDocsDirectoryPath(candidatePath: string): boolean {
  const normalized = candidatePath.replaceAll("\\", "/");
  return (
    normalized.startsWith("docs/") &&
    normalized.endsWith(".md") &&
    !normalized.includes("..")
  );
}

function parseDocsPatch(patch: string): ParsedDocsPatchFile[] {
  if (
    patch.length === 0 ||
    patch.includes("\r") ||
    patch.includes("GIT binary patch")
  ) {
    throw malformed();
  }
  const lines = patch.split("\n");
  const files: ParsedDocsPatchFile[] = [];
  let current:
    | {
        readonly path: string;
        additions: number;
        deletions: number;
        isNew: boolean;
        hunks: number;
      }
    | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) files.push(finishFile(current));
      const match = /^diff --git a\/([^\s"]+) b\/([^\s"]+)$/u.exec(line);
      if (
        match?.[1] === undefined ||
        match[2] === undefined ||
        match[1] !== match[2]
      ) {
        throw malformed();
      }
      current = {
        path: match[2],
        additions: 0,
        deletions: 0,
        isNew: false,
        hunks: 0,
      };
      continue;
    }
    if (current === undefined) {
      if (line.length > 0) throw malformed();
      continue;
    }
    if (line === "new file mode 100644") {
      current.isNew = true;
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
  readonly isNew: boolean;
  readonly hunks: number;
}): ParsedDocsPatchFile {
  if (current.hunks === 0) throw malformed();
  return {
    path: current.path,
    additions: current.additions,
    deletions: current.deletions,
    changed_lines: current.additions + current.deletions,
    is_new: current.isNew,
  };
}

function malformed(): PatchPolicyError {
  return new PatchPolicyError(
    "malformed_patch",
    "The unified diff is malformed.",
  );
}
