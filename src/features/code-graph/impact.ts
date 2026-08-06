import type { CallConfidence, CallEdge } from "./call-edges.js";
import type { ImpactAnalysis, ImpactedSymbol } from "./contracts.js";

/**
 * Impact analysis over the call graph.
 *
 * `callers` answers "who imports the module this lives in". That is the wrong
 * granularity for the question an agent asks before editing: changing one
 * function does not affect everything that imports its file. This walks call
 * edges backwards, symbol to symbol, and reports the transitive set.
 *
 * Call edges are textual (see `call-edges.ts`), so every answer is a lower
 * bound, and the shape of the result says so rather than implying completeness.
 */

/** Call hops to follow. Beyond this the set stops being actionable. */
export const IMPACT_MAX_DEPTH = 5;

/**
 * Ceiling on reported symbols. The number of edges is already bounded upstream
 * by `FIXED_LIMITS.index_max_files`; this bounds the *answer*, so a hub symbol
 * cannot return a set too large to read.
 */
export const IMPACT_MAX_SYMBOLS = 500;

export interface AnalyzeImpactInput {
  /** Symbol name to analyze, as written at call sites. */
  readonly target: string;
  readonly callEdges: readonly CallEdge[];
  /** Indexed files whose language has no reliable call extraction. */
  readonly unanalyzedFiles: number;
  readonly maxDepth?: number;
  readonly maxSymbols?: number;
}

/**
 * Walks call edges backwards from `target` and returns everything reachable.
 *
 * Edges name their callee but not its file, so resolution is by symbol name:
 * two same-named functions in different files are not distinguished. That
 * imprecision is already priced into each edge's confidence.
 */
export function analyzeImpact(input: AnalyzeImpactInput): ImpactAnalysis {
  const target = input.target.trim();
  const maxDepth = input.maxDepth ?? IMPACT_MAX_DEPTH;
  const maxSymbols = input.maxSymbols ?? IMPACT_MAX_SYMBOLS;

  if (target.length === 0) {
    return finalize({
      target,
      affected: [],
      truncated: false,
      unanalyzedFiles: input.unanalyzedFiles,
    });
  }

  const callersByCallee = new Map<string, CallEdge[]>();
  for (const edge of input.callEdges) {
    const bucket = callersByCallee.get(edge.to);
    if (bucket === undefined) {
      callersByCallee.set(edge.to, [edge]);
    } else {
      bucket.push(edge);
    }
  }

  const affected = new Map<string, ImpactedSymbol>();
  let frontier: readonly (readonly [string, CallConfidence])[] = [
    [target, "high"],
  ];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = new Map<string, CallConfidence>();

    for (const [callee, inherited] of frontier) {
      for (const edge of callersByCallee.get(callee) ?? []) {
        const confidence = weakest(inherited, edge.confidence);
        const caller = splitQualifiedName(edge.from);
        if (caller === undefined || caller.name === target) {
          continue; // the queried symbol is not affected by itself
        }

        const existing = affected.get(edge.from);
        if (existing !== undefined) {
          // Keep the strongest path we have found to this symbol.
          if (existing.confidence === "medium" && confidence === "high") {
            affected.set(edge.from, { ...existing, confidence });
          }
          continue;
        }

        if (affected.size >= maxSymbols) {
          truncated = true;
          break;
        }

        affected.set(edge.from, {
          symbol: edge.from,
          name: caller.name,
          filePath: caller.filePath,
          depth,
          via: callee,
          confidence,
        });
        next.set(caller.name, confidence);
      }
      if (truncated) {
        break;
      }
    }

    if (truncated) {
      break;
    }
    frontier = [...next];
    if (frontier.length > 0 && depth === maxDepth) {
      truncated = true;
    }
  }

  return finalize({
    target,
    affected: [...affected.values()].sort(compareImpacted),
    truncated,
    unanalyzedFiles: input.unanalyzedFiles,
  });
}

function finalize(parts: {
  target: string;
  affected: readonly ImpactedSymbol[];
  truncated: boolean;
  unanalyzedFiles: number;
}): ImpactAnalysis {
  const note = describeLimits(parts.truncated, parts.unanalyzedFiles);
  return {
    target: parts.target,
    affected: parts.affected,
    truncated: parts.truncated,
    unanalyzed_files: parts.unanalyzedFiles,
    ...(note === undefined ? {} : { note }),
  };
}

/** States what the answer does not cover, so absence is never read as proof. */
function describeLimits(
  truncated: boolean,
  unanalyzedFiles: number,
): string | undefined {
  const reasons: string[] = [];
  if (unanalyzedFiles > 0) {
    reasons.push(
      `${unanalyzedFiles} indexed file(s) are in languages without call extraction; callers there are not represented`,
    );
  }
  if (truncated) {
    reasons.push(
      `the walk stopped at a depth or size ceiling (${IMPACT_MAX_DEPTH} hops, ${IMPACT_MAX_SYMBOLS} symbols)`,
    );
  }
  return reasons.length === 0
    ? undefined
    : `This is a lower bound: ${reasons.join("; ")}.`;
}

function weakest(a: CallConfidence, b: CallConfidence): CallConfidence {
  return a === "high" && b === "high" ? "high" : "medium";
}

/** Splits `path:symbol`, tolerating colons inside the path. */
function splitQualifiedName(
  qualified: string,
): { filePath: string; name: string } | undefined {
  const separator = qualified.lastIndexOf(":");
  if (separator <= 0 || separator === qualified.length - 1) {
    return undefined;
  }
  return {
    filePath: qualified.slice(0, separator),
    name: qualified.slice(separator + 1),
  };
}

function compareImpacted(a: ImpactedSymbol, b: ImpactedSymbol): number {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  if (a.confidence !== b.confidence) {
    return a.confidence === "high" ? -1 : 1;
  }
  return a.symbol.localeCompare(b.symbol);
}
