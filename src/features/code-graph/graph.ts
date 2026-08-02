import type {
  CodeEdge,
  CodeGraphQueryInput,
  CodeGraphQueryResult,
  CodeSymbol,
} from "./contracts.js";

export class InMemoryCodeGraph {
  private fileHashes = new Map<string, string>();
  private fileSymbols = new Map<string, CodeSymbol[]>();

  public updateFile(
    filePath: string,
    contentHash: string,
    symbols: readonly CodeSymbol[],
  ): void {
    this.fileHashes.set(filePath, contentHash);
    this.fileSymbols.set(filePath, [...symbols]);
  }

  public removeFile(filePath: string): void {
    this.fileHashes.delete(filePath);
    this.fileSymbols.delete(filePath);
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
  }

  public size(): number {
    return this.fileSymbols.size;
  }

  public query(input: CodeGraphQueryInput): CodeGraphQueryResult {
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

    return { symbols: [] };
  }
}
