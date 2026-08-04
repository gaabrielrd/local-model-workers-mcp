import { z } from "zod";

import { FEATURE_GROUPS, type FeatureGroup } from "../configuration/index.js";

export const STEERING_MARKER_START = "# local-model-workers-mcp:start";
export const STEERING_MARKER_END = "# local-model-workers-mcp:end";

export const HarnessSteeringConfigSchema = z
  .object({
    custom_directives: z.string().trim().min(1).max(2_000).optional(),
    enabled_features: z.array(z.enum(FEATURE_GROUPS)).optional(),
  })
  .strict();

export interface HarnessSteeringConfig {
  readonly custom_directives?: string | undefined;
  readonly enabled_features?: readonly FeatureGroup[] | undefined;
}

export interface SteeringInstructions {
  readonly block: string;
  readonly preview: readonly string[];
}

export function buildSteeringInstructions(
  input: HarnessSteeringConfig = {},
): SteeringInstructions {
  const features = input.enabled_features ?? FEATURE_GROUPS;
  const directives: string[] = [];

  if (features.includes("exploration")) {
    directives.push(
      "Use `explore_repository` for goal-directed repository exploration instead of scanning raw files directly.",
      "Use `search_semantic` for natural-language code search.",
      "Use `query_code_graph` for symbol, caller, dependency, and export queries.",
      "Use `summarize_module` for structured file or directory summaries.",
    );
  }
  if (features.includes("tests")) {
    directives.push(
      "Use `propose_tests` when generating unit test proposals.",
      "Use `auto_validate_tests` to generate and run unit tests iteratively in an isolated sandbox.",
    );
  }
  if (features.includes("docs")) {
    directives.push(
      "Use `generate_docs_patch` for documentation proposals.",
      "Use `analyze_diff` for semantic git commit diff summaries and architectural impact analysis.",
    );
  }
  if (features.includes("lint")) {
    directives.push(
      "Use `fix_lint_violations` to repair linter errors.",
      "Use `fix_type_errors` to repair compiler and type checker errors.",
    );
  }

  const custom = sanitizeCustomDirectives(input.custom_directives);
  if (custom !== undefined) {
    directives.push(custom);
  }
  const block = [
    STEERING_MARKER_START,
    "# Managed by local-model-workers-mcp. Edit only outside these markers.",
    "",
    "## Offload repository work to local MCP tools",
    "",
    ...directives,
    "",
    STEERING_MARKER_END,
  ].join("\n");
  return Object.freeze({
    block,
    preview: Object.freeze([
      "managed block between managed markers",
      "directives: explore_repository, search_semantic, query_code_graph, summarize_module, propose_tests",
      ...(custom === undefined
        ? []
        : [`custom directives: ${custom.split(/\r?\n/u)[0] ?? ""}`]),
    ]),
  });
}

function sanitizeCustomDirectives(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  const kept = trimmed
    .split(/\r?\n/u)
    .filter(
      (line) => line !== STEERING_MARKER_START && line !== STEERING_MARKER_END,
    )
    .join("\n")
    .trim();
  return kept.length === 0 ? undefined : kept;
}
