import { z } from "zod";

import type { CallConfidence } from "./call-edges.js";

export type CodeSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "method"
  | "import"
  | "export";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: CodeSymbolKind;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
  readonly exported: boolean;
}

export type CodeEdgeRelation = "imports" | "calls" | "exports" | "extends";

export interface CodeEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: CodeEdgeRelation;
}

export type CodeGraphQueryType =
  "symbol" | "callers" | "dependencies" | "exports" | "impact_of";

export const CodeGraphQueryInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    query: z.string().trim(),
    query_type: z.enum([
      "symbol",
      "callers",
      "dependencies",
      "exports",
      "impact_of",
    ]),
    file_filter: z.string().trim().optional(),
    additional_repositories: z
      .array(z.string().trim().min(1).max(4_096))
      .max(10)
      .optional(),
    since_revision: z.string().trim().optional(),
  })
  .strict();

export type CodeGraphQueryInput = z.infer<typeof CodeGraphQueryInputSchema>;

/** One symbol that would be affected by changing the queried symbol. */
export interface ImpactedSymbol {
  /** Fully qualified: `path:symbol`. */
  readonly symbol: string;
  readonly name: string;
  readonly filePath: string;
  /** Call hops away from the queried symbol; 1 is a direct caller. */
  readonly depth: number;
  /**
   * The symbol this one calls directly on the path back to the target. At
   * depth 1 it is the target itself; deeper, it is the intermediate hop, so
   * the chain stays reconstructible instead of implying a direct call.
   */
  readonly via: string;
  /** Weakest edge on the strongest path that reached this symbol. */
  readonly confidence: CallConfidence;
}

/**
 * The result of an `impact_of` query.
 *
 * `unanalyzed_files` is the part that keeps the answer honest: an empty
 * `affected` list means "nothing calls this" only when that count is zero.
 * Otherwise the blast radius is a lower bound.
 */
export interface ImpactAnalysis {
  readonly target: string;
  readonly affected: readonly ImpactedSymbol[];
  /** True when a depth or size ceiling stopped the walk early. */
  readonly truncated: boolean;
  /** Indexed files whose language has no reliable call extraction. */
  readonly unanalyzed_files: number;
  /** Plain-language statement of what limited this answer, when anything did. */
  readonly note?: string;
}

export interface CodeGraphQueryResult {
  readonly symbols: readonly CodeSymbol[];
  readonly edges?: readonly CodeEdge[] | undefined;
  readonly impact?: ImpactAnalysis | undefined;
  readonly revision?: string | undefined;
  readonly unchanged?: boolean | undefined;
}
