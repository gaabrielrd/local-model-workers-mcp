import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeImpact,
  extractCallEdges,
  IMPACT_MAX_DEPTH,
  InMemoryCodeGraph,
  parseSourceSymbols,
  type CallEdge,
} from "../src/features/code-graph/index.js";

function edge(
  from: string,
  to: string,
  confidence: CallEdge["confidence"] = "high",
): CallEdge {
  return { from, to, filePath: from.split(":")[0] ?? "", line: 1, confidence };
}

void test("direct callers come back at depth 1", () => {
  const impact = analyzeImpact({
    target: "target",
    callEdges: [edge("a.ts:caller", "target")],
    unanalyzedFiles: 0,
  });

  assert.equal(impact.affected.length, 1);
  assert.deepEqual(impact.affected[0], {
    symbol: "a.ts:caller",
    name: "caller",
    filePath: "a.ts",
    depth: 1,
    via: "target",
    confidence: "high",
  });
  assert.equal(impact.truncated, false);
  assert.equal(impact.note, undefined);
});

void test("the walk is transitive and records the intermediate hop", () => {
  const impact = analyzeImpact({
    target: "target",
    callEdges: [
      edge("a.ts:middle", "target"),
      edge("b.ts:outer", "middle"),
      edge("c.ts:outermost", "outer"),
    ],
    unanalyzedFiles: 0,
  });

  const byName = new Map(impact.affected.map((s) => [s.name, s]));
  assert.equal(byName.get("middle")?.depth, 1);
  assert.equal(byName.get("outer")?.depth, 2);
  assert.equal(byName.get("outermost")?.depth, 3);
  // An indirect caller must not be reported as calling the target directly.
  assert.equal(byName.get("outer")?.via, "middle");
  assert.equal(byName.get("outermost")?.via, "outer");
});

void test("confidence degrades to the weakest edge on the path", () => {
  const impact = analyzeImpact({
    target: "target",
    callEdges: [
      edge("a.ts:middle", "target", "medium"),
      edge("b.ts:outer", "middle", "high"),
    ],
    unanalyzedFiles: 0,
  });

  const byName = new Map(impact.affected.map((s) => [s.name, s]));
  assert.equal(byName.get("middle")?.confidence, "medium");
  assert.equal(
    byName.get("outer")?.confidence,
    "medium",
    "a high edge cannot repair an uncertain hop beneath it",
  );
});

void test("cycles terminate instead of looping forever", () => {
  const impact = analyzeImpact({
    target: "target",
    callEdges: [
      edge("a.ts:one", "target"),
      edge("b.ts:two", "one"),
      edge("a.ts:one", "two"),
    ],
    unanalyzedFiles: 0,
  });

  assert.equal(impact.affected.length, 2);
});

void test("depth is bounded and the truncation is stated", () => {
  const edges: CallEdge[] = [edge("f0.ts:s0", "target")];
  for (let i = 1; i <= IMPACT_MAX_DEPTH + 2; i += 1) {
    edges.push(edge(`f${String(i)}.ts:s${String(i)}`, `s${String(i - 1)}`));
  }

  const impact = analyzeImpact({
    target: "target",
    callEdges: edges,
    unanalyzedFiles: 0,
  });

  assert.equal(impact.truncated, true);
  assert.equal(impact.affected.length, IMPACT_MAX_DEPTH);
  assert.match(impact.note ?? "", /lower bound/u);
  assert.match(impact.note ?? "", /ceiling/u);
});

void test("the symbol size ceiling is honored", () => {
  const edges = Array.from({ length: 10 }, (_, i) =>
    edge(`f${String(i)}.ts:s${String(i)}`, "target"),
  );

  const impact = analyzeImpact({
    target: "target",
    callEdges: edges,
    unanalyzedFiles: 0,
    maxSymbols: 4,
  });

  assert.equal(impact.affected.length, 4);
  assert.equal(impact.truncated, true);
});

void test("unanalyzed languages are counted, so an empty answer is not proof", () => {
  const impact = analyzeImpact({
    target: "target",
    callEdges: [],
    unanalyzedFiles: 12,
  });

  assert.deepEqual(impact.affected, []);
  assert.equal(impact.unanalyzed_files, 12);
  assert.match(impact.note ?? "", /12 indexed file\(s\)/u);
  assert.match(impact.note ?? "", /lower bound/u);
});

void test("a fully analyzed repository with no callers says so without caveats", () => {
  const impact = analyzeImpact({
    target: "orphan",
    callEdges: [edge("a.ts:x", "somethingElse")],
    unanalyzedFiles: 0,
  });

  assert.deepEqual(impact.affected, []);
  assert.equal(
    impact.note,
    undefined,
    "no caveat means the answer is complete",
  );
});

void test("an empty query returns nothing rather than everything", () => {
  const impact = analyzeImpact({
    target: "   ",
    callEdges: [edge("a.ts:caller", "target")],
    unanalyzedFiles: 0,
  });
  assert.deepEqual(impact.affected, []);
});

void test("the graph answers impact_of end to end from real source", () => {
  const graph = new InMemoryCodeGraph();
  const files: Record<string, string> = {
    "src/core.ts": [
      "export function target() {",
      "  return 1;",
      "}",
      "export function middle() {",
      "  return target();",
      "}",
    ].join("\n"),
    "src/app.ts": ["export function outer() {", "  return middle();", "}"].join(
      "\n",
    ),
  };

  for (const [filePath, content] of Object.entries(files)) {
    const symbols = parseSourceSymbols(filePath, content);
    graph.updateFile(
      filePath,
      "hash",
      symbols,
      extractCallEdges({ filePath, content, symbols }),
    );
  }

  const result = graph.query({
    repository_root: "/repo",
    query: "target",
    query_type: "impact_of",
  });

  const names = (result.impact?.affected ?? []).map((s) => s.name);
  assert.deepEqual(names.sort(), ["middle", "outer"]);
  // The declarations themselves are returned for existing consumers.
  assert.equal(
    result.symbols.some((s) => s.name === "middle"),
    true,
  );
  assert.equal(result.impact?.unanalyzed_files, 0);
});

void test("files without call extraction are counted as unanalyzed by the graph", () => {
  const graph = new InMemoryCodeGraph();
  const content = [
    "export function caller() {",
    "  return target();",
    "}",
  ].join("\n");
  const symbols = parseSourceSymbols("src/app.ts", content);
  graph.updateFile(
    "src/app.ts",
    "hash",
    symbols,
    extractCallEdges({ filePath: "src/app.ts", content, symbols }),
  );
  // A Rust file is indexed for symbols but has no call edges.
  graph.updateFile("src/lib.rs", "hash", []);

  const result = graph.query({
    repository_root: "/repo",
    query: "target",
    query_type: "impact_of",
  });

  assert.equal(result.impact?.unanalyzed_files, 1);
  assert.equal(result.impact?.affected.length, 1);
});
