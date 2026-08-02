import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const evidencePath = process.argv[2];
if (evidencePath === undefined) {
  process.stderr.write("Usage: npm run release:measure -- <evidence.json>\n");
  process.exitCode = 64;
} else {
  const document = JSON.parse(
    await readFile(path.resolve(evidencePath), "utf8"),
  );
  assert.equal(document.schema_version, 1);
  assert.ok(Array.isArray(document.runs) && document.runs.length > 0);

  const approvedTools = [
    "check_health",
    "explore_repository",
    "get_config",
    "propose_tests",
    "update_config",
    "validate_config",
  ];
  let evidenceCount = 0;
  let validEvidenceCount = 0;
  let patchCount = 0;
  let applicablePatchCount = 0;
  let appliedPatchCount = 0;
  let executableTestCount = 0;
  let patchPathCount = 0;
  let allowedPatchPathCount = 0;
  const harnesses = new Set();
  const fixtures = new Set();

  for (const run of document.runs) {
    assert.ok(run.harness === "claude-code" || run.harness === "codex");
    harnesses.add(run.harness);
    assert.deepEqual([...run.discovered_tools].sort(), approvedTools);
    const fixtureRoot = path.resolve(run.fixture_root);
    fixtures.add(path.basename(fixtureRoot));
    for (const evidence of run.evidence) {
      evidenceCount += 1;
      const absolutePath = path.resolve(fixtureRoot, evidence.path);
      assert.equal(isContained(fixtureRoot, absolutePath), true);
      const lines = (await readFile(absolutePath, "utf8")).split(/\r?\n/u);
      if (
        Number.isInteger(evidence.start_line) &&
        Number.isInteger(evidence.end_line) &&
        evidence.start_line >= 1 &&
        evidence.end_line >= evidence.start_line &&
        evidence.end_line <= lines.length
      ) {
        validEvidenceCount += 1;
      }
    }
    for (const proposal of run.proposals) {
      patchCount += 1;
      if (proposal.applied_without_conflict === true) {
        applicablePatchCount += 1;
        appliedPatchCount += 1;
        if (proposal.test_command_started === true) {
          executableTestCount += 1;
        }
      }
      for (const patchPath of proposal.paths) {
        patchPathCount += 1;
        if (proposal.paths_allowed === true && isRelativeSafePath(patchPath)) {
          allowedPatchPathCount += 1;
        }
      }
    }
    for (const capturePath of run.capture_files) {
      const captured = await readFile(path.resolve(capturePath), "utf8");
      for (const marker of document.prohibited_fixture_markers) {
        assert.equal(captured.includes(marker), false);
      }
    }
  }

  assert.deepEqual([...harnesses].sort(), ["claude-code", "codex"]);
  assert.deepEqual([...fixtures].sort(), ["python", "typescript"]);

  const metrics = {
    evidence_valid_percent: percentage(validEvidenceCount, evidenceCount),
    patches_applicable_percent: percentage(applicablePatchCount, patchCount),
    applied_tests_started_percent: percentage(
      executableTestCount,
      appliedPatchCount,
    ),
    patch_paths_allowed_percent: percentage(
      allowedPatchPathCount,
      patchPathCount,
    ),
  };
  assert.equal(metrics.evidence_valid_percent, 100);
  assert.ok(metrics.patches_applicable_percent >= 80);
  assert.ok(metrics.applied_tests_started_percent >= 80);
  assert.equal(metrics.patch_paths_allowed_percent, 100);
  process.stdout.write(`${JSON.stringify(metrics, undefined, 2)}\n`);
}

function percentage(numerator, denominator) {
  assert.ok(denominator > 0, "A release metric cannot use an empty sample.");
  return (numerator / denominator) * 100;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isRelativeSafePath(filePath) {
  return (
    typeof filePath === "string" &&
    filePath.length > 0 &&
    !path.isAbsolute(filePath) &&
    !filePath.split(/[\\/]/u).includes("..")
  );
}
