import { createHash } from "node:crypto";

import type { CallEdge } from "./call-edges.js";
import type {
  CodeEdge,
  CodeGraphQueryInput,
  CodeGraphQueryResult,
  CodeSymbol,
} from "./contracts.js";
import { analyzeImpact } from "./impact.js";

export class InMemoryCodeGraph {
  private fileHashes = new Map<string, string>();
  private fileSymbols = new Map<string, CodeSymbol[]>();
  /**
   * Call edges per file. A file is present here only when call extraction
   * actually ran for it, so an empty array ("no calls") stays distinguishable
   * from an absent entry ("not analyzed").
   */
  private fileCallEdges = new Map<string, CallEdge[]>();

  public updateFile(
    filePath: string,
    contentHash: string,
    symbols: readonly CodeSymbol[],
    callEdges?: readonly CallEdge[],
  ): void {
    this.fileHashes.set(filePath, contentHash);
    this.fileSymbols.set(filePath, [...symbols]);
    if (callEdges === undefined) {
      this.fileCallEdges.delete(filePath);
    } else {
      this.fileCallEdges.set(filePath, [...callEdges]);
    }
  }

  public removeFile(filePath: string): void {
    this.fileHashes.delete(filePath);
    this.fileSymbols.delete(filePath);
    this.fileCallEdges.delete(filePath);
  }

  public isStale(filePath: string, currentContentHash: string): boolean {
    const storedHash = this.fileHashes.get(filePath);
    if (storedHash === undefined) {
      return true;
    }
    return storedHash !== currentContentHash;
  }

  public clear(): void {
    this.fileHashes.clear();
    this.fileSymbols.clear();
    this.fileCallEdges.clear();
  }

  public size(): number {
    return this.fileSymbols.size;
  }

  public query(input: CodeGraphQueryInput): CodeGraphQueryResult {
    const rawResult = this.executeQuery(input);
    const revision =
      "rev:" +
      createHash("sha256")
        .update(
          JSON.stringify({
            query: input.query,
            query_type: input.query_type,
            file_filter: input.file_filter,
            rawResult,
          }),
        )
        .digest("hex");

    if (
      input.since_revision !== undefined &&
      input.since_revision === revision
    ) {
      return {
        symbols: [],
        ...(rawResult.edges !== undefined ? { edges: [] } : {}),
        ...(rawResult.impact !== undefined
          ? { impact: { ...rawResult.impact, affected: [] } }
          : {}),
        revision,
        unchanged: true,
      };
    }

    return { ...rawResult, revision };
  }

  private executeQuery(input: CodeGraphQueryInput): CodeGraphQueryResult {
    const { query, query_type, file_filter } = input;
    const filterLower = file_filter?.toLowerCase();

    const allSymbols: CodeSymbol[] = [];
    for (const [filePath, symbols] of this.fileSymbols) {
      if (
        filterLower !== undefined &&
        !filePath.toLowerCase().includes(filterLower)
      ) {
        continue;
      }
      allSymbols.push(...symbols);
    }

    if (query_type === "symbol") {
      const queryLower = query.toLowerCase();
      const matching = allSymbols.filter(
        (s) => s.kind !== "import" && s.name.toLowerCase().includes(queryLower),
      );
      return { symbols: matching };
    }

    if (query_type === "exports") {
      const queryLower = query.toLowerCase();
      const exports = allSymbols.filter(
        (s) =>
          s.exported &&
          (query.length === 0 ||
            s.filePath.toLowerCase().includes(queryLower) ||
            s.name.toLowerCase().includes(queryLower)),
      );
      return { symbols: exports };
    }

    if (query_type === "dependencies") {
      const queryLower = query.toLowerCase();
      const imports = allSymbols.filter(
        (s) =>
          s.kind === "import" &&
          (query.length === 0 ||
            s.filePath.toLowerCase().includes(queryLower) ||
            s.name.toLowerCase().includes(queryLower)),
      );
      const edges: CodeEdge[] = imports.map((imp) => ({
        from: imp.filePath,
        to: imp.name,
        relation: "imports",
      }));
      return { symbols: imports, edges };
    }

    if (query_type === "callers") {
      const queryLower = query.toLowerCase();
      // Find files/symbols that import or reference the queried symbol
      const referencing: CodeSymbol[] = [];
      const edges: CodeEdge[] = [];

      for (const [filePath, symbols] of this.fileSymbols) {
        if (
          filterLower !== undefined &&
          !filePath.toLowerCase().includes(filterLower)
        ) {
          continue;
        }

        const imports = symbols.filter(
          (s) =>
            s.kind === "import" && s.name.toLowerCase().includes(queryLower),
        );

        if (imports.length > 0) {
          referencing.push(...imports);
          for (const imp of imports) {
            edges.push({
              from: filePath,
              to: imp.name,
              relation: "imports",
            });
          }
        }
      }
      return { symbols: referencing, edges };
    }

    if (query_type === "impact_of") {
      return this.queryImpact(query, filterLower);
    }

    return { symbols: [] };
  }

  /**
   * Transitive blast radius of a symbol, walked over call edges.
   *
   * Returns the affected symbols' own declarations in `symbols` so existing
   * consumers get something useful, plus the `calls` edges that justify each
   * one, plus an `impact` block that states what the answer does not cover.
   */
  private queryImpact(
    query: string,
    filterLower: string | undefined,
  ): CodeGraphQueryResult {
    const callEdges: CallEdge[] = [];
    let analyzedFiles = 0;
    let totalFiles = 0;

    for (const filePath of this.fileSymbols.keys()) {
      if (
        filterLower !== undefined &&
        !filePath.toLowerCase().includes(filterLower)
      ) {
        continue;
      }
      totalFiles += 1;
      const edges = this.fileCallEdges.get(filePath);
      if (edges === undefined) {
        continue;
      }
      analyzedFiles += 1;
      callEdges.push(...edges);
    }

    const impact = analyzeImpact({
      target: query,
      callEdges,
      unanalyzedFiles: totalFiles - analyzedFiles,
    });

    const symbols: CodeSymbol[] = [];
    const edges: CodeEdge[] = [];
    for (const affected of impact.affected) {
      const declaration = this.fileSymbols
        .get(affected.filePath)
        ?.find((s) => s.name === affected.name && s.kind !== "import");
      if (declaration !== undefined) {
        symbols.push(declaration);
      }
      edges.push({
        from: affected.symbol,
        to: affected.via,
        relation: "calls",
      });
    }

    return { symbols, edges, impact };
  }
}
