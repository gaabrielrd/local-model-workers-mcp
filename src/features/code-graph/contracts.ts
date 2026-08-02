import { z } from "zod";

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
  "symbol" | "callers" | "dependencies" | "exports";

export const CodeGraphQueryInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    query: z.string().trim(),
    query_type: z.enum(["symbol", "callers", "dependencies", "exports"]),
    file_filter: z.string().trim().optional(),
  })
  .strict();

export type CodeGraphQueryInput = z.infer<typeof CodeGraphQueryInputSchema>;

export interface CodeGraphQueryResult {
  readonly symbols: readonly CodeSymbol[];
  readonly edges?: readonly CodeEdge[] | undefined;
}
