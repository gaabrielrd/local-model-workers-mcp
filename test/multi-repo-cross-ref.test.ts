import assert from "node:assert/strict";
import test from "node:test";

import {
  MultiRepoCodeGraph,
  type CodeSymbol,
} from "../src/features/code-graph/index.js";
import {
  InMemoryVectorIndex,
  MultiRepoVectorIndex,
} from "../src/features/semantic-search/index.js";

void test("MultiRepoCodeGraph queries primary repository", () => {
  const multiGraph = new MultiRepoCodeGraph();
  const primaryGraph = multiGraph.getOrCreateGraph("/repo1");

  const symbol: CodeSymbol = {
    name: "calculateTotal",
    kind: "function",
    filePath: "src/billing.ts",
    startLine: 1,
    endLine: 10,
    signature: "function calculateTotal(): number",
    exported: true,
  };

  primaryGraph.updateFile("src/billing.ts", "hash1", [symbol]);

  const result = multiGraph.query({
    repository_root: "/repo1",
    query: "calculateTotal",
    query_type: "symbol",
  });

  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]?.name, "calculateTotal");
});

void test("MultiRepoCodeGraph aggregates symbols across multiple repositories", () => {
  const multiGraph = new MultiRepoCodeGraph();
  const repo1 = multiGraph.getOrCreateGraph("/repo1");
  const repo2 = multiGraph.getOrCreateGraph("/repo2");

  const symbol1: CodeSymbol = {
    name: "authService",
    kind: "class",
    filePath: "src/auth.ts",
    startLine: 1,
    endLine: 20,
    signature: "class authService",
    exported: true,
  };

  const symbol2: CodeSymbol = {
    name: "authHelper",
    kind: "function",
    filePath: "src/utils.ts",
    startLine: 1,
    endLine: 5,
    signature: "function authHelper(): void",
    exported: true,
  };

  repo1.updateFile("src/auth.ts", "hash1", [symbol1]);
  repo2.updateFile("src/utils.ts", "hash2", [symbol2]);

  const result = multiGraph.query(
    {
      repository_root: "/repo1",
      query: "auth",
      query_type: "symbol",
    },
    ["/repo2"],
  );

  assert.equal(result.symbols.length, 2);
  const names = result.symbols.map((s) => s.name);
  assert.ok(names.includes("authService"));
  assert.ok(names.includes("authHelper"));
});

void test("MultiRepoVectorIndex searches across multiple repository vector indices", async () => {
  const multiVector = new MultiRepoVectorIndex({
    createIndex: () => new InMemoryVectorIndex(),
  });

  const idx1 = multiVector.getOrCreate("/repo1");
  const idx2 = multiVector.getOrCreate("/repo2");

  await idx1.indexFile("fileA.ts", "hashA", [1, 0, 0]);
  await idx2.indexFile("fileB.ts", "hashB", [0.9, 0.1, 0]);

  const results = await multiVector.searchMulti(
    [1, 0, 0],
    "/repo1",
    ["/repo2"],
    10,
  );

  assert.equal(results.length, 2);
  assert.equal(results[0]?.path, "/repo1:fileA.ts");
  assert.equal(results[1]?.path, "/repo2:fileB.ts");
  assert.ok(results[0].score > results[1].score);
});
