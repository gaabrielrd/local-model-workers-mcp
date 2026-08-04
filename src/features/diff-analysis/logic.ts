import type { ModelInferencePort } from "../model-inference/index.js";
import {
  AnalyzeDiffResultSchema,
  type AnalyzeDiffInput,
  type AnalyzeDiffResult,
} from "./contracts.js";

export interface AnalyzeDiffOptions {
  readonly input: AnalyzeDiffInput;
  readonly inference?: ModelInferencePort | undefined;
  readonly model?: string | undefined;
  readonly diffText?: string | undefined;
}

export function parseDiffStats(diffText: string): {
  readonly changedFilesCount: number;
  readonly additions: number;
  readonly deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  const files = new Set<string>();

  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/b\/(.+)$/u);
      if (match?.[1] !== undefined) {
        files.add(match[1]);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  return {
    changedFilesCount: files.size,
    additions,
    deletions,
  };
}

export async function analyzeDiff(
  options: AnalyzeDiffOptions,
): Promise<AnalyzeDiffResult> {
  const { input, inference, model, diffText = "" } = options;
  const stats = parseDiffStats(diffText);

  if (diffText.trim().length === 0) {
    return {
      summary: "No changes detected in diff.",
      changed_files_count: 0,
      additions: 0,
      deletions: 0,
      impact_rating: "low",
      architectural_notes: ["Empty or clean working diff."],
    };
  }

  if (inference !== undefined && model !== undefined) {
    try {
      const result = await inference.inferStructured({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an expert code review assistant. Analyze the provided git diff and produce a structured analysis.",
          },
          {
            role: "user",
            content: `Repository root: ${input.repository_root}\nCommit range: ${input.commit_range ?? "HEAD"}\n\nDiff content:\n${diffText.slice(0, 15_000)}`,
          },
        ],
        output_name: "diff_analysis",
        output_schema: AnalyzeDiffResultSchema,
        max_tokens: 1_000,
        timeout_ms: 30_000,
      });

      return result.output;
    } catch {
      // Fallback heuristic if inference fails or unavailable
    }
  }

  const impact: "low" | "medium" | "high" =
    stats.changedFilesCount > 10 || stats.additions + stats.deletions > 500
      ? "high"
      : stats.changedFilesCount > 3 || stats.additions + stats.deletions > 100
        ? "medium"
        : "low";

  return {
    summary: `Analyzed diff modifying ${stats.changedFilesCount} files with ${stats.additions} additions and ${stats.deletions} deletions.`,
    changed_files_count: stats.changedFilesCount,
    additions: stats.additions,
    deletions: stats.deletions,
    impact_rating: impact,
    architectural_notes: [
      `Files modified: ${stats.changedFilesCount}`,
      `Impact assessed as ${impact} based on lines changed.`,
    ],
  };
}
