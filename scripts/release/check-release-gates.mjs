/**
 * Consolidated release-gate report.
 *
 * `docs/release-qualification.md` lists gates that no local run can truthfully
 * produce: real Claude Code and Codex scenario runs, and a green three-OS CI
 * matrix for the exact candidate commit. This script turns that prose into a
 * mechanical check so "the gates passed" is an assertion about artifacts rather
 * than a claim in a document.
 *
 * Every gate reports one of:
 *   met          — an artifact proves it
 *   unmet        — an artifact proves it failed
 *   unverifiable — no artifact exists here; an operator must supply it
 *
 * Exit code is 0 only when every gate is `met`. `--report-only` always exits 0.
 *
 *   node scripts/release/check-release-gates.mjs [evidence.json] [--report-only]
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const reportOnly = args.includes("--report-only");
const evidencePath = args.find((value) => !value.startsWith("--"));

const gates = [];

function record(id, title, status, detail) {
  gates.push({ id, title, status, detail });
}

function git(...cliArgs) {
  const result = spawnSync("git", cliArgs, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** Pulls the assertion message out of a Node stack trace for the report line. */
function firstFailureLine(stderr, stdout) {
  const lines = `${stderr ?? ""}\n${stdout ?? ""}`.split("\n");
  const assertion = lines.find(
    (line) =>
      /AssertionError|Expected values|ERR_ASSERTION|Error:/u.test(line) &&
      !line.includes("node:internal"),
  );
  const fallback = lines.find(
    (line) => line.trim().length > 0 && !line.includes("node:internal"),
  );
  return (assertion ?? fallback ?? "measurement failed").trim().slice(0, 160);
}

// --- Candidate identity ---------------------------------------------------
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain");
if (commit === undefined) {
  record(
    "candidate",
    "Candidate commit is identified",
    "unverifiable",
    "not a git repository",
  );
} else if (dirty !== "") {
  record(
    "candidate",
    "Candidate commit is identified",
    "unmet",
    "the working tree has uncommitted changes, so the candidate is not a fixed commit",
  );
} else {
  record(
    "candidate",
    "Candidate commit is identified",
    "met",
    `${commit.slice(0, 12)} with a clean working tree`,
  );
}

// --- Package is not accidentally publishable while gates pend -------------
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
record(
  "version",
  "Candidate version is recorded",
  "met",
  `v${manifest.version}`,
);

// --- Evidence + measurement ----------------------------------------------
if (evidencePath === undefined) {
  record(
    "harness-scenarios",
    "Real Claude Code and Codex scenario runs (CA-47..CA-51)",
    "unverifiable",
    "no evidence file supplied; run scripts/release/run-harness-scenarios.mjs against a real LM Studio and pass the result here",
  );
  record(
    "measurement",
    "release:measure thresholds pass on candidate evidence",
    "unverifiable",
    "no evidence file supplied",
  );
} else if (!existsSync(evidencePath)) {
  record(
    "harness-scenarios",
    "Real Claude Code and Codex scenario runs (CA-47..CA-51)",
    "unmet",
    `evidence file not found: ${evidencePath}`,
  );
  record(
    "measurement",
    "release:measure thresholds pass on candidate evidence",
    "unmet",
    "evidence file not found",
  );
} else {
  let document;
  try {
    document = JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    document = undefined;
    record(
      "harness-scenarios",
      "Real Claude Code and Codex scenario runs (CA-47..CA-51)",
      "unmet",
      `evidence file is not valid JSON: ${error.message}`,
    );
  }

  if (document !== undefined) {
    const harnesses = new Set((document.runs ?? []).map((run) => run.harness));
    const missing = ["claude-code", "codex"].filter(
      (harness) => !harnesses.has(harness),
    );
    if (missing.length > 0) {
      record(
        "harness-scenarios",
        "Real Claude Code and Codex scenario runs (CA-47..CA-51)",
        "unmet",
        `no recorded runs for: ${missing.join(", ")}`,
      );
    } else {
      record(
        "harness-scenarios",
        "Real Claude Code and Codex scenario runs (CA-47..CA-51)",
        "met",
        `${document.runs.length} run(s) across ${[...harnesses].sort().join(", ")}`,
      );
    }

    const measure = spawnSync(
      process.execPath,
      [path.join("scripts", "release", "measure-scenarios.mjs"), evidencePath],
      { encoding: "utf8" },
    );
    record(
      "measurement",
      "release:measure thresholds pass on candidate evidence",
      measure.status === 0 ? "met" : "unmet",
      measure.status === 0
        ? "all thresholds satisfied"
        : firstFailureLine(measure.stderr, measure.stdout),
    );
  }
}

// --- Cross-platform CI ----------------------------------------------------
// Requires a GitHub token; without one this can only be confirmed by a human
// looking at the checks for the candidate commit.
const ciStatus = process.env.LMW_RELEASE_CI_STATUS;
if (ciStatus === "green") {
  record(
    "ci-matrix",
    "macOS, Linux, and Windows CI green for the candidate commit (CA-52)",
    "met",
    "asserted via LMW_RELEASE_CI_STATUS=green",
  );
} else if (ciStatus !== undefined) {
  record(
    "ci-matrix",
    "macOS, Linux, and Windows CI green for the candidate commit (CA-52)",
    "unmet",
    `LMW_RELEASE_CI_STATUS=${ciStatus}`,
  );
} else {
  record(
    "ci-matrix",
    "macOS, Linux, and Windows CI green for the candidate commit (CA-52)",
    "unverifiable",
    "confirm all three jobs are green for this exact commit, then set LMW_RELEASE_CI_STATUS=green",
  );
}

// --- Report ---------------------------------------------------------------
const symbols = { met: "PASS", unmet: "FAIL", unverifiable: "????" };
const width = Math.max(...gates.map((gate) => gate.title.length));

process.stdout.write("\nRelease gates\n");
process.stdout.write(`${"-".repeat(width + 18)}\n`);
for (const gate of gates) {
  process.stdout.write(
    `[${symbols[gate.status]}] ${gate.title.padEnd(width)}  ${gate.detail}\n`,
  );
}

const unmet = gates.filter((gate) => gate.status !== "met");
process.stdout.write(`${"-".repeat(width + 18)}\n`);
if (unmet.length === 0) {
  process.stdout.write("All gates met. Promotion is allowed.\n\n");
} else {
  process.stdout.write(
    `${unmet.length} gate(s) not met. Do not run npm publish.\n\n`,
  );
}

process.exitCode = reportOnly || unmet.length === 0 ? 0 : 1;
