import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const projectRootPath = fileURLToPath(projectRoot);
const execFileAsync = promisify(execFile);
const approvedTools = [
  "check_health",
  "explore_repository",
  "get_config",
  "propose_tests",
  "update_config",
  "validate_config",
];

void test("traceability names every approved requirement and acceptance criterion", async () => {
  const [prd, traceability] = await Promise.all([
    readFile(new URL("prd.md", projectRoot), "utf8"),
    readFile(new URL("docs/tasks/traceability.md", projectRoot), "utf8"),
  ]);
  const required = identifiers(prd);
  const traced = identifiers(traceability);

  assert.equal([...required].filter((id) => id.startsWith("RF-")).length, 29);
  assert.equal([...required].filter((id) => id.startsWith("CA-")).length, 52);
  assert.deepEqual([...traced].sort(), [...required].sort());
});

void test("the portability workflow validates and installs on all target systems", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/validate.yml", projectRoot),
    "utf8",
  );
  assert.match(workflow, /macos-latest/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /npm run test:unit/u);
  assert.match(workflow, /npm run release:smoke/u);
});

void test("official release fixtures cover TypeScript, Python, and prohibited markers", async () => {
  const files = [
    "test/fixtures/release/typescript/src/pricing.js",
    "test/fixtures/release/typescript/test/smoke.test.js",
    "test/fixtures/release/typescript/credentials.json",
    "test/fixtures/release/python/src/pricing.py",
    "test/fixtures/release/python/tests/test_smoke.py",
    "test/fixtures/release/python/credentials.json",
  ];
  const contents = await Promise.all(
    files.map((file) => readFile(new URL(file, projectRoot), "utf8")),
  );
  assert.match(contents.join("\n"), /RELEASE_PROHIBITED_MARKER_TYPESCRIPT/u);
  assert.match(contents.join("\n"), /RELEASE_PROHIBITED_MARKER_PYTHON/u);
});

void test("release measurement enforces the approved quantitative thresholds", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lmw-measure-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const capture = path.join(temporaryRoot, "capture.jsonl");
  const evidencePath = path.join(temporaryRoot, "evidence.json");
  await writeFile(capture, '{"event":"safe"}\n');
  const run = (
    harness: "claude-code" | "codex",
    fixture: "typescript" | "python",
    sourcePath: string,
    patchPath: string,
  ): object => ({
    harness,
    fixture_root: path.join(
      projectRootPath,
      "test",
      "fixtures",
      "release",
      fixture,
    ),
    discovered_tools: approvedTools,
    evidence: [{ path: sourcePath, start_line: 1, end_line: 1 }],
    proposals: [
      {
        applied_without_conflict: true,
        test_command_started: true,
        paths_allowed: true,
        paths: [patchPath],
      },
    ],
    capture_files: [capture],
  });
  await writeFile(
    evidencePath,
    JSON.stringify({
      schema_version: 1,
      prohibited_fixture_markers: [
        "RELEASE_PROHIBITED_MARKER_TYPESCRIPT",
        "RELEASE_PROHIBITED_MARKER_PYTHON",
      ],
      runs: [
        run(
          "claude-code",
          "typescript",
          "src/pricing.js",
          "test/pricing.test.js",
        ),
        run("codex", "python", "src/pricing.py", "tests/test_pricing.py"),
      ],
    }),
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(projectRootPath, "scripts", "release", "measure-scenarios.mjs"),
      evidencePath,
    ],
    { encoding: "utf8" },
  );
  const metrics = JSON.parse(stdout) as Record<string, number>;
  assert.deepEqual(metrics, {
    evidence_valid_percent: 100,
    patches_applicable_percent: 100,
    applied_tests_started_percent: 100,
    patch_paths_allowed_percent: 100,
  });
});

function identifiers(contents: string): ReadonlySet<string> {
  return new Set(contents.match(/\b(?:RF|CA)-\d{2}\b/gu) ?? []);
}
