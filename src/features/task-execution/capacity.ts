import {
  mkdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  resolveGlobalPreferencesPath,
  type ConfigurationPathInput,
} from "../configuration/index.js";
import type {
  TaskExecutionContext,
  TaskRuntime,
  TaskWorkOutcome,
} from "./runtime.js";
import type { TaskResponse } from "./contracts.js";

const STATE_SCHEMA_VERSION = 1 as const;
const STATE_FILENAME = "capacity-state.json";
const LOCK_DIRECTORY_NAME = "capacity-state.lock";
const LOCK_OWNER_FILENAME = "owner.json";
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_STALE_LOCK_MS = 10_000;
const PROCESS_OWNER_ID = randomUUID();
export const CAPACITY_COORDINATION_DIRECTORY_NAME = "coordination";

const OwnerSchema = z
  .object({
    owner_id: z.string().uuid(),
    process_id: z.number().int().positive(),
  })
  .strict();

const QueueEntrySchema = OwnerSchema.extend({
  task_id: z.string().trim().min(1).max(256),
  sequence: z.number().int().nonnegative(),
  enqueued_at_ms: z.number().int().nonnegative(),
}).strict();

const ActiveEntrySchema = OwnerSchema.extend({
  task_id: z.string().trim().min(1).max(256),
  acquired_at_ms: z.number().int().nonnegative(),
}).strict();

const CapacityStateSchema = z
  .object({
    schema_version: z.literal(STATE_SCHEMA_VERSION),
    capacity: z.number().int().positive(),
    next_sequence: z.number().int().nonnegative(),
    queue: z.array(QueueEntrySchema),
    active: z.array(ActiveEntrySchema),
  })
  .strict();

type CapacityState = z.infer<typeof CapacityStateSchema>;
type QueueEntry = z.infer<typeof QueueEntrySchema>;

export type CapacityErrorCode =
  | "queue_timeout"
  | "task_cancelled"
  | "coordination_unavailable"
  | "coordination_corrupt"
  | "configuration_mismatch";

export class CapacityError extends Error {
  public readonly code: CapacityErrorCode;

  public constructor(code: CapacityErrorCode, message: string) {
    super(message);
    this.name = "CapacityError";
    this.code = code;
  }
}

export interface CapacityRunInput {
  readonly task_id: string;
  readonly queue_timeout_ms: number;
  readonly signal?: AbortSignal;
  readonly onQueued?: () => void;
}

export interface TaskCapacityCoordinator {
  runWithCapacity<Result>(
    input: CapacityRunInput,
    work: () => Promise<Result>,
  ): Promise<Result>;
}

export interface CapacityCoordinatorClock {
  now(): number;
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
}

export interface FileSystemCapacityCoordinatorOptions {
  readonly stateDirectory: string;
  readonly capacity: number;
  readonly processId?: number;
  readonly ownerId?: string;
  readonly pollIntervalMs?: number;
  readonly staleLockMs?: number;
  readonly clock?: CapacityCoordinatorClock;
  readonly isProcessAlive?: (processId: number) => boolean;
}

export interface RunTaskWithCapacityInput {
  readonly signal?: AbortSignal;
}

interface ValidatedOptions {
  readonly stateDirectory: string;
  readonly statePath: string;
  readonly lockDirectory: string;
  readonly lockOwnerPath: string;
  readonly capacity: number;
  readonly processId: number;
  readonly ownerId: string;
  readonly pollIntervalMs: number;
  readonly staleLockMs: number;
  readonly clock: CapacityCoordinatorClock;
  readonly isProcessAlive: (processId: number) => boolean;
}

const nodeClock: CapacityCoordinatorClock = {
  now: () => Date.now(),
  sleep: (delayMs, signal) => abortableSleep(delayMs, signal),
};

export function createFileSystemCapacityCoordinator(
  options: FileSystemCapacityCoordinatorOptions,
): TaskCapacityCoordinator {
  const validated = validateOptions(options);

  return {
    runWithCapacity: <Result>(
      input: CapacityRunInput,
      work: () => Promise<Result>,
    ) => runWithCapacity(validated, input, work),
  };
}

