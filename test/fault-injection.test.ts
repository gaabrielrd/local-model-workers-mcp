import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CircuitBreaker,
  InferenceError,
  createLmStudioClient,
  parseSseStream,
} from "../src/features/model-inference/index.js";
import { createFileSystemCapacityCoordinator } from "../src/features/task-execution/index.js";
import { startFaultResponder } from "./fault-injection/responder.js";

/* ------------------------------------------------------------------ *
 * Transport faults
 * ------------------------------------------------------------------ */

void test("a provider that dies mid-body fails closed instead of hanging", async (t) => {
  const responder = await startFaultResponder([
    { kind: "disconnect-mid-body" },
  ]);
  t.after(() => responder.close());

  const client = createLmStudioClient({
    baseUrl: responder.baseUrl,
    allowedModels: ["*"],
  });

  await assert.rejects(
    client.listModels({ timeout_ms: 5_000 }),
    (error: unknown) => error instanceof InferenceError,
    "a truncated body must surface as a typed inference error",
  );
});

void test("a non-JSON error page is rejected rather than parsed as a result", async (t) => {
  const responder = await startFaultResponder([
    { kind: "non-json", body: "<html><body>502 Bad Gateway</body></html>" },
  ]);
  t.after(() => responder.close());

  const client = createLmStudioClient({
    baseUrl: responder.baseUrl,
    allowedModels: ["*"],
  });

  await assert.rejects(
    client.listModels({ timeout_ms: 5_000 }),
    (error: unknown) =>
      error instanceof InferenceError && error.code === "malformed_response",
  );
});

void test("an empty body is rejected rather than treated as an empty catalog", async (t) => {
  const responder = await startFaultResponder([{ kind: "empty-body" }]);
  t.after(() => responder.close());

  const client = createLmStudioClient({
    baseUrl: responder.baseUrl,
    allowedModels: ["*"],
  });

  await assert.rejects(
    client.listModels({ timeout_ms: 5_000 }),
    (error: unknown) => error instanceof InferenceError,
  );
});

void test("a slow provider is cut off by the deadline, not left hanging", async (t) => {
  const responder = await startFaultResponder([
    { kind: "slow", delayMs: 10_000, body: { data: [] } },
  ]);
  t.after(() => responder.close());

  const client = createLmStudioClient({
    baseUrl: responder.baseUrl,
    allowedModels: ["*"],
  });

  const startedAt = Date.now();
  await assert.rejects(
    client.listModels({ timeout_ms: 300 }),
    (error: unknown) => error instanceof InferenceError,
  );
  // The deadline, not the server, ended the wait.
  assert.ok(
    Date.now() - startedAt < 5_000,
    "the request must abort on its own deadline",
  );
});

void test("caller cancellation aborts an in-flight slow request", async (t) => {
  const responder = await startFaultResponder([
    { kind: "slow", delayMs: 10_000, body: { data: [] } },
  ]);
  t.after(() => responder.close());

  const client = createLmStudioClient({
    baseUrl: responder.baseUrl,
    allowedModels: ["*"],
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50).unref();

  await assert.rejects(
    client.listModels({ timeout_ms: 10_000, signal: controller.signal }),
    (error: unknown) => error instanceof InferenceError,
  );
});

/* ------------------------------------------------------------------ *
 * Stream faults
 * ------------------------------------------------------------------ */

void test("a truncated SSE frame terminates cleanly and fails closed downstream", async () => {
  const chunks: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('data: {"delta":"he'), // cut mid-frame
      );
      controller.close();
    },
  });

  await parseSseStream(stream, (data) => chunks.push(data));

  // The parser flushes a trailing frame because a well-formed final frame may
  // legitimately arrive without a terminating newline; it cannot tell the two
  // apart syntactically. The guarantee that matters is that it neither hangs
  // nor throws, and that a truncated payload cannot be mistaken for valid data
  // by the layer above.
  assert.equal(chunks.length, 1);
  assert.throws(
    () => JSON.parse(chunks[0] ?? "") as unknown,
    "a truncated payload must not parse, so the caller fails closed",
  );
});

void test("SSE keep-alive comments and [DONE] are handled around real frames", async () => {
  const chunks: string[] = [];
  const payload = [
    ": keep-alive",
    "",
    'data: {"index":0}',
    "",
    ": another comment",
    "",
    'data: {"index":1}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });

  await parseSseStream(stream, (data) => chunks.push(data));
  assert.deepEqual(chunks, ['{"index":0}', '{"index":1}']);
});

void test("an SSE stream that errors mid-flight rejects instead of hanging", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
      controller.error(new Error("connection reset"));
    },
  });

  await assert.rejects(
    parseSseStream(stream, () => undefined),
    /connection reset/u,
  );
});

