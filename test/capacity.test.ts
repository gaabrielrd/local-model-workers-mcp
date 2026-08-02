import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  CapacityError,
  createFileSystemCapacityCoordinator,
  resolveCapacityStateDirectory,
} from "../src/features/task-execution/index.js";

void test("enforces capacity and FIFO order without oversubscription", async (t) => {
  const directory = await temporaryDirectory(t);
  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 2,
    pollIntervalMs: 5,
  });
  let active = 0;
  let maximumActive = 0;
  const acquired: string[] = [];
  const queued = new Set<string>();
  const gates = [
    deferred<void>(),
    deferred<void>(),
    deferred<void>(),
    deferred<void>(),
  ];
  const tasks: Promise<void>[] = [];
  const start = (taskId: string, index: number): void => {
    tasks.push(
      coordinator.runWithCapacity(
        {
          task_id: taskId,
          queue_timeout_ms: 1_000,
          onQueued: () => queued.add(taskId),
        },
        async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          acquired.push(taskId);
          await gates[index]?.promise;
          active -= 1;
        },
      ),
    );
  };

  start("first", 0);
  await waitFor(() => acquired.length === 1);
  start("second", 1);
  await waitFor(() => acquired.length === 2);
  start("third", 2);
  await waitFor(() => queued.has("third"));
  start("fourth", 3);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(acquired, ["first", "second"]);
  gates[0]?.resolve();
  await waitFor(() => acquired.length === 3);
  assert.deepEqual(acquired, ["first", "second", "third"]);
  gates[1]?.resolve();
  await waitFor(() => acquired.length === 4);
  assert.deepEqual(acquired, ["first", "second", "third", "fourth"]);
  gates[2]?.resolve();
  gates[3]?.resolve();
  await Promise.all(tasks);
  assert.equal(maximumActive, 2);
});

void test("times out and cancels queued work without starting it", async (t) => {
  const directory = await temporaryDirectory(t);
  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 5,
  });
  const gate = deferred<void>();
  let firstStarted = false;
  const first = coordinator.runWithCapacity(
    { task_id: "occupant", queue_timeout_ms: 1_000 },
    async () => {
      firstStarted = true;
      await gate.promise;
    },
  );
  await waitFor(() => firstStarted);

  let timedOutWork = false;
  await assert.rejects(
    coordinator.runWithCapacity(
      { task_id: "timed-out", queue_timeout_ms: 20 },
      () => {
        timedOutWork = true;
        return Promise.resolve();
      },
    ),
    isCapacityError("queue_timeout"),
  );
  assert.equal(timedOutWork, false);

  const cancellation = new AbortController();
  let cancelledWork = false;
  const cancelled = coordinator.runWithCapacity(
    {
      task_id: "cancelled",
      queue_timeout_ms: 1_000,
      signal: cancellation.signal,
    },
    () => {
      cancelledWork = true;
      return Promise.resolve();
    },
  );
  cancellation.abort();
  await assert.rejects(cancelled, isCapacityError("task_cancelled"));
  assert.equal(cancelledWork, false);

  gate.resolve();
  await first;
});

void test("releases processing ownership after cancellation", async (t) => {
  const directory = await temporaryDirectory(t);
  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 5,
  });
  const cancellation = new AbortController();
  let firstStarted = false;
  const first = coordinator.runWithCapacity(
    {
      task_id: "processing",
      queue_timeout_ms: 1_000,
      signal: cancellation.signal,
    },
    () => {
      firstStarted = true;
      return rejectOnAbort(cancellation.signal);
    },
  );
  await waitFor(() => firstStarted);
  cancellation.abort();
  await assert.rejects(first);

  let successorStarted = false;
  await coordinator.runWithCapacity(
    { task_id: "successor", queue_timeout_ms: 1_000 },
    () => {
      successorStarted = true;
      return Promise.resolve();
    },
  );
  assert.equal(successorStarted, true);
});