export function resolveCapacityStateDirectory(
  input: ConfigurationPathInput,
): string {
  const preferencesPath = resolveGlobalPreferencesPath(input);
  const pathApi = input.platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(
    pathApi.dirname(preferencesPath),
    CAPACITY_COORDINATION_DIRECTORY_NAME,
  );
}

export async function runTaskWithCapacity<Output>(
  coordinator: TaskCapacityCoordinator,
  runtime: TaskRuntime<Output>,
  work: (context: TaskExecutionContext) => Promise<TaskWorkOutcome<Output>>,
  input: RunTaskWithCapacityInput = {},
): Promise<TaskResponse<Output>> {
  const onAbort = (): void => {
    runtime.cancel();
  };
  input.signal?.addEventListener("abort", onAbort);
  try {
    return await coordinator.runWithCapacity(
      {
        task_id: runtime.task_id,
        queue_timeout_ms: runtime.configuration.limits.queue_timeout_ms,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      () => runtime.run(work),
    );
  } catch (error: unknown) {
    if (error instanceof CapacityError && error.code === "queue_timeout") {
      return await runtime.finishQueued("queue_timeout");
    }
    if (error instanceof CapacityError && error.code === "task_cancelled") {
      return await runtime.finishQueued("task_cancelled");
    }
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}

async function runWithCapacity<Result>(
  options: ValidatedOptions,
  input: CapacityRunInput,
  work: () => Promise<Result>,
): Promise<Result> {
  validateRunInput(input);
  const isCancelled = (): boolean => input.signal?.aborted === true;
  if (isCancelled()) {
    throw new CapacityError("task_cancelled", "The queued task was cancelled.");
  }
  await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
  const entry = await enqueue(options, input);
  let acquired = false;
  try {
    try {
      input.onQueued?.();
    } catch {
      // A progress observer cannot change capacity coordination.
    }
    const deadline = options.clock.now() + input.queue_timeout_ms;
    while (!acquired) {
      if (isCancelled()) {
        throw new CapacityError(
          "task_cancelled",
          "The queued task was cancelled.",
        );
      }
      if (options.clock.now() >= deadline) {
        throw new CapacityError(
          "queue_timeout",
          "The task exceeded its queue deadline.",
        );
      }
      acquired = await tryAcquire(options, entry);
      if (!acquired) {
        const remaining = Math.max(1, deadline - options.clock.now());
        await options.clock.sleep(
          Math.min(options.pollIntervalMs, remaining),
          input.signal,
        );
      }
    }
    return await work();
  } catch (error: unknown) {
    if (isAbortError(error) || isCancelled()) {
      throw new CapacityError(
        "task_cancelled",
        "The queued task was cancelled.",
      );
    }
    throw error;
  } finally {
    await removeOwnership(options, entry, acquired);
  }
}

async function enqueue(
  options: ValidatedOptions,
  input: CapacityRunInput,
): Promise<QueueEntry> {
  return await withStateLock(options, async () => {
    const state = await loadAndRecoverState(options);
    enforceCapacity(state, options.capacity);
    if (
      state.queue.some((entry) => entry.task_id === input.task_id) ||
      state.active.some((entry) => entry.task_id === input.task_id)
    ) {
      throw new CapacityError(
        "coordination_unavailable",
        "The task identifier already owns or awaits capacity.",
      );
    }
    const entry: QueueEntry = {
      task_id: input.task_id,
      owner_id: options.ownerId,
      process_id: options.processId,
      sequence: state.next_sequence,
      enqueued_at_ms: options.clock.now(),
    };
    state.next_sequence += 1;
    state.queue.push(entry);
    await saveState(options, state);
    return entry;
  });
}

async function tryAcquire(
  options: ValidatedOptions,
  ownEntry: QueueEntry,
): Promise<boolean> {
  return await withStateLock(options, async () => {
    const state = await loadAndRecoverState(options);
    enforceCapacity(state, options.capacity);
    const orderedQueue = [...state.queue].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const position = orderedQueue.findIndex(
      (entry) =>
        entry.owner_id === ownEntry.owner_id &&
        entry.task_id === ownEntry.task_id,
    );
    if (position < 0) {
      throw new CapacityError(
        "coordination_unavailable",
        "The queued task ownership record is unavailable.",
      );
    }
    const available = Math.max(0, state.capacity - state.active.length);
    if (position >= available) {
      return false;
    }
    state.queue = state.queue.filter(
      (entry) =>
        entry.owner_id !== ownEntry.owner_id ||
        entry.task_id !== ownEntry.task_id,
    );
    state.active.push({
      task_id: ownEntry.task_id,
      owner_id: ownEntry.owner_id,
      process_id: ownEntry.process_id,
      acquired_at_ms: options.clock.now(),
    });
    await saveState(options, state);
    return true;
  });
}

async function removeOwnership(
  options: ValidatedOptions,
  ownEntry: QueueEntry,
  acquired: boolean,
): Promise<void> {
  try {
    await withStateLock(options, async () => {
      const state = await loadAndRecoverState(options);
      if (acquired) {
        state.active = state.active.filter(
          (entry) =>
            entry.owner_id !== ownEntry.owner_id ||
            entry.task_id !== ownEntry.task_id,
        );
      } else {
        state.queue = state.queue.filter(
          (entry) =>
            entry.owner_id !== ownEntry.owner_id ||
            entry.task_id !== ownEntry.task_id,
        );
      }
      if (state.active.length === 0 && state.queue.length === 0) {
        state.capacity = options.capacity;
      }
      await saveState(options, state);
    });
  } catch {
    if (acquired) {
      throw new CapacityError(
        "coordination_unavailable",
        "The acquired capacity slot could not be released safely.",
      );
    }
  }
}

async function loadAndRecoverState(
  options: ValidatedOptions,
): Promise<CapacityState> {
  let state: CapacityState;
  try {
    const raw = await readFile(options.statePath, "utf8");
    state = CapacityStateSchema.parse(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return emptyState(options.capacity);
    }
    throw new CapacityError(
      "coordination_corrupt",
      "The capacity coordination state is unreadable or invalid.",
    );
  }
  state.active = state.active.filter((entry) => isLiveOwner(options, entry));
  state.queue = state.queue.filter((entry) => isLiveOwner(options, entry));
  return state;
}

function enforceCapacity(state: CapacityState, capacity: number): void {
  if (
    state.capacity !== capacity &&
    (state.active.length > 0 || state.queue.length > 0)
  ) {
    throw new CapacityError(
      "configuration_mismatch",
      "Global capacity configuration differs across active processes.",
    );
  }
  state.capacity = capacity;
}

async function withStateLock<Result>(
  options: ValidatedOptions,
  operation: () => Promise<Result>,
): Promise<Result> {
  await acquireStateLock(options);
  try {
    return await operation();
  } finally {
    await releaseStateLock(options);
  }
}

async function acquireStateLock(options: ValidatedOptions): Promise<void> {
  while (true) {
    try {
      await mkdir(options.lockDirectory, { mode: 0o700 });
      try {
        await writeFile(
          options.lockOwnerPath,
          JSON.stringify({
            owner_id: options.ownerId,
            process_id: options.processId,
          }),
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      } catch {
        await unlink(options.lockOwnerPath).catch(() => undefined);
        await rmdir(options.lockDirectory).catch(() => undefined);
        throw new CapacityError(
          "coordination_unavailable",
          "The capacity coordination lock owner could not be persisted.",
        );
      }
      return;
    } catch (error: unknown) {
      if (!isFileSystemError(error, "EEXIST")) {
        await releaseStateLock(options).catch(() => undefined);
        throw new CapacityError(
          "coordination_unavailable",
          "The capacity coordination lock could not be acquired.",
        );
      }
      await recoverAbandonedLock(options);
      await options.clock.sleep(options.pollIntervalMs);
    }
  }
}

async function recoverAbandonedLock(options: ValidatedOptions): Promise<void> {
  try {
    const lockStat = await stat(options.lockDirectory);
    if (options.clock.now() - lockStat.mtimeMs < options.staleLockMs) {
      return;
    }
    let ownerAlive = false;
    try {
      const owner = OwnerSchema.parse(
        JSON.parse(await readFile(options.lockOwnerPath, "utf8")) as unknown,
      );
      ownerAlive = options.isProcessAlive(owner.process_id);
    } catch {
      ownerAlive = false;
    }
    if (ownerAlive) {
      return;
    }
    await unlink(options.lockOwnerPath).catch((error: unknown) => {
      if (!isFileSystemError(error, "ENOENT")) {
        throw error;
      }
    });
    await rmdir(options.lockDirectory);
  } catch (error: unknown) {
    if (
      !isFileSystemError(error, "ENOENT") &&
      !isFileSystemError(error, "ENOTEMPTY")
    ) {
      throw new CapacityError(
        "coordination_unavailable",
        "An abandoned coordination lock could not be recovered.",
      );
    }
  }
}

async function releaseStateLock(options: ValidatedOptions): Promise<void> {
  try {
    const owner = OwnerSchema.parse(
      JSON.parse(await readFile(options.lockOwnerPath, "utf8")) as unknown,
    );
    if (owner.owner_id !== options.ownerId) {
      return;
    }
    await unlink(options.lockOwnerPath);
    await rmdir(options.lockDirectory);
  } catch (error: unknown) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw new CapacityError(
        "coordination_unavailable",
        "The capacity coordination lock could not be released safely.",
      );
    }
  }
}

async function saveState(
  options: ValidatedOptions,
  state: CapacityState,
): Promise<void> {
  const validated = CapacityStateSchema.parse(state);
  const temporaryPath = path.join(
    options.stateDirectory,
    `.${STATE_FILENAME}.${options.processId}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, JSON.stringify(validated), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, options.statePath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new CapacityError(
      "coordination_unavailable",
      "The capacity coordination state could not be persisted.",
    );
  }
}

function emptyState(capacity: number): CapacityState {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    capacity,
    next_sequence: 0,
    queue: [],
    active: [],
  };
}

function validateOptions(
  options: FileSystemCapacityCoordinatorOptions,
): ValidatedOptions {
  if (!path.isAbsolute(options.stateDirectory)) {
    throw new CapacityError(
      "coordination_unavailable",
      "The coordination state directory must be absolute.",
    );
  }
  if (
    !Number.isInteger(options.capacity) ||
    options.capacity < 1 ||
    options.capacity > ADMINISTRATIVE_MAXIMA.max_concurrency
  ) {
    throw new CapacityError(
      "coordination_unavailable",
      "Global capacity must be a positive integer.",
    );
  }
  const processId = options.processId ?? process.pid;
  const ownerId = options.ownerId ?? PROCESS_OWNER_ID;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  if (
    !Number.isInteger(processId) ||
    processId < 1 ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    !Number.isInteger(staleLockMs) ||
    staleLockMs < 1 ||
    !z.string().uuid().safeParse(ownerId).success
  ) {
    throw new CapacityError(
      "coordination_unavailable",
      "The capacity coordinator options are invalid.",
    );
  }
  return {
    stateDirectory: options.stateDirectory,
    statePath: path.join(options.stateDirectory, STATE_FILENAME),
    lockDirectory: path.join(options.stateDirectory, LOCK_DIRECTORY_NAME),
    lockOwnerPath: path.join(
      options.stateDirectory,
      LOCK_DIRECTORY_NAME,
      LOCK_OWNER_FILENAME,
    ),
    capacity: options.capacity,
    processId,
    ownerId,
    pollIntervalMs,
    staleLockMs,
    clock: options.clock ?? nodeClock,
    isProcessAlive: options.isProcessAlive ?? isProcessAlive,
  };
}

function validateRunInput(input: CapacityRunInput): void {
  if (
    input.task_id.trim().length === 0 ||
    !Number.isInteger(input.queue_timeout_ms) ||
    input.queue_timeout_ms < 1 ||
    input.queue_timeout_ms > ADMINISTRATIVE_MAXIMA.queue_timeout_ms
  ) {
    throw new CapacityError(
      "coordination_unavailable",
      "The capacity request is invalid.",
    );
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: unknown) {
    return !isFileSystemError(error, "ESRCH");
  }
}

function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isLiveOwner(
  options: ValidatedOptions,
  entry: { readonly process_id: number; readonly owner_id: string },
): boolean {
  if (entry.process_id === options.processId) {
    return entry.owner_id === options.ownerId;
  }
  return options.isProcessAlive(entry.process_id);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
