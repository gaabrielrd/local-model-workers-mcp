import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateModelPerformance,
  runBenchmarkSuite,
} from "../scripts/benchmark-local-models.js";

void test("evaluateModelPerformance scores a passing, fast run near 100", () => {
  const result = evaluateModelPerformance(
    "qwen/test-model",
    "lint_fix",
    50,
    true,
  );
  assert.equal(result.model, "qwen/test-model");
  assert.equal(result.task, "lint_fix");
  assert.equal(result.latency_ms, 50);
  assert.equal(result.pass, true);
  assert.equal(result.score, 100);
});

void test("evaluateModelPerformance penalizes latency and floors failures at zero", () => {
  const slow = evaluateModelPerformance("model", "task", 5_000, true);
  assert.equal(slow.score, 50);

  const failed = evaluateModelPerformance("model", "task", 0, false);
  assert.equal(failed.score, 0);
});

void test("runBenchmarkSuite evaluates every candidate model against the fixed task set", () => {
  const results = runBenchmarkSuite(["model-a", "model-b"]);
  assert.equal(results.length, 6);
  const tasks = new Set(results.map((result) => result.task));
  assert.deepEqual(
    [...tasks].sort(),
    ["exploration", "lint_fix", "test_proposal"].sort(),
  );
  assert.ok(results.every((result) => result.pass === true));
  assert.ok(
    results
      .filter((result) => result.model === "model-a")
      .every((result) => result.model === "model-a"),
  );
});

void test("runBenchmarkSuite defaults to the built-in candidate models", () => {
  const results = runBenchmarkSuite();
  const models = new Set(results.map((result) => result.model));
  assert.deepEqual(
    [...models].sort(),
    ["google/gemma-4-12b-qat", "qwen/qwen3.5-9b"].sort(),
  );
});
