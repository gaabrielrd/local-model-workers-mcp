import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "lmw-release-smoke-"),
);
const npmCache = path.join(temporaryRoot, "npm-cache");
const firstPack = path.join(temporaryRoot, "pack-1");
const secondPack = path.join(temporaryRoot, "pack-2");
const installPrefix = path.join(temporaryRoot, "install");
const fakeHome = path.join(temporaryRoot, "home");
const fakeProject = path.join(temporaryRoot, "project");

try {
  await Promise.all([
    mkdir(firstPack, { recursive: true }),
    mkdir(secondPack, { recursive: true }),
    mkdir(fakeHome, { recursive: true }),
    mkdir(fakeProject, { recursive: true }),
  ]);
  const firstTarball = await pack(firstPack);
  const secondTarball = await pack(secondPack);
  const artifactDigest = await digest(firstTarball);
  assert.equal(artifactDigest, await digest(secondTarball));

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const spawnOptions = {
    cwd: temporaryRoot,
    env: commandEnvironment(),
    ...(process.platform === "win32" ? { shell: true } : {}),
  };

  await execFileAsync(
    npmCommand,
    [
      "install",
      "--prefix",
      installPrefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      firstTarball,
    ],
    spawnOptions,
  );

  const installedRoot = path.join(
    installPrefix,
    "node_modules",
    "local-model-workers-mcp",
  );
  const installedCli = path.join(installedRoot, "dist", "cli", "index.js");
  const binary = path.join(
    installPrefix,
    "node_modules",
    ".bin",
    process.platform === "win32"
      ? "local-model-workers-mcp.cmd"
      : "local-model-workers-mcp",
  );
  await Promise.all([access(installedCli), access(binary)]);
  const version = await execFileAsync(
    process.execPath,
    [installedCli, "--version"],
    {
      encoding: "utf8",
    },
  );
  assert.match(version.stderr, /^local-model-workers-mcp \d+\.\d+\.\d+/u);
  assert.equal(version.stdout, "");

  const environment = commandEnvironment({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    APPDATA: path.join(fakeHome, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(fakeHome, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(fakeHome, ".config"),
    XDG_STATE_HOME: path.join(fakeHome, ".local", "state"),
    LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
    LMW_ALLOWED_MODELS: '["release/smoke-model"]',
  });
  const harness = await execFileAsync(
    process.execPath,
    [
      installedCli,
      "configure-harness",
      "--target",
      "both",
      "--project-root",
      fakeProject,
      "--home",
      fakeHome,
      "--dry-run",
    ],
    { encoding: "utf8", env: environment },
  );
  assert.equal(harness.stdout, "");
  assert.match(harness.stderr, /Dry run complete; no files changed\./u);

  await execFileAsync(
    process.execPath,
    [
      installedCli,
      "configure-global",
      "--default-model",
      "release/smoke-model",
      "--home",
      fakeHome,
      "--yes",
    ],
    { encoding: "utf8", env: environment },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedCli],
    cwd: fakeProject,
    env: environment,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "release-smoke", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "analyze_diff",
      "auto_validate_tests",
      "check_health",
      "explore_repository",
      "fix_lint_violations",
      "fix_type_errors",
      "generate_docs_patch",
      "get_config",
      "get_offload_stats",
      "propose_tests",
      "query_code_graph",
      "search_semantic",
      "summarize_module",
      "update_config",
      "validate_config",
    ]);
    const configuration = await client.callTool({
      name: "get_config",
      arguments: {},
    });
    const serialized = JSON.stringify(configuration.structuredContent);
    assert.match(serialized, /"authentication":"none"/u);
    assert.match(serialized, /"bearer_token":null/u);
  } finally {
    await client.close();
  }

  process.stdout.write(
    `release package smoke passed (sha256:${artifactDigest})\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function pack(destination) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(
    npmCommand,
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: commandEnvironment(),
      ...(process.platform === "win32" ? { shell: true } : {}),
    },
  );
  const result = JSON.parse(stdout);
  const filename = result[0]?.filename;
  assert.equal(typeof filename, "string");
  return path.join(destination, filename);
}

async function digest(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function commandEnvironment(additions = {}) {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      npm_config_cache: npmCache,
      ...additions,
    }).filter((entry) => typeof entry[1] === "string"),
  );
}
