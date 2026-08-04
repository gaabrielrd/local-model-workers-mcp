import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDiff,
  parseDiffStats,
} from "../src/features/diff-analysis/index.js";

void test("parseDiffStats extracts additions, deletions, and changed file count", () => {
  const diff = `
diff --git a/src/auth.ts b/src/auth.ts
index 123..456 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
+import { login } from "./login.js";
-const oldAuth = true;
+const newAuth = true;
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
+const helper = 1;
  `;

  const stats = parseDiffStats(diff);
  assert.equal(stats.changedFilesCount, 2);
  assert.equal(stats.additions, 3);
  assert.equal(stats.deletions, 1);
});

void test("analyzeDiff handles empty diff text", async () => {
  const result = await analyzeDiff({
    input: { repository_root: "/repo" },
    diffText: "",
  });

  assert.equal(result.summary, "No changes detected in diff.");
  assert.equal(result.impact_rating, "low");
  assert.equal(result.changed_files_count, 0);
});

void test("analyzeDiff categorizes small diff as low impact", async () => {
  const diff = `
diff --git a/src/index.ts b/src/index.ts
+const x = 1;
  `;

  const result = await analyzeDiff({
    input: { repository_root: "/repo" },
    diffText: diff,
  });

  assert.equal(result.impact_rating, "low");
  assert.equal(result.changed_files_count, 1);
  assert.equal(result.additions, 1);
});
