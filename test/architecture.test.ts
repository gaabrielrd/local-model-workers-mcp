import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findBoundaryViolations } from "../scripts/check-feature-boundaries.js";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

void test("current source respects feature boundaries", async () => {
  assert.deepEqual(await findBoundaryViolations(sourceRoot), []);
});

void test("another feature's public index is allowed", async () => {
  const fixtureRoot = await createFixture({
    "features/alpha/index.ts": 'export { value } from "../beta/index.js";\n',
    "features/beta/index.ts": "export const value = 1;\n",
  });

  try {
    assert.deepEqual(await findBoundaryViolations(fixtureRoot), []);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

void test("another feature's internal file is rejected", async () => {
  const fixtureRoot = await createFixture({
    "features/alpha/index.ts": 'export { value } from "../beta/internal.js";\n',
    "features/beta/internal.ts": "export const value = 1;\n",
  });

  try {
    const violations = await findBoundaryViolations(fixtureRoot);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.reason ?? "", /public index\.ts/u);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

void test("dynamic imports cannot bypass feature boundaries", async () => {
  const fixtureRoot = await createFixture({
    "features/alpha/index.ts":
      'export async function load() { return import("../beta/internal.js"); }\n',
    "features/beta/internal.ts": "export const value = 1;\n",
  });

  try {
    const violations = await findBoundaryViolations(fixtureRoot);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.reason ?? "", /public index\.ts/u);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

void test("shared code cannot import a product feature", async () => {
  const fixtureRoot = await createFixture({
    "features/alpha/index.ts": "export const value = 1;\n",
    "shared/invalid.ts":
      'import { value } from "../features/alpha/index.js";\nvoid value;\n',
  });

  try {
    const violations = await findBoundaryViolations(fixtureRoot);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.reason ?? "", /shared code/u);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

async function createFixture(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lmw-boundaries-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const file = join(root, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }

  return root;
}
