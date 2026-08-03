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

void test("incremental sync skips unmodified files and updates modified/deleted files", async () => {
  let embedCalls = 0;
  const vectorIndex = new InMemoryVectorIndex();

  const inference: ModelInferencePort = {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    inferStructured: () => Promise.reject(new Error("not used")),
    embedText: (request) => {
      embedCalls += 1;
      const inputs =
        typeof request.input === "string" ? [request.input] : request.input;
      return Promise.resolve({
        model: request.model,
        embeddings: inputs.map(() => [0.2, 0.2, 0.2]),
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
    },
  };

  // Initial index pass with 2 files
  const initialRepo = fakeRepoRead({
    "file1.ts": "const a = 1;",
    "file2.ts": "const b = 2;",
  });

  await executeSemanticSearch({
    input: { query: "a", repository_root: "/repo", reindex: true },
    inference,
    vectorIndex,
    repositoryRead: initialRepo,
    embeddingModel: MODEL,
  });

  const initialEmbedCalls = embedCalls;
  assert.ok(initialEmbedCalls > 1); // 1 query + 2 files (or 1 batch)
  assert.equal((await vectorIndex.getKnownPaths()).length, 2);

  // Second pass: file1.ts unchanged, file2.ts modified, file3.ts added, old files deleted
  const secondRepo = fakeRepoRead({
    "file1.ts": "const a = 1;", // unchanged
    "file2.ts": "const b = 99;", // modified
    "file3.ts": "const c = 3;", // new
  });

  const secondPassStartCalls = embedCalls;

  await executeSemanticSearch({
    input: { query: "a", repository_root: "/repo", reindex: true },
    inference,
    vectorIndex,
    repositoryRead: secondRepo,
    embeddingModel: MODEL,
  });

  const callsInSecondPass = embedCalls - secondPassStartCalls;
  // Second pass should only embed query + file2.ts + file3.ts (skipping file1.ts)
  assert.ok(callsInSecondPass <= 3);

  const knownPaths = await vectorIndex.getKnownPaths();
  assert.equal(knownPaths.length, 3);
  assert.ok(knownPaths.includes("file1.ts"));
  assert.ok(knownPaths.includes("file2.ts"));
  assert.ok(knownPaths.includes("file3.ts"));

  // Third pass: delete file3.ts
  const thirdRepo = fakeRepoRead({
    "file1.ts": "const a = 1;",
    "file2.ts": "const b = 99;",
  });

  await executeSemanticSearch({
    input: { query: "a", repository_root: "/repo", reindex: true },
    inference,
    vectorIndex,
    repositoryRead: thirdRepo,
    embeddingModel: MODEL,
  });

  const updatedPaths = await vectorIndex.getKnownPaths();
  assert.equal(updatedPaths.length, 2);
  assert.ok(!updatedPaths.includes("file3.ts"));
});
