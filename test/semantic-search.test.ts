import assert from "node:assert/strict";
import test from "node:test";

import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import type { RepositoryReadCapability } from "../src/features/repository-exploration/index.js";
import {
  executeSemanticSearch,
  InMemoryVectorIndex,
  type SemanticSearchInput,
} from "../src/features/semantic-search/index.js";

const MODEL = "nomic-ai/nomic-embed-text";

function fakeInference(
  embeddingMap: Record<string, number[]> = {},
): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    inferStructured: () => Promise.reject(new Error("not used")),
    embedText: (request) => {
      const inputs =
        typeof request.input === "string" ? [request.input] : request.input;
      const embeddings = inputs.map(
        (text) => embeddingMap[text] ?? [0.1, 0.1, 0.1],
      );
      return Promise.resolve({
        model: request.model,
        embeddings,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });
    },
  };
}

function fakeRepoRead(
  files: Record<string, string> = {},
): RepositoryReadCapability {
  return {
    listDirectory: () =>
      Promise.resolve({
        entries: Object.keys(files).map((filePath) => ({
          path: filePath,
          name: filePath,
          kind: "file" as const,
        })),
        truncated: false,
      }),
    searchText: () =>
      Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      }),
    readSnippet: (input) => {
      const content = files[input.path] ?? "default content";
      return Promise.resolve({
        path: input.path,
        content,
        start_line: input.start_line ?? 1,
        end_line: (input.start_line ?? 1) + content.split("\n").length - 1,
        truncated: false,
      });
    },
  };
}

void test("searching an indexed repository returns ranked results", async () => {
  const vectorIndex = new InMemoryVectorIndex();
  const repoRead = fakeRepoRead({
    "src/auth.ts": "function login() { return true; }",
    "src/db.ts": "function connectDatabase() { return pool; }",
  });

  const inference = fakeInference({
    login: [1, 0, 0],
    "function login() { return true; }": [0.9, 0.1, 0],
    "function connectDatabase() { return pool; }": [0, 1, 0],
  });

  const input: SemanticSearchInput = {
    query: "login",
    repository_root: "/repo",
    reindex: true,
  };

  const result = await executeSemanticSearch({
    input,
    inference,
    vectorIndex,
    repositoryRead: repoRead,
    embeddingModel: MODEL,
  });

  assert.ok(result.results.length > 0);
  assert.equal(result.results[0]?.path, "src/auth.ts");
});

void test("reindex: true rebuilds index from scratch", async () => {
  const vectorIndex = new InMemoryVectorIndex();
  await vectorIndex.indexFile("old.ts", "oldhash", [1, 1, 1]);
  assert.equal(vectorIndex.size(), 1);

  const repoRead = fakeRepoRead({
    "new.ts": "const x = 123;",
  });
  const inference = fakeInference({
    "const x = 123;": [0.5, 0.5, 0.5],
  });

  await executeSemanticSearch({
    input: { query: "x", repository_root: "/repo", reindex: true },
    inference,
    vectorIndex,
    repositoryRead: repoRead,
    embeddingModel: MODEL,
  });

  assert.equal(await vectorIndex.isStale("old.ts", "oldhash"), true);
});

void test("empty index triggers automatic reindexing before search", async () => {
  const vectorIndex = new InMemoryVectorIndex();
  assert.equal(vectorIndex.size(), 0);

  const repoRead = fakeRepoRead({
    "auto.ts": "auto index content",
  });
  const inference = fakeInference();

  await executeSemanticSearch({
    input: { query: "auto", repository_root: "/repo" },
    inference,
    vectorIndex,
    repositoryRead: repoRead,
    embeddingModel: MODEL,
  });

  assert.ok(vectorIndex.size() > 0);
});

void test("respects top_k limit", async () => {
  const vectorIndex = new InMemoryVectorIndex();
  const files: Record<string, string> = {};
  for (let i = 1; i <= 15; i += 1) {
    files[`file${i}.ts`] = `content for file ${i}`;
  }

  const repoRead = fakeRepoRead(files);
  const inference = fakeInference();

  const result = await executeSemanticSearch({
    input: {
      query: "content",
      repository_root: "/repo",
      top_k: 5,
      reindex: true,
    },
    inference,
    vectorIndex,
    repositoryRead: repoRead,
    embeddingModel: MODEL,
  });

  assert.equal(result.results.length, 5);
});
