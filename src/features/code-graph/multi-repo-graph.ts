import type { CodeGraphQueryInput, CodeGraphQueryResult } from "./contracts.js";
import { InMemoryCodeGraph } from "./graph.js";

/**
 * MultiRepoCodeGraph coordinates symbol queries across multiple workspace repositories.
 */
export class MultiRepoCodeGraph {
  private readonly graphs = new Map<string, InMemoryCodeGraph>();

  /**
   * Get or create the code graph instance for a specific repository root.
   */
  public getOrCreateGraph(repositoryRoot: string): InMemoryCodeGraph {
    let graph = this.graphs.get(repositoryRoot);
    if (graph === undefined) {
      graph = new InMemoryCodeGraph();
      this.graphs.set(repositoryRoot, graph);
    }
    return graph;
  }

  /**
   * Execute a query across the primary repository and optional additional repositories.
   */
  public query(
    input: CodeGraphQueryInput,
    additionalRoots: readonly string[] = [],
  ): CodeGraphQueryResult {
    const primaryGraph = this.getOrCreateGraph(input.repository_root);
    const primaryResult = primaryGraph.query(input);

    if (additionalRoots.length === 0) {
      return primaryResult;
    }

    const allSymbols = [...primaryResult.symbols];
    const allEdges = [...(primaryResult.edges ?? [])];

    for (const root of additionalRoots) {
      const additionalGraph = this.getOrCreateGraph(root);
      const res = additionalGraph.query({ ...input, repository_root: root });
      allSymbols.push(...res.symbols);
      if (res.edges !== undefined) {
        allEdges.push(...res.edges);
      }
    }

    return {
      symbols: Object.freeze(allSymbols),
      ...(allEdges.length > 0 ? { edges: Object.freeze(allEdges) } : {}),
    };
  }

  /**
   * Clear all stored code graphs.
   */
  public clear(): void {
    this.graphs.clear();
  }
}
