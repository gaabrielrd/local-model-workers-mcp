import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

void test("ships an executable WSL2 setup script with interactive and non-interactive modes", async () => {
  const scriptPath = path.join(projectRoot, "scripts/wsl2", "setup-wsl2.sh");
  const content = await readFile(scriptPath, "utf8");

  assert.match(content, /^#!\/usr\/bin\/env bash/u);
  assert.match(content, /set -euo pipefail/u);
  assert.match(content, /setup --target/u);
  assert.match(content, /--yes/u);
  assert.match(content, /run_args=\(local-model-workers-mcp\)/u);
  assert.match(content, /WSL2/u);
  assert.match(content, /Node\.js/u);

  if (process.platform !== "win32") {
    const mode = (await stat(scriptPath)).mode & 0o111;
    assert.notEqual(mode, 0);
  }
});

void test("the Docker container starts the CLI entrypoint", async () => {
  const dockerfile = await readFile(
    path.join(projectRoot, "Dockerfile"),
    "utf8",
  );
  assert.ok(dockerfile.includes('CMD ["node", "dist/cli/index.js"]'));
});
