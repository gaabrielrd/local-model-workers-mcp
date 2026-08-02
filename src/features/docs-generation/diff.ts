interface DiffOp {
  readonly type: "context" | "insert" | "delete";
  readonly line: string;
}

interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly body: readonly string[];
}

const CONTEXT_LINES = 3;

export interface BuiltDiffFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
}

export function buildUnifiedDiff(
  filePath: string,
  oldLines: readonly string[],
  newLines: readonly string[],
): BuiltDiffFile | undefined {
  if (oldLines.length === 0) {
    if (newLines.length === 0) return undefined;
    return {
      path: filePath,
      additions: newLines.length,
      deletions: 0,
      ...newFileHeader(filePath, newLines),
    };
  }
  const ops = computeDiff(oldLines, newLines);
  const hunks = buildHunks(ops);
  if (hunks.length === 0) return undefined;
  const additions = ops.filter((op) => op.type === "insert").length;
  const deletions = ops.filter((op) => op.type === "delete").length;
  return {
    path: filePath,
    additions,
    deletions,
    patch: [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      ...hunks.flatMap((hunk) => [
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
        ...hunk.body,
      ]),
      "",
    ].join("\n"),
  };
}

function newFileHeader(
  filePath: string,
  newLines: readonly string[],
): { readonly patch: string } {
  return {
    patch: [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${newLines.length} @@`,
      ...newLines.map((line) => `+${line}`),
      "",
    ].join("\n"),
  };
}

function computeDiff(
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        oldLines[i] === newLines[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "context", line: oldLines[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ type: "delete", line: oldLines[i]! });
      i += 1;
    } else {
      ops.push({ type: "insert", line: newLines[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", line: oldLines[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "insert", line: newLines[j]! });
    j += 1;
  }
  return ops;
}

function buildHunks(ops: readonly DiffOp[]): readonly Hunk[] {
  const changeIndexes: number[] = [];
  ops.forEach((op, index) => {
    if (op.type !== "context") changeIndexes.push(index);
  });
  if (changeIndexes.length === 0) return [];

  const ranges: [number, number][] = [];
  let start = Math.max(0, changeIndexes[0]! - CONTEXT_LINES);
  let end = changeIndexes[0]! + CONTEXT_LINES;
  for (const index of changeIndexes.slice(1)) {
    const candidateStart = Math.max(0, index - CONTEXT_LINES);
    if (candidateStart <= end + 1) {
      end = index + CONTEXT_LINES;
    } else {
      ranges.push([start, end]);
      start = candidateStart;
      end = index + CONTEXT_LINES;
    }
  }
  ranges.push([start, Math.min(ops.length - 1, end)]);

  return ranges.map(([rangeStart, rangeEnd]) => {
    const body = ops.slice(rangeStart, rangeEnd + 1);
    const oldStart =
      1 + ops.slice(0, rangeStart).filter((op) => op.type !== "insert").length;
    const newStart =
      1 + ops.slice(0, rangeStart).filter((op) => op.type !== "delete").length;
    return {
      oldStart,
      oldCount: body.filter((op) => op.type !== "insert").length,
      newStart,
      newCount: body.filter((op) => op.type !== "delete").length,
      body: body.map((op) =>
        op.type === "insert"
          ? `+${op.line}`
          : op.type === "delete"
            ? `-${op.line}`
            : ` ${op.line}`,
      ),
    };
  });
}
