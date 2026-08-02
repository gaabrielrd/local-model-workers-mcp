import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

void test("the package candidate contains only runtime artifacts and documentation", async (t) => {
  const cacheDirectory = await mkdtemp(
    path.join(os.tmpdir(), "lmw-npm-cache-"),
  );
  t.after(async () => rm(cacheDirectory, { recursive: true, force: true }));
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cacheDirectory },
      ...(process.platform === "win32" ? { shell: true } : {}),
    },
  );
  const result = JSON.parse(stdout) as readonly [
    { files: readonly { path: string }[] },
  ];
  const paths = result[0]?.files.map((file) => file.path).sort() ?? [];

  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("dist/cli/index.js"));
  assert.equal(
    paths.some((filePath) => filePath.startsWith("src/")),
    false,
  );
  assert.equal(
    paths.some((filePath) => filePath.startsWith("test/")),
    false,
  );
  assert.equal(
    paths.some((filePath) => path.basename(filePath).startsWith(".env")),
    false,
  );
});
