import { performance } from "node:perf_hooks";

export const DEFAULT_SUPERVISION_INTERVAL_MS = 30_000;
export const DEFAULT_SUPERVISION_RSS_LIMIT_BYTES = 1_024 * 1_024 * 1_024;
export const DEFAULT_SUPERVISION_EVENT_LOOP_LAG_MS = 2_000;
export const DEFAULT_SUPERVISION_SUSTAINED_SAMPLES = 3;

export interface SupervisionMemorySample {
  readonly occurred_at_ms: number;
  readonly rss_bytes: number;
  readonly heap_used_bytes: number;
}

export interface SupervisionLagSample {
  readonly occurred_at_ms: number;
  readonly lag_ms: number;
}

export interface MemoryReader {
  read(): { readonly rss_bytes: number; readonly heap_used_bytes: number };
}

export interface SupervisionClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export type SupervisionCondition = "none" | "leak" | "wedged";

export interface ProcessSupervisorOptions {
  readonly memory?: MemoryReader;
  readonly clock?: SupervisionClock;
  readonly interval_ms?: number;
  readonly rss_limit_bytes?: number;
  readonly event_loop_lag_ms?: number;
  readonly sustained_samples?: number;
  readonly signal?: AbortSignal;
  readonly onLeak?: (sample: SupervisionMemorySample) => void;
  readonly onWedged?: (sample: SupervisionLagSample) => void;
  readonly onRecovered?: () => void;
}

export interface ProcessSupervisorStatus {
  readonly running: boolean;
  readonly condition: SupervisionCondition;
  readonly samples: number;
  readonly last_memory_sample?: SupervisionMemorySample;
  readonly last_lag_ms?: number;
}

export interface ProcessSupervisor {
  start(): void;
  stop(): void;
  status(): ProcessSupervisorStatus;
}

export const nodeMemoryReader: MemoryReader = {
  read: () => {
    const usage = process.memoryUsage();
    return {
      rss_bytes: usage.rss,
      heap_used_bytes: usage.heapUsed,
    };
  },
};

const nodeClock: SupervisionClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export function createProcessSupervisor(
  options: ProcessSupervisorOptions = {},
): ProcessSupervisor {
  const memory = options.memory ?? nodeMemoryReader;
  const clock = options.clock ?? nodeClock;
  const intervalMs = options.interval_ms ?? DEFAULT_SUPERVISION_INTERVAL_MS;
  const rssLimitBytes =
    options.rss_limit_bytes ?? DEFAULT_SUPERVISION_RSS_LIMIT_BYTES;
  const eventLoopLagMs =
    options.event_loop_lag_ms ?? DEFAULT_SUPERVISION_EVENT_LOOP_LAG_MS;
  const sustainedSamples =
    options.sustained_samples ?? DEFAULT_SUPERVISION_SUSTAINED_SAMPLES;

  let running = false;
  let timer: unknown;
  let expectedFireAtMs = 0;
  let samples = 0;
  let consecutiveOverLimit = 0;
  let consecutiveWedged = 0;
  let leakActive = false;
  let wedgedActive = false;
  let lastMemorySample: SupervisionMemorySample | undefined;
  let lastLagMs: number | undefined;

  function condition(): SupervisionCondition {
    if (wedgedActive) return "wedged";
    if (leakActive) return "leak";
    return "none";
  }

  function start(): void {
    if (running) return;
    if (options.signal?.aborted === true) return;
    running = true;
    options.signal?.addEventListener("abort", stop, { once: true });
    expectedFireAtMs = clock.now() + intervalMs;
    timer = clock.setTimeout(tick, intervalMs);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
    options.signal?.removeEventListener("abort", stop);
  }

  function tick(): void {
    const occurredAtMs = clock.now();
    const lagMs = Math.max(0, occurredAtMs - expectedFireAtMs);
    lastLagMs = lagMs;
    samples += 1;

    const sample = memory.read();
    lastMemorySample = {
      occurred_at_ms: occurredAtMs,
      rss_bytes: sample.rss_bytes,
      heap_used_bytes: sample.heap_used_bytes,
    };

    const wasActive = leakActive || wedgedActive;

    if (lagMs > eventLoopLagMs) {
      consecutiveWedged += 1;
      if (consecutiveWedged >= sustainedSamples && !wedgedActive) {
        wedgedActive = true;
        options.onWedged?.({ occurred_at_ms: occurredAtMs, lag_ms: lagMs });
      }
    } else {
      consecutiveWedged = 0;
      wedgedActive = false;
    }

    if (sample.rss_bytes > rssLimitBytes) {
      consecutiveOverLimit += 1;
      if (consecutiveOverLimit >= sustainedSamples && !leakActive) {
        leakActive = true;
        options.onLeak?.(lastMemorySample);
      }
    } else {
      consecutiveOverLimit = 0;
      leakActive = false;
    }

    const nowActive = leakActive || wedgedActive;
    if (wasActive && !nowActive) {
      options.onRecovered?.();
    }

    if (!running) return;
    expectedFireAtMs = occurredAtMs + intervalMs;
    timer = clock.setTimeout(tick, intervalMs);
  }

  return Object.freeze({
    start,
    stop,
    status: () =>
      Object.freeze({
        running,
        condition: condition(),
        samples,
        ...(lastMemorySample === undefined
          ? {}
          : { last_memory_sample: lastMemorySample }),
        ...(lastLagMs === undefined ? {} : { last_lag_ms: lastLagMs }),
      }),
  });
}
