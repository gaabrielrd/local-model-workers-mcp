import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import {
  OPERATIONAL_LOG_RETENTION_MS,
  OperationalEventSchema,
  createOperationalLogStore,
  inspectOperationalLogs,
  resolveOperationalLogDirectory,
} from "../src/features/operational-logging/index.js";
import {
  createTaskRuntime,
  type TaskTerminalMetadata,
} from "../src/features/task-execution/index.js";

const NOW = Date.UTC(2026, 7, 2, 12);

void test("persists only the allowlisted bounded schema for every terminal state", async (t) => {
  const directory = await fixture(t);
  let id = 0;
  const store = createOperationalLogStore({
    directory,
    now: () => NOW,
    createId: () => `id-${id++}`,
  });
  const events: TaskTerminalMetadata[] = [
    event("completed", null),
    event("blocked", "patch_not_allowed"),
    event("failed", "internal_error"),
    event("cancelled", "task_cancelled"),
    event("timed_out", "processing_timeout"),
  ];

  await Promise.all(events.map((item) => store.record(item)));

  const records = await inspectOperationalLogs(directory);
  assert.equal(records.length, 5);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), [
      "duration_ms",
      "ended_at_ms",
      "error_code",
      "model",
      "started_at_ms",
      "status",
      "task_id",
    ]);
  }
  const serialized = (
    await Promise.all(
      (await readdir(directory)).map((name) =>
        readFile(path.join(directory, name), "utf8"),
      ),
    )
  ).join("\n");
  for (const marker of [
    "SECRET_GOAL",
    "SOURCE_MARKER",
    "Bearer token",
    "diff --git",
    "Authorization",
  ]) {
    assert.equal(serialized.includes(marker), false);
  }
});

void test("rejects metadata bags, controls, unbounded identifiers, and inconsistent events", () => {
  assert.equal(
    OperationalEventSchema.safeParse({
      ...event("completed", null),
      message: "SECRET_GOAL",
    }).success,
    false,
  );
  assert.equal(
    OperationalEventSchema.safeParse({
      ...event("completed", null),
      model: "model\nheader",
    }).success,
    false,
  );
  assert.equal(
    OperationalEventSchema.safeParse({
      ...event("completed", null),
      task_id: "x".repeat(257),
    }).success,
    false,
  );
  assert.equal(
    OperationalEventSchema.safeParse({
      ...event("completed", null),
      duration_ms: 3,
    }).success,
    false,
  );
  assert.equal(
    OperationalEventSchema.safeParse(event("completed", "internal_error"))
      .success,
    false,
  );
});

void test("retains exactly seven days and removes older matching records including malformed ones", async (t) => {
  const directory = await fixture(t);
  const cutoff = NOW - OPERATIONAL_LOG_RETENTION_MS;
  await Promise.all([
    writeFile(path.join(directory, `event-${cutoff - 1}-old.json`), "{}"),
    writeFile(
      path.join(directory, `event-${cutoff - 2}-malformed.json`),
      "not-json",
    ),
    writeFile(path.join(directory, `event-${cutoff}-boundary.json`), "{}"),
    writeFile(path.join(directory, `event-${cutoff + 1}-new.json`), "{}"),
    writeFile(path.join(directory, "unrelated.txt"), "keep"),
  ]);
  const store = createOperationalLogStore({ directory, now: () => NOW });

  assert.equal(await store.cleanup(), 2);
  assert.deepEqual((await readdir(directory)).sort(), [
    `event-${cutoff}-boundary.json`,
    `event-${cutoff + 1}-new.json`,
    "unrelated.txt",
  ]);
});

void test("concurrent record writes remain independent and stdout stays untouched", async (t) => {
  const directory = await fixture(t);
  let id = 0;
  const store = createOperationalLogStore({
    directory,
    now: () => NOW,
    createId: () => `concurrent-${id++}`,
  });
  let stdoutWrites = 0;
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function write() {
    stdoutWrites += 1;
    return true;
  };
  try {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.record({ ...event("completed", null), task_id: `task-${index}` }),
      ),
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(stdoutWrites, 0);
  assert.equal((await inspectOperationalLogs(directory)).length, 50);
});

