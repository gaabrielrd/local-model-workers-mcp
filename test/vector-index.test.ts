import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  InMemoryVectorIndex,
  cosineSimilarity,
} from "../src/features/semantic-search/index.js";

void test("cosineSimilarity calculations", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1.0);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0.0);
  assert.equal(cosineSimilarity([], []), 0.0);
  assert.equal(cosineSimilarity([1, 2], [1]), 0.0);
});

void test("indexing 3 files and searching returns results sorted by descending similarity", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("fileA.ts", "hashA", [1, 0, 0]);
  await index.indexFile("fileB.ts", "hashB", [0.8, 0.2, 0]);
  await index.indexFile("fileC.ts", "hashC", [0, 1, 0]);

  const results = await index.search([1, 0, 0]);

  assert.equal(results.length, 3);
  assert.equal(results[0]?.path, "fileA.ts");
  assert.equal(results[1]?.path, "fileB.ts");
  assert.equal(results[2]?.path, "fileC.ts");
  const first = results[0];
  const second = results[1];
  const third = results[2];
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  assert.ok(first.score > second.score);
  assert.ok(second.score > third.score);
});

void test("searching with topK=2 returns exactly 2 results", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("fileA.ts", "hashA", [1, 0, 0]);
  await index.indexFile("fileB.ts", "hashB", [0.8, 0.2, 0]);
  await index.indexFile("fileC.ts", "hashC", [0, 1, 0]);

  const results = await index.search([1, 0, 0], 2);
  assert.equal(results.length, 2);
});

void test("isStale detects missing files and content hash changes", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("fileA.ts", "hashOriginal", [1, 0, 0]);

  assert.equal(await index.isStale("fileA.ts", "hashOriginal"), false);
  assert.equal(await index.isStale("fileA.ts", "hashModified"), true);
  assert.equal(await index.isStale("unindexed.ts", "hashOriginal"), true);
});

void test("removeFile removes all entries/chunks for a given path", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("fileA.ts", "hashA", [1, 0, 0], {
    chunkOffset: 0,
    chunkLength: 100,
  });
  await index.indexFile("fileA.ts", "hashA", [0.9, 0.1, 0], {
    chunkOffset: 100,
    chunkLength: 100,
  });
  await index.indexFile("fileB.ts", "hashB", [0, 1, 0]);

  assert.equal(index.size(), 3);
  await index.removeFile("fileA.ts");
  assert.equal(index.size(), 1);
  assert.equal(await index.isStale("fileA.ts", "hashA"), true);
});

void test("clear empties index and size returns 0", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("fileA.ts", "hashA", [1, 0, 0]);
  assert.equal(index.size(), 1);

  await index.clear();
  assert.equal(index.size(), 0);
});

void test("eviction removes LRU entries when maxEntries is exceeded", async () => {
  const index = new InMemoryVectorIndex({ maxEntries: 2 });
  await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
  // Small delay to ensure timestamp differences
  await new Promise((r) => setTimeout(r, 5));
  await index.indexFile("file2.ts", "hash2", [0, 1, 0]);
  await new Promise((r) => setTimeout(r, 5));
  await index.indexFile("file3.ts", "hash3", [0, 0, 1]);

  assert.equal(index.size(), 2);
  const searchResults = await index.search([1, 0, 0], 10);
  assert.equal(
    searchResults.some((r) => r.path === "file1.ts"),
    false,
  );
  assert.equal(
    searchResults.some((r) => r.path === "file2.ts"),
    true,
  );
  assert.equal(
    searchResults.some((r) => r.path === "file3.ts"),
    true,
  );
});

void test("persistence save and load cycle", async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "vector-index-test-"));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const dbPath = path.join(tmpDir, "index.json");
  const index1 = new InMemoryVectorIndex({ persistencePath: dbPath });
  await index1.indexFile("doc.ts", "hash123", [0.5, 0.5, 0], {
    chunkOffset: 10,
    chunkLength: 50,
  });
  await index1.save();

  const index2 = new InMemoryVectorIndex({ persistencePath: dbPath });
  await index2.load();

  assert.equal(index2.size(), 1);
  const results = await index2.search([0.5, 0.5, 0]);
  assert.equal(results[0]?.path, "doc.ts");
  assert.equal(results[0]?.chunkOffset, 10);
  assert.equal(results[0]?.chunkLength, 50);
});

void test("corrupt persistence file triggers automatic rebuild without crashing", async (t) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "vector-index-corrupt-"));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  const dbPath = path.join(tmpDir, "corrupt.json");
  await writeFile(dbPath, "{ invalid json structure", "utf8");

  const index = new InMemoryVectorIndex({ persistencePath: dbPath });
  await index.load();

  assert.equal(index.size(), 0);
});

void test("chunked file returns separate search results with correct offsets", async () => {
  const index = new InMemoryVectorIndex();
  await index.indexFile("large.ts", "hashL", [1, 0, 0], {
    chunkOffset: 0,
    chunkLength: 500,
  });
  await index.indexFile("large.ts", "hashL", [0.9, 0.1, 0], {
    chunkOffset: 500,
    chunkLength: 500,
  });
  await index.indexFile("large.ts", "hashL", [0, 0, 1], {
    chunkOffset: 1000,
    chunkLength: 500,
  });

  const results = await index.search([1, 0, 0]);
  assert.equal(results.length, 3);
  assert.equal(results[0]?.chunkOffset, 0);
  assert.equal(results[1]?.chunkOffset, 500);
  assert.equal(results[2]?.chunkOffset, 1000);
});
