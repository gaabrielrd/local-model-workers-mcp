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

void test("invalid startup configuration fails without writing protocol output or secrets", () => {
  const secret = "startup-secret-marker";
  const result = spawnSync(process.execPath, [builtCliPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      LMW_LM_STUDIO_BEARER_TOKEN: secret,
      LMW_LM_STUDIO_BASE_URL: "invalid-url",
    },
  });

  assert.equal(result.status, 78);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Invalid startup configuration.\n");
  assert.equal(result.stderr.includes(secret), false);
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

  const exitCode = runCli(
    ["--unknown"],
    (message) => {
      diagnostics.push(message);
    },
    { environment: {}, stream: { isTTY: false }, platform: "linux" },
  );

  assert.equal(exitCode, 64);
  const text = diagnostics.join("");
  assert.match(text, /Unknown option: --unknown/);
  assert.match(text, /--help/);
});

void test("plain-capability help renders without escape sequences", () => {
  const diagnostics: string[] = [];

  const exitCode = runCli(
    ["--help"],
    (message) => {
      diagnostics.push(message);
    },
    { environment: {}, stream: { isTTY: false }, platform: "linux" },
  );

  assert.equal(exitCode, 0);
  const text = diagnostics.join("");
  assert.match(text, /USAGE/);
  assert.match(text, /setup/);
  assert.match(text, /configure-harness/);
  // A non-TTY diagnostic stream must never receive ANSI styling.
  assert.equal(text.includes("\x1b["), false);
});
