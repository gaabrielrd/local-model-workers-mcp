import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SqliteVectorIndex } from "../src/features/semantic-search/index.js";

void test("SqliteVectorIndex", async (t) => {
  let tmpDir: string;

  t.beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sqlite-index-test-"));
  });

  t.afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test(
    "indexing files and searching returns results sorted by descending similarity",
    async () => {
      const dbPath = path.join(tmpDir, "index.db");
      const index = new SqliteVectorIndex({ persistencePath: dbPath });

      await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
      await index.indexFile("file2.ts", "hash2", [0.8, 0.2, 0]);
      await index.indexFile("file3.ts", "hash3", [0, 1, 0]);

      const results = await index.search([1, 0, 0], 3);

      assert.equal(results.length, 3);
      assert.equal(results[0]?.path, "file1.ts");
      assert.equal(results[1]?.path, "file2.ts");
      assert.equal(results[2]?.path, "file3.ts");
      assert.ok(
        results[0] !== undefined &&
          results[1] !== undefined &&
          results[2] !== undefined,
      );
      assert.ok(results[0].score > results[1].score);
      assert.ok(results[1].score > results[2].score);

      index.close();
    },
  );

  await t.test("searching with topK=2 returns exactly 2 results", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
    await index.indexFile("file2.ts", "hash2", [0.8, 0.2, 0]);
    await index.indexFile("file3.ts", "hash3", [0.5, 0.5, 0]);

    const results = await index.search([1, 0, 0], 2);

    assert.equal(results.length, 2);

    index.close();
  });

  await t.test(
    "isStale detects missing files and content hash changes",
    async () => {
      const dbPath = path.join(tmpDir, "index.db");
      const index = new SqliteVectorIndex({ persistencePath: dbPath });

      await index.indexFile("file1.ts", "hash1", [1, 0, 0]);

      assert.equal(await index.isStale("file1.ts", "hash1"), false);
      assert.equal(await index.isStale("file1.ts", "hash2"), true);
      assert.equal(await index.isStale("unknown.ts", "hash1"), true);

      index.close();
    },
  );

  await t.test("removeFile removes all entries for a given path", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    await index.indexFile("file1.ts", "hash1", [1, 0, 0], {
      chunkOffset: 0,
      chunkLength: 10,
    });
    await index.indexFile("file1.ts", "hash1", [0, 1, 0], {
      chunkOffset: 10,
      chunkLength: 10,
    });
    await index.indexFile("file2.ts", "hash2", [0, 0, 1]);

    assert.equal(index.size(), 3);

    await index.removeFile("file1.ts");

    assert.equal(index.size(), 1);
    assert.equal(await index.isStale("file1.ts", "hash1"), true);
    assert.equal(await index.isStale("file2.ts", "hash2"), false);

    index.close();
  });

  await t.test("clear empties index and size returns 0", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
    await index.indexFile("file2.ts", "hash2", [0, 1, 0]);

    assert.equal(index.size(), 2);

    await index.clear();

    assert.equal(index.size(), 0);

    index.close();
  });

  await t.test(
    "eviction removes oldest entries when maxEntries is exceeded",
    async () => {
      const dbPath = path.join(tmpDir, "index.db");
      const index = new SqliteVectorIndex({
        persistencePath: dbPath,
        maxEntries: 2,
      });

      await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
      await delay(10);
      await index.indexFile("file2.ts", "hash2", [0, 1, 0]);
      await delay(10);

      assert.equal(index.size(), 2);

      await index.indexFile("file3.ts", "hash3", [0, 0, 1]);

      assert.equal(index.size(), 2);

      const knownPaths = await index.getKnownPaths();
      assert.ok(!knownPaths.includes("file1.ts"));
      assert.ok(knownPaths.includes("file2.ts"));
      assert.ok(knownPaths.includes("file3.ts"));

      index.close();
    },
  );

  await t.test("SQLite persistence across instances", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index1 = new SqliteVectorIndex({ persistencePath: dbPath });

    await index1.indexFile("file1.ts", "hash1", [1, 0, 0]);
    await index1.indexFile("file2.ts", "hash2", [0, 1, 0]);
    index1.close();

    const index2 = new SqliteVectorIndex({ persistencePath: dbPath });

    assert.equal(index2.size(), 2);
    const results = await index2.search([1, 0, 0], 1);
    assert.equal(results[0]?.path, "file1.ts");

    index2.close();
  });

  await t.test(
    "chunked file returns separate search results with correct offsets",
    async () => {
      const dbPath = path.join(tmpDir, "index.db");
      const index = new SqliteVectorIndex({ persistencePath: dbPath });

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

      index.close();
    },
  );

  await t.test("migration from JSON persistence file", async () => {
    const dbPath = path.join(tmpDir, "migrated.db");
    const jsonPath = path.join(tmpDir, "index.json");

    const mockJson = {
      version: 1,
      entries: [
        {
          relativePath: "a.ts",
          contentHash: "h1",
          embedding: [1, 0, 0],
          indexedAtMs: 1000,
          chunkOffset: 0,
          chunkLength: 100,
        },
      ],
    };

    await writeFile(jsonPath, JSON.stringify(mockJson));

    const index = await SqliteVectorIndex.migrateFromJson(jsonPath, dbPath);

    assert.equal(index.size(), 1);
    const knownPaths = await index.getKnownPaths();
    assert.deepEqual(knownPaths, ["a.ts"]);

    const results = await index.search([1, 0, 0], 1);
    assert.equal(results[0]?.path, "a.ts");
    assert.equal(results[0]?.chunkOffset, 0);
    assert.equal(results[0]?.chunkLength, 100);

    index.close();
  });

  await t.test("corrupt JSON migration file does not crash", async () => {
    const dbPath = path.join(tmpDir, "migrated.db");
    const jsonPath = path.join(tmpDir, "corrupt.json");

    await writeFile(jsonPath, "invalid json { {");

    const index = await SqliteVectorIndex.migrateFromJson(jsonPath, dbPath);

    assert.equal(index.size(), 0);

    index.close();
  });

  await t.test("empty search returns empty results", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    const results = await index.search([1, 0, 0], 5);

    assert.deepEqual(results, []);

    index.close();
  });

  await t.test("search with topK < 1 returns empty results", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    await index.indexFile("file1.ts", "hash1", [1, 0, 0]);

    const results = await index.search([1, 0, 0], 0);

    assert.deepEqual(results, []);

    index.close();
  });

  await t.test("getKnownPaths returns unique paths", async () => {
    const dbPath = path.join(tmpDir, "index.db");
    const index = new SqliteVectorIndex({ persistencePath: dbPath });

    await index.indexFile("file1.ts", "hash1", [1, 0, 0], {
      chunkOffset: 0,
      chunkLength: 100,
    });
    await index.indexFile("file1.ts", "hash1", [0, 1, 0], {
      chunkOffset: 100,
      chunkLength: 100,
    });
    await index.indexFile("file2.ts", "hash2", [0, 0, 1]);

    const knownPaths = await index.getKnownPaths();

    assert.equal(knownPaths.length, 2);
    assert.ok(knownPaths.includes("file1.ts"));
    assert.ok(knownPaths.includes("file2.ts"));

    index.close();
  });

  await t.test("in-memory mode works without persistence path", async () => {
    const index = new SqliteVectorIndex();

    await index.indexFile("file1.ts", "hash1", [1, 0, 0]);
    await index.indexFile("file2.ts", "hash2", [0, 1, 0]);

    assert.equal(index.size(), 2);

    const results = await index.search([1, 0, 0], 1);
    assert.equal(results[0]?.path, "file1.ts");

    index.close();
  });
});
