import assert from "node:assert/strict";
import test from "node:test";

import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import type { RepositoryReadCapability } from "../src/features/repository-exploration/index.js";
import type { VectorIndex } from "../src/features/semantic-search/contracts.js";
import { InMemoryCodeGraph } from "../src/features/code-graph/graph.js";
import { parseSourceSymbols } from "../src/features/code-graph/parser.js";
import { summarizeModule } from "../src/features/module-summary/summarize.js";
import { executeSemanticSearch } from "../src/features/semantic-search/search.js";

void test("code-graph query returns revision token and handles since_revision correctly", () => {
  const graph = new InMemoryCodeGraph();
  const code = `
    export function processOrder(id: string): boolean {
      return true;
    }
  `;
  const symbols = parseSourceSymbols("src/order.ts", code);
  graph.updateFile("src/order.ts", "hash1", symbols);

  const queryInput = {
    repository_root: "/repo",
    query: "processOrder",
    query_type: "symbol" as const,
  };

  const initialResult = graph.query(queryInput);
  assert.ok(initialResult.revision);
  assert.strictEqual(initialResult.unchanged, undefined);
  assert.strictEqual(initialResult.symbols.length, 1);

  // Repeated query with same revision -> returns unchanged delta
  const deltaResult = graph.query({
    ...queryInput,
    since_revision: initialResult.revision,
  });
  assert.strictEqual(deltaResult.unchanged, true);
  assert.strictEqual(deltaResult.symbols.length, 0);
  assert.strictEqual(deltaResult.revision, initialResult.revision);

  // Stale or invalid revision -> returns full payload
  const staleResult = graph.query({
    ...queryInput,
    since_revision: "rev:stale_token",
  });
  assert.strictEqual(staleResult.unchanged, undefined);
  assert.strictEqual(staleResult.symbols.length, 1);

  // Updating symbol signature changes revision
  graph.updateFile("src/order.ts", "hash2", [
    {
      name: "processOrder",
      kind: "function",
      filePath: "src/order.ts",
      startLine: 2,
      endLine: 4,
      signature:
        "function processOrder(id: string, options?: unknown): boolean",
      exported: true,
    },
  ]);

  const updatedResult = graph.query({
    ...queryInput,
    since_revision: initialResult.revision,
  });
  assert.strictEqual(updatedResult.unchanged, undefined);
  assert.strictEqual(updatedResult.symbols.length, 1);
  assert.notStrictEqual(updatedResult.revision, initialResult.revision);
});

void test("semantic search returns revision token and handles since_revision delta", async () => {
  const mockVectorIndex: VectorIndex = {
    indexFile() {
      return Promise.resolve();
    },
    search() {
      return Promise.resolve([{ path: "src/order.ts", score: 0.95 }]);
    },
    removeFile() {
      return Promise.resolve();
    },
    isStale() {
      return Promise.resolve(false);
    },
    getKnownPaths() {
      return Promise.resolve(["src/order.ts"]);
    },
    clear() {
      return Promise.resolve();
    },
    size() {
      return 1;
    },
    save() {
      return Promise.resolve();
    },
    load() {
      return Promise.resolve();
    },
  };

  const mockInference: ModelInferencePort = {
    listModels() {
      return Promise.resolve({ models: ["test-embed"] });
    },
    isAuthenticationEnforced() {
      return Promise.resolve(false);
    },
    embedText() {
      return Promise.resolve({
        model: "test-embed",
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
    },
    inferStructured() {
      return Promise.reject(new Error("Not implemented"));
    },
  };

  const mockRepoRead: RepositoryReadCapability = {
    listDirectory() {
      return Promise.resolve({ entries: [], truncated: false });
    },
    searchText() {
      return Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      });
    },
    readSnippet() {
      return Promise.resolve({
        path: "src/order.ts",
        start_line: 1,
        end_line: 3,
        content: "function processOrder() {}",
        truncated: false,
      });
    },
  };

  const input = {
    query: "process order",
    repository_root: "/repo",
  };

  const firstResult = await executeSemanticSearch({
    input,
    inference: mockInference,
    vectorIndex: mockVectorIndex,
    repositoryRead: mockRepoRead,
    embeddingModel: "test-embed",
  });

  assert.ok(firstResult.revision);
  assert.strictEqual(firstResult.results.length, 1);
  assert.strictEqual(firstResult.unchanged, undefined);

  // Delta request with matching since_revision
  const deltaResult = await executeSemanticSearch({
    input: { ...input, since_revision: firstResult.revision },
    inference: mockInference,
    vectorIndex: mockVectorIndex,
    repositoryRead: mockRepoRead,
    embeddingModel: "test-embed",
  });

  assert.strictEqual(deltaResult.unchanged, true);
  assert.strictEqual(deltaResult.results.length, 0);
  assert.strictEqual(deltaResult.revision, firstResult.revision);

  // Invalid token fails open
  const invalidResult = await executeSemanticSearch({
    input: { ...input, since_revision: "rev:invalid" },
    inference: mockInference,
    vectorIndex: mockVectorIndex,
    repositoryRead: mockRepoRead,
    embeddingModel: "test-embed",
  });

  assert.strictEqual(invalidResult.unchanged, undefined);
  assert.strictEqual(invalidResult.results.length, 1);
});

void test("module summarization returns revision token and supports since_revision delta", async () => {
  const mockInference: ModelInferencePort = {
    listModels() {
      return Promise.resolve({ models: ["test-model"] });
    },
    isAuthenticationEnforced() {
      return Promise.resolve(false);
    },
    inferStructured<Output>() {
      return Promise.resolve({
        model: "test-model",
        output: { summary: "Processes orders" } as Output,
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          reasoning_tokens: 0,
        },
      });
    },
    embedText() {
      return Promise.reject(new Error("Not implemented"));
    },
  };

  const mockRepoRead: RepositoryReadCapability = {
    listDirectory() {
      return Promise.resolve({
        entries: [{ path: "src/order.ts", name: "order.ts", kind: "file" }],
        truncated: false,
      });
    },
    searchText() {
      return Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      });
    },
    readSnippet() {
      return Promise.resolve({
        path: "src/order.ts",
        start_line: 1,
        end_line: 3,
        content: "export function processOrder() {}",
        truncated: false,
      });
    },
  };

  const mockCollector = {
    assessPath() {
      return Promise.resolve({ accepted: true });
    },
  };

  const input = {
    repository_root: process.cwd(),
    target: "src/order.ts",
    depth: "shallow" as const,
  };

  const firstResult = await summarizeModule({
    input,
    inference: mockInference,
    repositoryRead: mockRepoRead,
    model: "test-model",
    collectorFactory: () => Promise.resolve(mockCollector as never),
  });

  assert.ok(firstResult.revision);
  assert.strictEqual(firstResult.files.length, 1);
  assert.strictEqual(firstResult.unchanged, undefined);

  // Delta request with matching since_revision
  const deltaResult = await summarizeModule({
    input: { ...input, since_revision: firstResult.revision },
    inference: mockInference,
    repositoryRead: mockRepoRead,
    model: "test-model",
    collectorFactory: () => Promise.resolve(mockCollector as never),
  });

  assert.strictEqual(deltaResult.unchanged, true);
  assert.strictEqual(deltaResult.files.length, 0);
  assert.strictEqual(deltaResult.revision, firstResult.revision);
});
