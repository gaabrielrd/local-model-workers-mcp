import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { isPathContained } from "../repository-exploration/index.js";

export type PatchApplyErrorCode =
  "malformed_patch" | "path_not_allowed" | "not_applicable";

export class PatchApplyError extends Error {
  public readonly code: PatchApplyErrorCode;
  public readonly affectedPath: string | undefined;

  public constructor(
    code: PatchApplyErrorCode,
    message: string,
    affectedPath?: string,
  ) {
    super(message);
    this.name = "PatchApplyError";
    this.code = code;
    this.affectedPath = affectedPath;
  }
}

export interface ApplyValidatedPatchInput {
  readonly root: string;
  /**
   * Only the unified diff is read — it is re-parsed here — so any validated
   * patch type satisfies this structurally without coupling to one feature.
   */
  readonly patch: { readonly patch: string };
}

interface HunkLine {
  readonly kind: "context" | "add" | "delete";
  readonly text: string;
}

interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly HunkLine[];
}

interface MutableHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  lines: HunkLine[];
}

interface ParsedFile {
  readonly path: string;
  readonly isNew: boolean;
  readonly hunks: readonly Hunk[];
}

export async function applyValidatedPatch(
  input: ApplyValidatedPatchInput,
): Promise<void> {
  const files = parsePatch(input.patch.patch);
  const sandboxRoot = await realpath(input.root);
  for (const file of files) {
    if (file.path.split(/[/\\]/u).includes("..")) {
      throw new PatchApplyError(
        "path_not_allowed",
        "The patch path contains a parent directory segment.",
        file.path,
      );
    }
    const absolute = path.resolve(sandboxRoot, file.path);
    if (!isPathContained(sandboxRoot, absolute, process.platform)) {
      throw new PatchApplyError(
        "path_not_allowed",
        "The patch path escapes the sandbox root.",
        file.path,
      );
    }
    const canonicalTarget = await resolveContainedTarget(
      sandboxRoot,
      absolute,
      file.isNew,
    );
    if (canonicalTarget === undefined) {
      throw new PatchApplyError(
        "path_not_allowed",
        "The patch path resolves outside the sandbox root.",
        file.path,
      );
    }
    let existing = "";
    let existed = false;
    try {
      existing = await readFile(canonicalTarget, "utf8");
      existed = true;
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) {
        throw error;
      }
    }
    if (!existed && !file.isNew) {
      throw new PatchApplyError(
        "not_applicable",
        "The patched file does not exist in the sandbox.",
        file.path,
      );
    }
    const hadFinalNewline = existing.endsWith("\n");
    const lines =
      existed && existing.length > 0
        ? existing.replace(/\n$/u, "").split("\n")
        : [];
    const applied = applyHunks(lines, file.isNew, file.hunks);
    await mkdir(path.dirname(canonicalTarget), { recursive: true });
    const trailing = file.isNew || hadFinalNewline ? "\n" : "";
    await writeFile(
      canonicalTarget,
      `${applied.join("\n")}${trailing}`,
      "utf8",
    );
  }
}

async function resolveContainedTarget(
  sandboxRoot: string,
  absoluteTarget: string,
  isNew: boolean,
): Promise<string | undefined> {
  try {
    const canonical = await realpath(absoluteTarget);
    return isPathContained(sandboxRoot, canonical, process.platform)
      ? canonical
      : undefined;
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) {
      return undefined;
    }
  }
  if (!isNew) {
    return undefined;
  }
  let candidate = path.dirname(absoluteTarget);
  const missingSegments = [path.basename(absoluteTarget)];
  while (true) {
    if (path.dirname(candidate) === candidate) {
      return undefined;
    }
    try {
      const canonicalParent = await realpath(candidate);
      if (isPathContained(sandboxRoot, canonicalParent, process.platform)) {
        return path.join(canonicalParent, ...missingSegments);
      }
      return undefined;
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) {
        return undefined;
      }
      missingSegments.unshift(path.basename(candidate));
      candidate = path.dirname(candidate);
    }
  }
}