void test("recovers dead owners and an abandoned exact lock", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(
    path.join(directory, "capacity-state.json"),
    JSON.stringify({
      schema_version: 1,
      capacity: 1,
      next_sequence: 1,
      queue: [],
      active: [
        {
          task_id: "abandoned",
          owner_id: "00000000-0000-4000-8000-000000000001",
          process_id: 424_242,
          acquired_at_ms: 1,
        },
      ],
    }),
  );
  const lockDirectory = path.join(directory, "capacity-state.lock");
  await mkdir(lockDirectory);
  await writeFile(
    path.join(lockDirectory, "owner.json"),
    JSON.stringify({
      owner_id: "00000000-0000-4000-8000-000000000002",
      process_id: 424_243,
    }),
  );
  await utimes(lockDirectory, new Date(0), new Date(0));
  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 1,
    staleLockMs: 1,
    isProcessAlive: () => false,
  });

  let started = false;
  await coordinator.runWithCapacity(
    { task_id: "recovered", queue_timeout_ms: 1_000 },
    () => {
      started = true;
      return Promise.resolve();
    },
  );

  assert.equal(started, true);
});

void test("fails closed on corrupt state and live capacity mismatch", async (t) => {
  const corruptDirectory = await temporaryDirectory(t);
  await writeFile(
    path.join(corruptDirectory, "capacity-state.json"),
    "not-json",
  );
  const corrupt = createFileSystemCapacityCoordinator({
    stateDirectory: corruptDirectory,
    capacity: 1,
  });
  await assert.rejects(
    corrupt.runWithCapacity({ task_id: "corrupt", queue_timeout_ms: 100 }, () =>
      Promise.resolve(),
    ),
    isCapacityError("coordination_corrupt"),
  );

  const mismatchDirectory = await temporaryDirectory(t);
  const first = createFileSystemCapacityCoordinator({
    stateDirectory: mismatchDirectory,
    capacity: 1,
    pollIntervalMs: 5,
  });
  const gate = deferred<void>();
  let started = false;
  const occupying = first.runWithCapacity(
    { task_id: "one", queue_timeout_ms: 1_000 },
    async () => {
      started = true;
      await gate.promise;
    },
  );
  await waitFor(() => started);
  const different = createFileSystemCapacityCoordinator({
    stateDirectory: mismatchDirectory,
    capacity: 2,
  });
  await assert.rejects(
    different.runWithCapacity({ task_id: "two", queue_timeout_ms: 100 }, () =>
      Promise.resolve(),
    ),
    isCapacityError("configuration_mismatch"),
  );
  gate.resolve();
  await occupying;
});

void test("coordination artifacts contain metadata only", async (t) => {
  const directory = await temporaryDirectory(t);
  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
  });
  const privateContent = "PRIVATE-GOAL-SNIPPET-PROMPT-RESPONSE-PATCH";
  await coordinator.runWithCapacity(
    { task_id: "metadata-only", queue_timeout_ms: 1_000 },
    () => {
      void privateContent;
      return Promise.resolve();
    },
  );

  const state = await readFile(
    path.join(directory, "capacity-state.json"),
    "utf8",
  );
  assert.equal(state.includes(privateContent), false);
  assert.deepEqual(Object.keys(JSON.parse(state) as object).sort(), [
    "active",
    "capacity",
    "next_sequence",
    "queue",
    "schema_version",
  ]);
});

void test("uses portable global state locations and protected maxima", () => {
  assert.equal(
    resolveCapacityStateDirectory({
      platform: "darwin",
      homeDirectory: "/Users/dev",
      environment: {},
    }),
    "/Users/dev/Library/Application Support/local-model-workers/coordination",
  );
  assert.equal(
    resolveCapacityStateDirectory({
      platform: "linux",
      homeDirectory: "/home/dev",
      environment: { XDG_CONFIG_HOME: "/config" },
    }),
    "/config/local-model-workers/coordination",
  );
  assert.equal(
    resolveCapacityStateDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\dev",
      environment: { APPDATA: "D:\\Profile" },
    }),
    "D:\\Profile\\local-model-workers\\coordination",
  );
  assert.throws(
    () =>
      createFileSystemCapacityCoordinator({
        stateDirectory: "/tmp/never-created",
        capacity: 5,
      }),
    isCapacityError("coordination_unavailable"),
  );
});

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-capacity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function deferred<Value>() {
  let resolvePromise: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value?: Value) => {
      resolvePromise?.(value as Value);
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("processing cancelled"));
      },
      { once: true },
    );
  });
}

function isCapacityError(code: CapacityError["code"]) {
  return (error: unknown): boolean =>
    error instanceof CapacityError && error.code === code;
}
