import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);

function toolPath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, projectRoot));
}

function runNode(arguments_: readonly string[], cwd?: string) {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;

  return spawnSync(process.execPath, arguments_, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
}

void test("format checking rejects an unformatted file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lmw-format-"));
  const source = join(directory, "unformatted.ts");

  try {
    await writeFile(source, "const value={answer:42}\n", "utf8");

    const result = runNode([
      toolPath("node_modules/prettier/bin/prettier.cjs"),
      "--check",
      source,
    ]);

    assert.notEqual(result.status, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("linting rejects a configured rule violation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lmw-lint-"));
  const source = join(directory, "invalid.js");

  try {
    await writeFile(source, "missingName();\n", "utf8");

    const result = runNode(
      [
        toolPath("node_modules/eslint/bin/eslint.js"),
        "--no-config-lookup",
        "--rule",
        "no-undef:error",
        "invalid.js",
      ],
      directory,
    );

    assert.notEqual(result.status, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("type checking rejects an incompatible assignment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lmw-typecheck-"));
  const source = join(directory, "invalid.ts");

  try {
    await writeFile(source, "const value: string = 42;\nvoid value;\n", "utf8");

    const result = runNode([
      toolPath("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      source,
    ]);

    assert.notEqual(result.status, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("the test runner reports a controlled failing test", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lmw-test-"));
  const source = join(directory, "failing.test.mjs");

  try {
    await writeFile(
      source,
      [
        'import assert from "node:assert/strict";',
        'import test from "node:test";',
        'test("controlled failure", () => assert.fail("expected"));',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runNode(["--test", "failing.test.mjs"], directory);

    assert.notEqual(result.status, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("production build rejects invalid source without emitting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lmw-build-"));
  const source = join(directory, "invalid.ts");
  const output = join(directory, "dist", "invalid.js");
  const configuration = join(directory, "tsconfig.json");

  try {
    await writeFile(source, "const value: string = 42;\nvoid value;\n", "utf8");
    await writeFile(
      configuration,
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmitOnError: true,
          outDir: "dist",
          skipLibCheck: true,
          strict: true,
          target: "ES2024",
        },
        files: ["invalid.ts"],
      }),
      "utf8",
    );

    const result = runNode([
      toolPath("node_modules/typescript/bin/tsc"),
      "--project",
      configuration,
    ]);

    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(output, "utf8"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
