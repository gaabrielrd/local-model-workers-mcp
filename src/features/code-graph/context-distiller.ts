export interface DistillOptions {
  /** Strip block and line comments. Default: true */
  readonly stripComments?: boolean;
  /** Collapse consecutive empty lines into a single empty line. Default: true */
  readonly collapseEmptyLines?: boolean;
  /** Language identifier (e.g., "typescript", "python", "go", "rust", "java", "csharp"). Default: "typescript" */
  readonly language?: string;
}

export interface DistillResult {
  readonly distilledContent: string;
  readonly originalLength: number;
  readonly distilledLength: number;
  readonly compressionRatio: number;
}

/**
 * Distills source code to compress token count before sending context to local LLMs,
 * preserving syntactic structure while stripping comments and excessive whitespace.
 */
export function distillContext(
  source: string,
  options: DistillOptions = {},
): DistillResult {
  const stripComments = options.stripComments ?? true;
  const collapseEmptyLines = options.collapseEmptyLines ?? true;
  const originalLength = source.length;

  if (source.trim().length === 0) {
    return {
      distilledContent: source,
      originalLength,
      distilledLength: originalLength,
      compressionRatio: 1.0,
    };
  }

  let result = source;

  if (stripComments) {
    const lang = options.language?.toLowerCase() ?? "typescript";
    if (lang === "python") {
      // Strip Python triple-quoted docstrings and # comments
      result = result.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/gu, "");
      result = result
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("#");
          if (commentIdx >= 0) {
            const before = line.slice(0, commentIdx);
            if (before.trim().length > 0) return before;
            return "";
          }
          return line;
        })
        .join("\n");
    } else {
      // Strip JS/TS/Go/Rust/Java/C# block comments /* ... */ and line comments //
      result = result.replace(/\/\*[\s\S]*?\*\//gu, "");
      result = result
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("//");
          if (commentIdx >= 0) {
            const before = line.slice(0, commentIdx);
            if (before.trim().length > 0) return before;
            return "";
          }
          return line;
        })
        .join("\n");
    }
  }

  if (collapseEmptyLines) {
    result = result.replace(/\n{3,}/gu, "\n\n");
  }

  const distilledContent = result.trim();
  const distilledLength = distilledContent.length;
  const compressionRatio =
    originalLength > 0 ? distilledLength / originalLength : 1.0;

  return {
    distilledContent,
    originalLength,
    distilledLength,
    compressionRatio: Math.round(compressionRatio * 1_000) / 1_000,
  };
}