/* ------------------------------------------------------------------ *
 * Circuit breaker transitions
 * ------------------------------------------------------------------ */

void test("the breaker walks closed → open → half-open → closed under injected faults", () => {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 1_000,
    now: () => now,
  });

  assert.equal(breaker.getState(), "closed");
  assert.equal(breaker.allowRequest(), true);

  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), "closed", "below threshold stays closed");

  breaker.recordFailure();
  assert.equal(breaker.getState(), "open", "threshold opens the breaker");
  assert.equal(breaker.allowRequest(), false, "open sheds load");

  now += 999;
  assert.equal(breaker.getState(), "open", "cooldown has not elapsed");

  now += 1;
  assert.equal(breaker.getState(), "half-open", "cooldown allows a probe");
  assert.equal(breaker.allowRequest(), true);

  breaker.recordSuccess();
  assert.equal(breaker.getState(), "closed", "a good probe closes the breaker");
  assert.equal(breaker.allowRequest(), true);
});

void test("a failed probe re-opens the breaker immediately", () => {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 100,
    now: () => now,
  });

  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");

  now += 100;
  assert.equal(breaker.getState(), "half-open");

  // One failure in half-open is enough; it must not need the full threshold.
  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");
});

/* ------------------------------------------------------------------ *
 * Capacity state races
 * ------------------------------------------------------------------ */

void test("a task that throws still releases its capacity slot", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-fault-cap-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 5,
  });

  await assert.rejects(
    coordinator.runWithCapacity(
      { task_id: "boom", queue_timeout_ms: 1_000 },
      () => Promise.reject(new Error("injected work failure")),
    ),
    /injected work failure/u,
  );

  // The next task must still be able to acquire: no orphaned ownership.
  const result = await coordinator.runWithCapacity(
    { task_id: "next", queue_timeout_ms: 1_000 },
    () => Promise.resolve("acquired"),
  );
  assert.equal(result, "acquired");
  assert.deepEqual(
    await residualState(directory),
    { active: 0, queued: 0 },
    "a thrown task must leave no active or queued entry",
  );
});

void test("a stale owner from a dead process is reclaimed", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-fault-stale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  // A previous process held the only slot and then died without releasing it.
  await writeFile(
    path.join(directory, "capacity-state.json"),
    JSON.stringify({
      schema_version: 1,
      capacity: 1,
      next_sequence: 1,
      queue: [],
      active: [
        {
          task_id: "ghost",
          owner_id: "00000000-0000-4000-8000-000000000000",
          process_id: 999_999,
          acquired_at_ms: Date.now() - 60_000,
        },
      ],
    }),
    "utf8",
  );

  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 5,
    staleLockMs: 100,
    isProcessAlive: () => false,
  });

  const result = await coordinator.runWithCapacity(
    { task_id: "live", queue_timeout_ms: 2_000 },
    () => Promise.resolve("reclaimed"),
  );
  assert.equal(result, "reclaimed");
});

void test("malformed ownership state does not wedge the coordinator", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-fault-junk-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(path.join(directory, "corrupt.json"), "{not json", "utf8");

  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 1,
    pollIntervalMs: 5,
    staleLockMs: 50,
    isProcessAlive: () => false,
  });

  const result = await coordinator.runWithCapacity(
    { task_id: "after-corruption", queue_timeout_ms: 2_000 },
    () => Promise.resolve("ok"),
  );
  assert.equal(result, "ok");
});

void test("concurrent tasks never exceed the configured capacity", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lmw-fault-conc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const coordinator = createFileSystemCapacityCoordinator({
    stateDirectory: directory,
    capacity: 2,
    pollIntervalMs: 5,
  });

  let active = 0;
  let peak = 0;
  const work = async (): Promise<void> => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  };

  await Promise.all(
    Array.from({ length: 8 }, (_value, index) =>
      coordinator.runWithCapacity(
        { task_id: `t-${index}`, queue_timeout_ms: 5_000 },
        work,
      ),
    ),
  );

  assert.ok(peak <= 2, `capacity must never be exceeded, saw ${peak}`);
  assert.deepEqual(
    await residualState(directory),
    { active: 0, queued: 0 },
    "no ownership may be left behind",
  );
});

/**
 * Counts the entries still recorded in the shared capacity state. Both must be
 * zero once every task has settled, however it settled.
 */
async function residualState(
  directory: string,
): Promise<{ active: number; queued: number }> {
  const raw = await readFile(
    path.join(directory, "capacity-state.json"),
    "utf8",
  );
  const state = JSON.parse(raw) as {
    active?: readonly unknown[];
    queue?: readonly unknown[];
  };
  return {
    active: state.active?.length ?? 0,
    queued: state.queue?.length ?? 0,
  };
}
