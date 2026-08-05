import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCoverageCommand,
  measureCoverage,
  parseCoverageSummary,
  type CoverageMeasurement,
} from "../src/features/auto-validate/coverage.js";
import type {
  DetectedTestCommand,
  RunSandboxProcessOptions,
  SandboxProcessRun,
} from "../src/features/auto-validate/sandbox.js";

void test("deriveCoverageCommand appends --coverage to npm test", () => {
  const derived = deriveCoverageCommand({ command: "npm", args: ["test"] });
  assert.deepEqual(derived, {
    command: "npm",
    args: ["test", "--", "--coverage"],
  });
});

void test("deriveCoverageCommand appends --cov to python pytest", () => {
  const derived = deriveCoverageCommand({
    command: "python",
    args: ["-m", "pytest"],
  });
  assert.deepEqual(derived, {
    command: "python",
    args: ["-m", "pytest", "--cov"],
  });
});

void test("deriveCoverageCommand appends -cover to go test", () => {
  const derived = deriveCoverageCommand({
    command: "go",
    args: ["test", "./..."],
  });
  assert.deepEqual(derived, {
    command: "go",
    args: ["test", "./...", "-cover"],
  });
});

void test("deriveCoverageCommand leaves unrecognized commands unchanged", () => {
  const original: DetectedTestCommand = { command: "node", args: ["--test"] };
  assert.deepEqual(deriveCoverageCommand(original), original);
});

void test("parseCoverageSummary reads the istanbul table format", () => {
  const output =
    "File      | % Stmts | % Branch | % Funcs | % Lines |\nAll files |   92.15 |    79.32 |   88.46 |   92.71 |";
  assert.equal(parseCoverageSummary(output), 92.71);
});

void test("parseCoverageSummary reads the istanbul text-summary format", () => {
  const output = [
    "Statements   : 92.15% ( 869/943 )",
    "Branches     : 79.32% ( 219/276 )",
    "Functions    : 88.46% ( 138/156 )",
    "Lines        : 92.71% ( 852/919 )",
  ].join("\n");
  assert.equal(parseCoverageSummary(output), 92.71);
});

void test("parseCoverageSummary reads the pytest-cov TOTAL row", () => {
  const output = [
    "Name          Stmts   Miss  Cover",
    "-----------------------------------",
    "app.py           40     10    75%",
    "TOTAL            40     10    75%",
  ].join("\n");
  assert.equal(parseCoverageSummary(output), 75);
});

void test("parseCoverageSummary reads go test coverage output", () => {
  const output = "ok  \tpkg\t0.004s\tcoverage: 78.3% of statements";
  assert.equal(parseCoverageSummary(output), 78.3);
});

void test("parseCoverageSummary returns undefined when no known format matches", () => {
  assert.equal(parseCoverageSummary("2 passed, 0 failed"), undefined);
});

void test("measureCoverage returns the parsed percentage from the injected runner", async () => {
  const testCommand: DetectedTestCommand = { command: "npm", args: ["test"] };
  let received: RunSandboxProcessOptions | undefined;
  const commandRunner = (
    options: RunSandboxProcessOptions,
  ): Promise<SandboxProcessRun> => {
    received = options;
    return Promise.resolve(
      passingRun("All files |   50 |   50 |   50 |   50 |"),
    );
  };

  const result = await measureCoverage({
    sandboxRoot: "/sandbox",
    testCommand,
    timeout_ms: 5_000,
    commandRunner,
  });

  const expected: CoverageMeasurement = { line_coverage_percent: 50 };
  assert.deepEqual(result, expected);
  assert.deepEqual(received?.args, ["test", "--", "--coverage"]);
});

void test("measureCoverage returns undefined when the run fails or is unparsable", async () => {
  const testCommand: DetectedTestCommand = { command: "npm", args: ["test"] };
  const result = await measureCoverage({
    sandboxRoot: "/sandbox",
    testCommand,
    timeout_ms: 5_000,
    commandRunner: () =>
      Promise.resolve(passingRun("no coverage tool installed")),
  });
  assert.equal(result, undefined);
});

void test("measureCoverage propagates abort errors instead of swallowing them", async () => {
  const testCommand: DetectedTestCommand = { command: "npm", args: ["test"] };
  await assert.rejects(
    measureCoverage({
      sandboxRoot: "/sandbox",
      testCommand,
      timeout_ms: 5_000,
      commandRunner: () =>
        Promise.reject(new DOMException("aborted", "AbortError")),
    }),
    { name: "AbortError" },
  );
});

function passingRun(output: string): SandboxProcessRun {
  return {
    exit_code: 0,
    signal_code: null,
    stdout: output,
    stderr: "",
    stdout_truncated: false,
    stderr_truncated: false,
    timed_out: false,
    error: null,
    duration_ms: 1,
  };
}
