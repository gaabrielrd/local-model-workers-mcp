import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PatchPolicyError,
  detectTestInfrastructure,
  validateTestPatch,
} from "../src/features/test-proposal/index.js";
import { createRepositoryReadCapability } from "../src/features/repository-exploration/index.js";

void test("detects existing TypeScript and Python test infrastructure without executing it", async (t) => {
  const root = await fixture(t);
  await Promise.all([
    writeFile(path.join(root, "package.json"), "{}"),
    writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n"),
    mkdir(path.join(root, "tests")),
  ]);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: root,
  });

  const infrastructure = await detectTestInfrastructure(capability);

  assert.deepEqual(
    infrastructure.map((item) => item.kind),
    ["typescript", "python"],
  );
  assert.deepEqual(infrastructure[0]?.suggested_commands, ["npm test"]);
  assert.deepEqual(infrastructure[1]?.suggested_commands, ["python -m pytest"]);
});

void test("reports no infrastructure when a repository has no compatible tests", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "package.json"), "{}");
  const capability = await createRepositoryReadCapability({
    repositoryRoot: root,
  });

  assert.deepEqual(await detectTestInfrastructure(capability), []);
});

void test("accepts only structurally valid test-only patches", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "test"));
  await writeFile(path.join(root, "test", "existing.test.ts"), "old\n");
  const patch = unifiedDiff("test/existing.test.ts", ["-old", "+new"]);

  const result = await validateTestPatch({
    patch,
    repositoryRoot: root,
    maxFiles: 10,
    maxChangedLines: 1_000,
  });

  assert.equal(result.changed_lines, 2);
  assert.deepEqual(result.files, [
    {
      path: "test/existing.test.ts",
      additions: 1,
      deletions: 1,
      changed_lines: 2,
    },
  ]);
});

void test("blocks production, ambiguous, traversal, rename, deletion, and binary patches", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.ts"), "old\n");
  const cases = [
    unifiedDiff("src/app.ts", ["-old", "+new"]),
    unifiedDiff("helper.ts", ["+new"]),
    unifiedDiff("../test/escape.test.ts", ["+new"]),
    "diff --git a/test/a.test.ts b/test/b.test.ts\nrename from test/a.test.ts\nrename to test/b.test.ts\n",
    "diff --git a/test/a.test.ts b/test/a.test.ts\ndeleted file mode 100644\n--- a/test/a.test.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
    "diff --git a/test/a.test.ts b/test/a.test.ts\nGIT binary patch\n",
  ];

  for (const patch of cases) {
    await assert.rejects(
      validateTestPatch({
        patch,
        repositoryRoot: root,
        maxFiles: 10,
        maxChangedLines: 1_000,
      }),
      (error: unknown) => error instanceof PatchPolicyError,
    );
  }
});

void test("rejects symlink targets even when their names look like tests", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(path.join(root, "test"));
  await writeFile(path.join(outside, "outside.test.ts"), "old\n");
  await symlink(
    path.join(outside, "outside.test.ts"),
    path.join(root, "test", "link.test.ts"),
  );

  await assert.rejects(
    validateTestPatch({
      patch: unifiedDiff("test/link.test.ts", ["-old", "+new"]),
      repositoryRoot: root,
      maxFiles: 10,
      maxChangedLines: 1_000,
    }),
    isPatchError("patch_not_allowed"),
  );
});

void test("enforces exact file and changed-line boundaries", async () => {
  const tenFiles = Array.from({ length: 10 }, (_, index) =>
    unifiedDiff(`test/case-${index}.test.ts`, ["+new"]),
  ).join("");
  await validateTestPatch({
    patch: tenFiles,
    repositoryRoot: "/unused",
    maxFiles: 10,
    maxChangedLines: 1_000,
    inspectPath: () => Promise.resolve("safe"),
  });

  await assert.rejects(
    validateTestPatch({
      patch: `${tenFiles}${unifiedDiff("test/case-10.test.ts", ["+new"])}`,
      repositoryRoot: "/unused",
      maxFiles: 10,
      maxChangedLines: 1_000,
      inspectPath: () => Promise.resolve("safe"),
    }),
    isPatchError("patch_limit_exceeded"),
  );

  const oneThousand = unifiedDiff(
    "test/large.test.ts",
    Array.from({ length: 1_000 }, () => "+new"),
  );
  await validateTestPatch({
    patch: oneThousand,
    repositoryRoot: "/unused",
    maxFiles: 10,
    maxChangedLines: 1_000,
    inspectPath: () => Promise.resolve("safe"),
  });
  await assert.rejects(
    validateTestPatch({
      patch: `${oneThousand}+overflow\n`,
      repositoryRoot: "/unused",
      maxFiles: 10,
      maxChangedLines: 1_000,
      inspectPath: () => Promise.resolve("safe"),
    }),
    isPatchError("patch_limit_exceeded"),
  );
});

function unifiedDiff(file: string, body: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body,
    "",
  ].join("\n");
}

function isPatchError(
  code: PatchPolicyError["code"],
): (error: unknown) => boolean {
  return (error) => error instanceof PatchPolicyError && error.code === code;
}

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "test-proposal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
