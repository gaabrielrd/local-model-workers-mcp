import assert from "node:assert/strict";
import test from "node:test";

import {
  createResettableSignal,
  createSupervisionHandlers,
} from "../src/features/mcp-server/index.js";

void test("onLeak runs every registered evictor and writes one diagnostic", () => {
  const evicted: string[] = [];
  const diagnostics: string[] = [];
  const evictors = new Set<() => void | Promise<void>>([
    () => {
      evicted.push("code-graph");
    },
    () => {
      evicted.push("summarization");
    },
  ]);
  const handlers = createSupervisionHandlers(
    (message) => diagnostics.push(message),
    evictors,
    createResettableSignal(),
  );

  handlers.onLeak();

  assert.deepEqual(evicted, ["code-graph", "summarization"]);
  assert.deepEqual(diagnostics, [
    "[supervision] Memory leak detected; in-memory caches evicted.\n",
  ]);
});

void test("onLeak ignores evictors that throw", () => {
  const diagnostics: string[] = [];
  const evictors = new Set<() => void | Promise<void>>([
    () => {
      throw new Error("eviction failure");
    },
    () => undefined,
  ]);
  const handlers = createSupervisionHandlers(
    (message) => diagnostics.push(message),
    evictors,
    createResettableSignal(),
  );

  handlers.onLeak();

  assert.equal(diagnostics.length, 1);
});

void test("onWedged aborts in-flight tasks and resets the signal for new ones", () => {
  const diagnostics: string[] = [];
  const supervisorSignal = createResettableSignal();
  const inFlight = supervisorSignal.signal;
  const handlers = createSupervisionHandlers(
    (message) => diagnostics.push(message),
    new Set(),
    supervisorSignal,
  );

  handlers.onWedged();

  assert.equal(inFlight.aborted, true);
  assert.equal(supervisorSignal.signal.aborted, false);
  assert.deepEqual(diagnostics, [
    "[supervision] Wedged worker detected; active tasks cancelled.\n",
  ]);
});

void test("createResettableSignal resets without affecting the old signal", () => {
  const supervisorSignal = createResettableSignal();
  const first = supervisorSignal.signal;
  supervisorSignal.abort();
  assert.equal(first.aborted, true);

  supervisorSignal.reset();
  assert.equal(supervisorSignal.signal.aborted, false);
  assert.notEqual(supervisorSignal.signal, first);
});
