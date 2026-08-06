import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXPLORATION_MIN_ATTEMPTS,
  selectAdaptiveModel,
  type ModelScore,
} from "../src/features/configuration/index.js";
import {
  createOperationalLogStore,
  readRoutingScores,
} from "../src/features/operational-logging/index.js";

/** Inside the rollup's retention window, so the day is not pruned on write. */
const RECENT = Date.now() - 60_000;

function score(overrides: Partial<ModelScore> & { model: string }): ModelScore {
  return {
    task_type: "exploration",
    attempts: 50,
    completion_rate: 1,
    model_fault_rate: 0,
    patch_rejection_rate: 0,
    mean_duration_ms: 1_000,
    ...overrides,
  };
}

void test("the model with the better record wins", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["good/model", "flaky/model"],
    scores: [
      score({ model: "good/model", completion_rate: 0.95 }),
      score({
        model: "flaky/model",
        completion_rate: 0.5,
        model_fault_rate: 0.5,
      }),
    ],
  });

  assert.equal(selection?.model, "good/model");
  assert.equal(selection?.reason, "score");
});

void test("a fast model that produces unusable output does not win on speed", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["fast/broken", "slow/works"],
    scores: [
      score({
        model: "fast/broken",
        completion_rate: 0.4,
        model_fault_rate: 0.6,
        mean_duration_ms: 100,
      }),
      score({
        model: "slow/works",
        completion_rate: 0.98,
        mean_duration_ms: 9_000,
      }),
    ],
  });

  assert.equal(selection?.model, "slow/works");
});

void test("latency breaks a tie between models of equal quality", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["slow/model", "quick/model"],
    scores: [
      score({ model: "slow/model", mean_duration_ms: 8_000 }),
      score({ model: "quick/model", mean_duration_ms: 800 }),
    ],
  });

  assert.equal(selection?.model, "quick/model");
});

void test("a newly added model is explored rather than starved", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["incumbent/model", "new/model"],
    scores: [
      // The incumbent has a long, excellent record.
      score({ model: "incumbent/model", attempts: 500 }),
      score({ model: "new/model", attempts: 1, completion_rate: 1 }),
    ],
  });

  assert.equal(selection?.model, "new/model");
  assert.equal(selection?.reason, "exploration");
});

void test("a model with no record at all is explored first", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["incumbent/model", "never/tried"],
    scores: [score({ model: "incumbent/model", attempts: 500 })],
  });

  assert.equal(selection?.model, "never/tried");
  assert.equal(selection?.reason, "exploration");
});

void test("exploration stops once a model has enough attempts to judge", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["incumbent/model", "tried/enough"],
    scores: [
      score({ model: "incumbent/model", attempts: 500 }),
      score({
        model: "tried/enough",
        attempts: EXPLORATION_MIN_ATTEMPTS,
        completion_rate: 0.1,
        model_fault_rate: 0.9,
      }),
    ],
  });

  assert.equal(selection?.model, "incumbent/model");
  assert.equal(selection?.reason, "score");
});

void test("scores from another routing slot are ignored", () => {
  const selection = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["a/model"],
    scores: [score({ model: "a/model", task_type: "lint_fix" })],
  });

  // The only candidate has no record for this slot, so it is explored.
  assert.equal(selection?.reason, "exploration");
});

void test("no candidates and no data yield no selection, never a guess", () => {
  assert.equal(
    selectAdaptiveModel({
      taskType: "exploration",
      candidates: [],
      scores: [score({ model: "a/model" })],
    }),
    undefined,
  );
  // A wildcard policy names no concrete model to rank.
  assert.equal(
    selectAdaptiveModel({
      taskType: "exploration",
      candidates: ["*"],
      scores: [],
    }),
    undefined,
  );
});

void test("the same data always yields the same choice", () => {
  const scores = [score({ model: "b/model" }), score({ model: "a/model" })];
  const first = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["b/model", "a/model"],
    scores,
  });
  const second = selectAdaptiveModel({
    taskType: "exploration",
    candidates: ["a/model", "b/model"],
    scores,
  });

  assert.equal(first?.model, second?.model);
  assert.equal(first?.model, "a/model");
});

void test("recorded events become per-slot scores", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-scores-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createOperationalLogStore({ directory });

  // Inside the rollup's retention window; a stale timestamp is pruned on write.
  let at = Date.now() - 60_000;
  const record = async (event: {
    model: string;
    status: "completed" | "failed";
    error_code: string | null;
    duration: number;
  }): Promise<void> => {
    at += 1_000;
    await store.record({
      task_id: `task-${String(at)}`,
      task_type: "exploration",
      started_at_ms: at,
      ended_at_ms: at + event.duration,
      duration_ms: event.duration,
      model: event.model,
      status: event.status,
      error_code: event.error_code as never,
    });
    at += event.duration;
  };

  await record({
    model: "good/model",
    status: "completed",
    error_code: null,
    duration: 1_000,
  });
  await record({
    model: "good/model",
    status: "completed",
    error_code: null,
    duration: 3_000,
  });
  await record({
    model: "bad/model",
    status: "failed",
    error_code: "inference_failed",
    duration: 500,
  });

  const scores = await readRoutingScores(directory);
  const byModel = new Map(scores.map((entry) => [entry.model, entry]));

  assert.equal(byModel.get("good/model")?.attempts, 2);
  assert.equal(byModel.get("good/model")?.completion_rate, 1);
  assert.equal(byModel.get("good/model")?.mean_duration_ms, 2_000);
  assert.equal(byModel.get("bad/model")?.model_fault_rate, 1);
  assert.equal(byModel.get("bad/model")?.completion_rate, 0);
  assert.equal(byModel.get("good/model")?.task_type, "exploration");
});

void test("a provider outage is not counted against the model", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-scores-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createOperationalLogStore({ directory });

  await store.record({
    task_id: "task-outage",
    task_type: "exploration",
    started_at_ms: RECENT,
    ended_at_ms: RECENT + 1_000,
    duration_ms: 1_000,
    model: "innocent/model",
    status: "failed",
    // The server was down. That says nothing about the model's quality, and
    // counting it would route away from a good model during every outage.
    error_code: "model_unavailable",
  });

  const scores = await readRoutingScores(directory);
  const entry = scores.find((item) => item.model === "innocent/model");
  assert.equal(entry?.attempts, 1);
  assert.equal(entry?.model_fault_rate, 0);
  assert.equal(entry?.patch_rejection_rate, 0);
});

void test("a rejected patch is counted separately from a model fault", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-scores-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createOperationalLogStore({ directory });

  await store.record({
    task_id: "task-patch",
    task_type: "test_proposal",
    started_at_ms: RECENT,
    ended_at_ms: RECENT + 1_000,
    duration_ms: 1_000,
    model: "verbose/model",
    status: "failed",
    error_code: "patch_limit_exceeded",
  });

  const scores = await readRoutingScores(directory);
  const entry = scores.find((item) => item.model === "verbose/model");
  assert.equal(entry?.patch_rejection_rate, 1);
  assert.equal(entry?.model_fault_rate, 0);
});

void test("an event without a routing slot is recorded but not scored", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-scores-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createOperationalLogStore({ directory });

  await store.record({
    task_id: "task-unslotted",
    started_at_ms: RECENT,
    ended_at_ms: RECENT + 1_000,
    duration_ms: 1_000,
    model: "some/model",
    status: "completed",
    error_code: null,
  });

  assert.deepEqual(await readRoutingScores(directory), []);
});

void test("an empty history yields no scores rather than an opinion", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-scores-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await readRoutingScores(directory), []);
});
