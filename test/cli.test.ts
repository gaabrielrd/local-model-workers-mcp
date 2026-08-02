import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli/main.js";
import { PACKAGE_INFO } from "../src/shared/package-info.js";

const projectRoot = new URL("../", import.meta.url);
const builtCli = new URL("../dist/cli/index.js", import.meta.url);
const builtCliPath = fileURLToPath(builtCli);

void test("package metadata and runtime metadata stay aligned", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", projectRoot), "utf8"),
  ) as { name: string; version: string };

  assert.deepEqual(PACKAGE_INFO, {
    name: packageJson.name,
    version: packageJson.version,
  });
});

void test("the built CLI artifact exists and is executable", async () => {
  await assert.doesNotReject(access(builtCli));

  if (process.platform !== "win32") {
    const metadata = await stat(builtCli);
    assert.notEqual(metadata.mode & 0o111, 0);
  }
});

void test("the CLI starts without writing protocol output", () => {
  const result = spawnSync(process.execPath, [builtCliPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

void test("the CLI reports its version on the diagnostic channel", () => {
  const result = spawnSync(process.execPath, [builtCliPath, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${PACKAGE_INFO.name} ${PACKAGE_INFO.version}\n`);
});

void test("the CLI rejects unknown options without using stdout", () => {
  const diagnostics: string[] = [];

  const exitCode = runCli(["--unknown"], (message) => {
    diagnostics.push(message);
  });

  assert.equal(exitCode, 64);
  assert.deepEqual(diagnostics, ["Unknown option: --unknown\n"]);
});
