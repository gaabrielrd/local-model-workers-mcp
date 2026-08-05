import assert from "node:assert/strict";
import test from "node:test";

import { FIXED_LIMITS } from "../src/features/configuration/index.js";
import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import type { RepositoryReadCapability } from "../src/features/repository-exploration/index.js";
import {
  InMemoryVectorIndex,
  executeSemanticSearch,
  reindexRepository,
} from "../src/features/semantic-search/index.js";

const MODEL = "nomic-ai/nomic-embed-text";

void test("the documented ceiling is a real, positive policy value", () => {
  assert.ok(FIXED_LIMITS.index_max_files > 0);
  assert.ok(FIXED_LIMITS.index_max_bytes > 0);
});

void test("a repository under the ceiling behaves exactly as before", async () => {
  const files = generateRepository(20, 200);
  const vectorIndex = new InMemoryVectorIndex();

  const outcome = await reindexRepository({
    repositoryRead: fakeRepoRead(files),
    inference: fakeInference(),
    vectorIndex,
    embeddingModel: MODEL,
    timeout_ms: 5_000,
    maxFiles: 100,
  });

  assert.equal(outcome.truncated, false);
  assert.equal(outcome.over_limit_files, 0);
  assert.equal(outcome.limit_reason, undefined);
  assert.equal((await vectorIndex.getKnownPaths()).length, 20);
});

void test("a repository over the file ceiling stops and reports the shortfall", async () => {
  const files = generateRepository(50, 100);
  const vectorIndex = new InMemoryVectorIndex();

  const outcome = await reindexRepository({
    repositoryRead: fakeRepoRead(files),
    inference: fakeInference(),
    vectorIndex,
    embeddingModel: MODEL,
    timeout_ms: 5_000,
    maxFiles: 10,
  });

  assert.equal(outcome.truncated, true);
  assert.equal(outcome.limit_reason, "file_count");
  assert.equal(outcome.over_limit_files, 40);
  // Work stopped at the ceiling rather than walking the whole repository.
  assert.equal((await vectorIndex.getKnownPaths()).length, 10);
});

void test("a repository over the byte ceiling stops on volume, not file count", async () => {
  const files = generateRepository(40, 5_000);
  const vectorIndex = new InMemoryVectorIndex();

  const outcome = await reindexRepository({
    repositoryRead: fakeRepoRead(files),
    inference: fakeInference(),
    vectorIndex,
    embeddingModel: MODEL,
    timeout_ms: 5_000,
    maxFiles: 1_000,
    maxBytes: 20_000,
  });

  assert.equal(outcome.truncated, true);
  assert.equal(outcome.limit_reason, "byte_volume");
  assert.ok(outcome.over_limit_files > 0, "the shortfall must be reported");
  assert.ok(
    (await vectorIndex.getKnownPaths()).length < 40,
    "indexing must stop before covering every file",
  );
});

void test("search reports the limitation so callers can tell 'not indexed' from 'no match'", async () => {
  const files = generateRepository(30, 100);
  const vectorIndex = new InMemoryVectorIndex();

  const result = await executeSemanticSearch({
    input: { query: "content", repository_root: "/repo", reindex: true },
    inference: fakeInference(),
    vectorIndex,
    repositoryRead: fakeRepoRead(files),
    embeddingModel: MODEL,
    maxFiles: 5,
  });

  assert.notEqual(result.index_limitation, undefined);
  assert.equal(result.index_limitation?.code, "repository_too_large");
  assert.equal(result.index_limitation?.reason, "file_count");
  assert.equal(result.index_limitation?.files_not_indexed, 25);
});

void test("an in-scope search carries no limitation", async () => {
  const files = generateRepository(5, 100);
  const vectorIndex = new InMemoryVectorIndex();

  const result = await executeSemanticSearch({
    input: { query: "content", repository_root: "/repo", reindex: true },
    inference: fakeInference(),
    vectorIndex,
    repositoryRead: fakeRepoRead(files),
    embeddingModel: MODEL,
    maxFiles: 100,
  });

  assert.equal(result.index_limitation, undefined);
});

void test("indexing a large fixture keeps the index bounded and memory flat", async () => {
  // 4,000 files would be ~16 MB of embeddings if every one were retained.
  const files = generateRepository(4_000, 400);
  const vectorIndex = new InMemoryVectorIndex({ maxEntries: 250 });

  const before = process.memoryUsage().heapUsed;
  const outcome = await reindexRepository({
    repositoryRead: fakeRepoRead(files),
    inference: fakeInference(),
    vectorIndex,
    embeddingModel: MODEL,
    timeout_ms: 30_000,
    maxFiles: 1_500,
  });
  const growthBytes = process.memoryUsage().heapUsed - before;

  assert.equal(outcome.truncated, true);
  assert.equal(outcome.over_limit_files, 2_500);
  // Eviction holds the index at its configured ceiling regardless of input size.
  assert.ok(
    vectorIndex.size() <= 250,
    `index must respect maxEntries, saw ${vectorIndex.size()}`,
  );
  // A generous bound: the point is that growth does not scale with the 4,000
  // input files, not that it hits an exact number.
  assert.ok(
    growthBytes < 200 * 1_024 * 1_024,
    `heap growth must stay bounded, saw ${Math.round(growthBytes / 1_024 / 1_024)} MB`,
  );
});

function generateRepository(
  fileCount: number,
  bytesPerFile: number,
): Record<string, string> {
  const files: Record<string, string> = {};
  const body = "x".repeat(Math.max(1, bytesPerFile));
  for (let index = 0; index < fileCount; index += 1) {
    files[`src/module-${index}.ts`] =
      `// file ${index}\nconst v = "${body}";\n`;
  }
  return files;
}

function fakeRepoRead(files: Record<string, string>): RepositoryReadCapability {
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
    searchText: () => Promise.resolve({ matches: [], truncated: false }),
    readSnippet: (input: { path: string }) => {
      const content = files[input.path];
      if (content === undefined) {
        return Promise.reject(new Error(`missing ${input.path}`));
      }
      const lines = content.split("\n");
      return Promise.resolve({
        path: input.path,
        content,
        start_line: 1,
        end_line: lines.length,
        truncated: false,
      });
    },
  } as unknown as RepositoryReadCapability;
}

function fakeInference(): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    inferStructured: () => Promise.reject(new Error("not used")),
    embedText: (request) => {
      const inputs =
        typeof request.input === "string" ? [request.input] : request.input;
      return Promise.resolve({
        model: request.model,
        embeddings: inputs.map(() => [0.1, 0.2, 0.3]),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    },
  };
}
