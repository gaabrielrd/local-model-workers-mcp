import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcessSupervisor,
  nodeMemoryReader,
  type MemoryReader,
  type SupervisionClock,
} from "../src/features/process-supervision/index.js";

interface ManualClock extends SupervisionClock {
  advance(ms: number): void;
}

function manualClock(): ManualClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; due: number }>();
  return {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { callback, due: now + delayMs });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    advance: (ms) => {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= now)
        .sort((a, b) => a[1].due - b[1].due);
      timers.clear();
      for (const [, timer] of due) timer.callback();
    },
  };
}

function constantMemory(
  rssBytes: number,
  heapUsedBytes = 512 * 1_024 * 1_024,
): { reader: MemoryReader; setRss: (rssBytes: number) => void } {
  let rss = rssBytes;
  return {
    reader: {
      read: () => ({ rss_bytes: rss, heap_used_bytes: heapUsedBytes }),
    },
    setRss: (next) => {
      rss = next;
    },
  };
}

const RSS_LIMIT = 1_024 * 1_024 * 1_024;

void test("reports initial idle status before the first sample", () => {
  const supervisor = createProcessSupervisor({ clock: manualClock() });

  const status = supervisor.status();

  assert.equal(status.running, false);
  assert.equal(status.condition, "none");
  assert.equal(status.samples, 0);
  assert.equal("last_memory_sample" in status, false);
  assert.equal("last_lag_ms" in status, false);
});

void test("samples on a fixed interval while running", () => {
  const clock = manualClock();
  const { reader } = constantMemory(RSS_LIMIT / 2);
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
    rss_limit_bytes: RSS_LIMIT,
  });

  supervisor.start();
  clock.advance(100);
  clock.advance(100);
  clock.advance(100);

  const status = supervisor.status();
  assert.equal(status.running, true);
  assert.equal(status.samples, 3);
  assert.equal(status.condition, "none");
  assert.equal(status.last_memory_sample?.rss_bytes, RSS_LIMIT / 2);
});

void test("fires onLeak after sustained memory samples over the limit", () => {
  const clock = manualClock();
  const { reader } = constantMemory(RSS_LIMIT + 1);
  const leaks: unknown[] = [];
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
    rss_limit_bytes: RSS_LIMIT,
    sustained_samples: 3,
    onLeak: (sample) => leaks.push(sample),
  });

  supervisor.start();
  clock.advance(100);
  clock.advance(100);
  assert.equal(leaks.length, 0);
  assert.equal(supervisor.status().condition, "none");

  clock.advance(100);
  assert.equal(leaks.length, 1);
  assert.equal(supervisor.status().condition, "leak");
  assert.equal((leaks[0] as { rss_bytes: number }).rss_bytes, RSS_LIMIT + 1);

  clock.advance(100);
  assert.equal(leaks.length, 1);
});

void test("fires onRecovered once memory returns below the limit", () => {
  const clock = manualClock();
  const { reader, setRss } = constantMemory(RSS_LIMIT + 1);
  let recoveries = 0;
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
    rss_limit_bytes: RSS_LIMIT,
    sustained_samples: 2,
    onLeak: () => {},
    onRecovered: () => {
      recoveries += 1;
    },
  });

  supervisor.start();
  clock.advance(100);
  clock.advance(100);
  assert.equal(supervisor.status().condition, "leak");

  setRss(RSS_LIMIT - 1);
  clock.advance(100);

  assert.equal(recoveries, 1);
  assert.equal(supervisor.status().condition, "none");
  assert.equal(supervisor.status().last_lag_ms, 0);
});

void test("fires onWedged after sustained event loop lag", () => {
  const clock = manualClock();
  const { reader } = constantMemory(RSS_LIMIT / 2);
  const wedged: unknown[] = [];
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
    rss_limit_bytes: RSS_LIMIT,
    event_loop_lag_ms: 10,
    sustained_samples: 2,
    onWedged: (sample) => wedged.push(sample),
  });

  supervisor.start();
  clock.advance(200);
  assert.equal(wedged.length, 0);

  clock.advance(200);
  assert.equal(wedged.length, 1);
  assert.equal(supervisor.status().condition, "wedged");
  assert.equal((wedged[0] as { lag_ms: number }).lag_ms, 100);

  clock.advance(200);
  assert.equal(wedged.length, 1);
});

void test("fires onRecovered once the event loop catches up", () => {
  const clock = manualClock();
  const { reader } = constantMemory(RSS_LIMIT / 2);
  let recoveries = 0;
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
    rss_limit_bytes: RSS_LIMIT,
    event_loop_lag_ms: 10,
    sustained_samples: 2,
    onWedged: () => {},
    onRecovered: () => {
      recoveries += 1;
    },
  });

  supervisor.start();
  clock.advance(200);
  clock.advance(200);
  assert.equal(supervisor.status().condition, "wedged");

  clock.advance(100);
  assert.equal(recoveries, 1);
  assert.equal(supervisor.status().condition, "none");
});

void test("stop clears the timer and halts sampling", () => {
  const clock = manualClock();
  const { reader } = constantMemory(RSS_LIMIT / 2);
  const supervisor = createProcessSupervisor({
    clock,
    memory: reader,
    interval_ms: 100,
  });

  supervisor.start();
  clock.advance(100);
  supervisor.stop();
  const samplesAtStop = supervisor.status().samples;

  clock.advance(1_000);
  assert.equal(supervisor.status().running, false);
  assert.equal(supervisor.status().samples, samplesAtStop);
});

void test("stop is idempotent", () => {
  const clock = manualClock();
  const supervisor = createProcessSupervisor({ clock });
  supervisor.start();
  supervisor.stop();
  supervisor.stop();
  assert.equal(supervisor.status().running, false);
});

void test("start is idempotent and honors an aborted signal", () => {
  const clock = manualClock();
  const controller = new AbortController();
  const supervisor = createProcessSupervisor({
    clock,
    signal: controller.signal,
  });
  supervisor.start();
  supervisor.start();
  controller.abort();
  clock.advance(1_000);
  assert.equal(supervisor.status().running, false);
  assert.equal(supervisor.status().samples, 0);
});

void test("does not start when the signal is already aborted", () => {
  const clock = manualClock();
  const controller = new AbortController();
  controller.abort();
  const supervisor = createProcessSupervisor({
    clock,
    signal: controller.signal,
  });
  supervisor.start();
  clock.advance(1_000);
  assert.equal(supervisor.status().running, false);
  assert.equal(supervisor.status().samples, 0);
});

void test("nodeMemoryReader reads the current process usage", () => {
  const sample = nodeMemoryReader.read();
  assert.ok(sample.rss_bytes > 0);
  assert.ok(sample.heap_used_bytes >= 0);
});