void test("logging failures cannot change lifecycle results", async (t) => {
  const parent = await fixture(t);
  const invalidDirectory = path.join(parent, "not-a-directory");
  await writeFile(invalidDirectory, "occupied");
  const store = createOperationalLogStore({ directory: invalidDirectory });
  const runtime = createTaskRuntime({
    goal: "SECRET_GOAL",
    configuration: configuration(),
    resultSchema: z.object({ ok: z.literal(true) }).strict(),
    inference,
    language: "en",
    createTaskId: () => "task-logging-failure",
    onTerminal: (metadata) => store.record(metadata),
  });

  const response = await runtime.run(() =>
    Promise.resolve({ status: "completed", result: { ok: true } }),
  );

  assert.equal(response.status, "completed");
});

void test("resolves platform-appropriate application-owned locations", () => {
  assert.equal(
    resolveOperationalLogDirectory("darwin", "/Users/dev"),
    "/Users/dev/Library/Logs/local-model-workers-mcp",
  );
  assert.equal(
    resolveOperationalLogDirectory("linux", "/home/dev", {
      XDG_STATE_HOME: "/state",
    }),
    "/state/local-model-workers-mcp/logs",
  );
  assert.equal(
    resolveOperationalLogDirectory("win32", "C:\\Users\\dev", {
      LOCALAPPDATA: "D:\\State",
    }),
    "D:\\State\\local-model-workers-mcp\\logs",
  );
});

function event(
  status: TaskTerminalMetadata["status"],
  errorCode: TaskTerminalMetadata["error_code"],
): TaskTerminalMetadata {
  return {
    task_id: "task-1",
    started_at_ms: NOW - 25,
    ended_at_ms: NOW,
    duration_ms: 25,
    model: "qwen/qwen3.5-9b",
    status,
    error_code: errorCode,
  };
}

async function fixture(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "operational-logs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const inference: ModelInferencePort = {
  listModels: () => Promise.resolve({ models: ["qwen/qwen3.5-9b"] }),
  isAuthenticationEnforced: () => Promise.resolve(true),
  embedText: () => Promise.reject(new Error("not used")),
  inferStructured: () => Promise.reject(new Error("not used")),
};

function configuration(): EffectiveConfiguration {
  return {
    schema_version: 1,
    revision: `sha256:${"d".repeat(64)}`,
    lm_studio: {
      base_url: "http://127.0.0.1:1234/v1",
      authentication: "bearer",
      token_configured: true,
      allowed_models: ["qwen/qwen3.5-9b"],
      default_model: "qwen/qwen3.5-9b",
    },
    limits: BUILT_IN_LIMITS,
    administrative_maxima: ADMINISTRATIVE_MAXIMA,
    fixed_limits: FIXED_LIMITS,
    origins: {
      "lm_studio.base_url": "protected",
      "lm_studio.authentication": "protected",
      "lm_studio.allowed_models": "protected",
      "lm_studio.default_model": "global",
      "lm_studio.embedding_model": "built_in",
      "lm_studio.model_routing.embedding": "built_in",
      "lm_studio.model_routing.exploration": "built_in",
      "lm_studio.model_routing.test_proposal": "built_in",
      "lm_studio.model_routing.lint_fix": "built_in",
      "lm_studio.model_routing.docs_generation": "built_in",
      "lm_studio.model_routing.summarization": "built_in",
      "lm_studio.model_routing.code_graph": "built_in",
      steering_prompt: "built_in",
      "limits.max_concurrency": "built_in",
      "limits.queue_timeout_ms": "built_in",
      "limits.processing_timeout_ms": "built_in",
      "limits.max_exploration_interactions": "built_in",
      "limits.context_budget_bytes": "built_in",
      "administrative_maxima.max_concurrency": "protected",
      "administrative_maxima.queue_timeout_ms": "protected",
      "administrative_maxima.processing_timeout_ms": "protected",
      "administrative_maxima.max_exploration_interactions": "protected",
      "administrative_maxima.context_budget_bytes": "protected",
      "fixed_limits.patch_max_files": "protected",
      "fixed_limits.patch_max_changed_lines": "protected",
      "fixed_limits.inference_retry_count": "protected",
    },
  };
}
