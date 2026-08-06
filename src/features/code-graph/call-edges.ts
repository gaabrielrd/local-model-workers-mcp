import type { CodeSymbol } from "./contracts.js";

/**
 * Call-edge extraction.
 *
 * The graph has always known which symbols exist and which files import what.
 * The question an agent actually asks before editing is "what depends on this",
 * and import edges cannot answer it: they resolve to modules, not symbols.
 *
 * This finds call sites inside function bodies by scanning the lines a symbol
 * spans. It is a textual pass, not a type-resolved one, so every edge carries
 * the confidence it earned and callers can weigh it.
 */

export type CallConfidence = "high" | "medium";

export interface CallEdge {
  /** Fully qualified caller: `path:symbol`. */
  readonly from: string;
  /** Callee symbol name as written at the call site. */
  readonly to: string;
  readonly filePath: string;
  readonly line: number;
  readonly confidence: CallConfidence;
}

/** Languages where the textual pass is reliable enough to publish edges. */
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
]);

/**
 * Names that appear in call position but are language machinery, not project
 * symbols. Publishing them would bury real edges in noise.
 */
const IGNORED_CALLEES = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "await",
  "typeof",
  "instanceof",
  "new",
  "super",
  "this",
  "print",
  "len",
  "range",
  "str",
  "int",
  "float",
  "list",
  "dict",
  "set",
  "make",
  "append",
  "panic",
  "recover",
  "defer",
  "go",
  "func",
  "require",
  "import",
  "console",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "Promise",
  "Error",
  "Math",
  "JSON",
]);

const CALL_PATTERN = /([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gu;
const METHOD_CALL_PATTERN =
  /(?:^|[^A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gu;

export function supportsCallExtraction(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && SUPPORTED_EXTENSIONS.has(filePath.slice(dot));
}

export interface ExtractCallEdgesInput {
  readonly filePath: string;
  readonly content: string;
  /** Symbols already parsed from this file; supplies the caller spans. */
  readonly symbols: readonly CodeSymbol[];
}

/**
 * Finds call sites within each callable symbol's line span.
 *
 * Returns an empty list for unsupported languages rather than guessing, so a
 * caller can distinguish "no calls" from "not analyzed" via
 * {@link supportsCallExtraction}.
 */
export function extractCallEdges(
  input: ExtractCallEdgesInput,
): readonly CallEdge[] {
  if (!supportsCallExtraction(input.filePath)) {
    return [];
  }

  const lines = input.content.split("\n");
  const callers = input.symbols.filter(
    (symbol) =>
      (symbol.kind === "function" || symbol.kind === "method") &&
      symbol.endLine > symbol.startLine,
  );
  if (callers.length === 0) {
    return [];
  }

  const declaredNames = new Set(
    input.symbols
      .filter((symbol) => symbol.kind !== "import")
      .map((symbol) => symbol.name),
  );

  const edges: CallEdge[] = [];
  const seen = new Set<string>();

  for (const caller of callers) {
    const from = `${input.filePath}:${caller.name}`;
    // The declaration line itself is the signature, not a call site.
    for (
      let lineIndex = caller.startLine;
      lineIndex < Math.min(caller.endLine, lines.length);
      lineIndex += 1
    ) {
      const raw = lines[lineIndex];
      if (raw === undefined) {
        continue;
      }
      const line = stripNoise(raw);
      if (line.length === 0) {
        continue;
      }

      for (const [callee, confidence] of calleesOn(line, declaredNames)) {
        if (callee === caller.name) {
          continue; // direct recursion adds no dependency information
        }
        const key = `${from}->${callee}@${lineIndex + 1}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({
          from,
          to: callee,
          filePath: input.filePath,
          line: lineIndex + 1,
          confidence,
        });
      }
    }
  }

  return edges;
}

/**
 * Yields callee names on one line with the confidence each earned.
 *
 * A name declared in this file is `high`: the textual match and a real
 * declaration agree. Anything else is `medium` — it is a genuine call site, but
 * without type resolution it could belong to an import, a local, or a builtin.
 */
function calleesOn(
  line: string,
  declaredNames: ReadonlySet<string>,
): readonly (readonly [string, CallConfidence])[] {
  const found: (readonly [string, CallConfidence])[] = [];

  for (const match of line.matchAll(METHOD_CALL_PATTERN)) {
    const method = match[2];
    if (method !== undefined && !IGNORED_CALLEES.has(method)) {
      found.push([method, declaredNames.has(method) ? "high" : "medium"]);
    }
  }

  for (const match of line.matchAll(CALL_PATTERN)) {
    const callee = match[1];
    if (callee === undefined || IGNORED_CALLEES.has(callee)) {
      continue;
    }
    // Method calls are already recorded above with their own name.
    const index = match.index ?? 0;
    if (index > 0 && line[index - 1] === ".") {
      continue;
    }
    found.push([callee, declaredNames.has(callee) ? "high" : "medium"]);
  }

  return found;
}

/** Removes string literals and line comments so their contents never match. */
function stripNoise(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\]|\\.)*'/gu, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``")
    .replace(/\/\/.*$/u, "")
    .replace(/#.*$/u, "")
    .trim();
}