function parsePatch(patch: string): readonly ParsedFile[] {
  if (
    patch.length === 0 ||
    patch.includes("\r") ||
    patch.includes("GIT binary patch")
  ) {
    throw new PatchApplyError(
      "malformed_patch",
      "The patch is not a text unified diff.",
    );
  }
  const lines = patch.split("\n");
  const files: ParsedFile[] = [];
  let current: { path: string; isNew: boolean; hunks: Hunk[] } | undefined;
  let hunk: MutableHunk | undefined;

  const closeHunk = (): void => {
    if (hunk !== undefined) {
      if (hunk.lines.length === 0) {
        throw new PatchApplyError(
          "malformed_patch",
          "A hunk contains no lines.",
        );
      }
      current?.hunks.push({
        oldStart: hunk.oldStart,
        oldCount: hunk.oldCount,
        newStart: hunk.newStart,
        newCount: hunk.newCount,
        lines: [...hunk.lines],
      });
      hunk = undefined;
    }
  };
  const closeFile = (): void => {
    closeHunk();
    if (current !== undefined) {
      if (current.hunks.length === 0) {
        throw new PatchApplyError(
          "malformed_patch",
          `The patch has no hunks for ${current.path}.`,
        );
      }
      files.push(current);
      current = undefined;
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      const match = /^diff --git a\/([^\s"]+) b\/([^\s"]+)$/u.exec(line);
      if (
        match?.[1] === undefined ||
        match[2] === undefined ||
        match[1] !== match[2]
      ) {
        throw new PatchApplyError(
          "malformed_patch",
          "The patch header is malformed.",
        );
      }
      current = { path: match[2], isNew: false, hunks: [] };
      continue;
    }
    if (current === undefined) {
      if (line.length > 0) {
        throw new PatchApplyError(
          "malformed_patch",
          "Patch lines appear before any file header.",
        );
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      if (line === "--- /dev/null") {
        current.isNew = true;
      } else if (line !== `--- a/${current.path}`) {
        throw new PatchApplyError("malformed_patch", "Mismatched old path.");
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (line !== `+++ b/${current.path}`) {
        throw new PatchApplyError(
          "path_not_allowed",
          "Mismatched new path.",
          current.path,
        );
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      closeHunk();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (match === null) {
        throw new PatchApplyError(
          "malformed_patch",
          "A hunk header is malformed.",
        );
      }
      const oldStart = Number(match[1]);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      if (
        !Number.isInteger(oldStart) ||
        !Number.isInteger(oldCount) ||
        !Number.isInteger(newStart) ||
        !Number.isInteger(newCount) ||
        oldStart < 0 ||
        newStart < 0 ||
        oldCount < 0 ||
        newCount < 0
      ) {
        throw new PatchApplyError(
          "malformed_patch",
          "A hunk header is out of range.",
        );
      }
      hunk = { oldStart, oldCount, newStart, newCount, lines: [] };
      continue;
    }
    if (
      line.startsWith("rename ") ||
      line.startsWith("copy ") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("Binary files")
    ) {
      throw new PatchApplyError(
        "path_not_allowed",
        "Renames, copies, deletions, and binary changes cannot be applied.",
        current.path,
      );
    }
    if (
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("\\")
    ) {
      continue;
    }
    if (hunk === undefined) {
      if (line.length > 0) {
        throw new PatchApplyError(
          "malformed_patch",
          "Content lines appear outside a hunk.",
        );
      }
      continue;
    }
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "delete", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "context", text: line.slice(1) });
    } else {
      throw new PatchApplyError(
        "malformed_patch",
        "A hunk contains an unexpected line.",
      );
    }
  }
  closeFile();
  if (files.length === 0) {
    throw new PatchApplyError(
      "malformed_patch",
      "The patch contains no files.",
    );
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new PatchApplyError(
        "malformed_patch",
        "The patch changes a path more than once.",
      );
    }
    seen.add(file.path);
  }
  return files;
}

function applyHunks(
  content: string[],
  isNew: boolean,
  hunks: readonly Hunk[],
): string[] {
  if (isNew) {
    const lines: string[] = [];
    for (const hunk of hunks) {
      const adds = hunk.lines
        .filter((line) => line.kind === "add")
        .map((line) => line.text);
      const insertAt = hunk.newStart - 1;
      if (insertAt < 0 || insertAt > lines.length) {
        throw new PatchApplyError(
          "not_applicable",
          "A hunk cannot be placed in a new file.",
        );
      }
      lines.splice(insertAt, 0, ...adds);
    }
    return lines;
  }
  for (const hunk of [...hunks].reverse()) {
    const oldLines = hunk.lines
      .filter((line) => line.kind !== "add")
      .map((line) => line.text);
    if (hunk.oldCount !== oldLines.length) {
      throw new PatchApplyError(
        "not_applicable",
        "A hunk line count does not match its content.",
      );
    }
    const position =
      hunk.oldCount === 0
        ? Math.min(hunk.oldStart, content.length)
        : hunk.oldStart - 1;
    if (position < 0 || position + hunk.oldCount > content.length) {
      throw new PatchApplyError(
        "not_applicable",
        "A hunk is out of range for the file.",
      );
    }
    const actual = content.slice(position, position + hunk.oldCount);
    if (!arraysEqual(actual, oldLines)) {
      throw new PatchApplyError(
        "not_applicable",
        "A hunk context does not match the file.",
      );
    }
    const newLines = hunk.lines
      .filter((line) => line.kind !== "delete")
      .map((line) => line.text);
    content.splice(position, hunk.oldCount, ...newLines);
  }
  return content;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
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
