import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { EffectiveConfiguration } from "../configuration/index.js";
import {
  InferenceError,
  type InferenceMessage,
  type ModelInferencePort,
  type StructuredInferenceResult,
} from "../model-inference/index.js";
import {
  createCompletedTaskResponse,
  createDiagnosticTaskResponse,
  type Diagnostic,
  type Evidence,
  type Limitation,
  type NonCompletedStatus,
  type ProgressStage,
  type RequestLanguage,
  type TaskResponse,
  type TerminalStatus,
} from "./contracts.js";
import { createDiagnostic } from "./diagnostics.js";

export type TaskContentKind =
  "goals" | "snippets" | "prompts" | "responses" | "patches";

export interface TaskContentScope {
  append(kind: TaskContentKind, value: string): void;
  read(kind: TaskContentKind): readonly string[];
}

export interface TaskProgressEvent {
  readonly task_id: string;
  readonly stage: ProgressStage;
  readonly sequence: number;
  readonly occurred_at_ms: number;
}

export interface TaskClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface TaskInferenceRequest<Output> {
  readonly messages: readonly InferenceMessage[];
  readonly output_name: string;
  readonly output_schema: z.ZodType<Output>;
  readonly max_tokens: number;
}

export interface TaskExecutionContext {
  readonly task_id: string;
  readonly model: string;
  readonly config_revision: string;
  readonly configuration: EffectiveConfiguration;
  readonly signal: AbortSignal;
  readonly content: TaskContentScope;
  remainingProcessingTimeMs(): number;
  reportProgress(stage: Exclude<ProgressStage, "queued">): void;
  inferStructured<Output>(
    request: TaskInferenceRequest<Output>,
  ): Promise<StructuredInferenceResult<Output>>;
}

export interface CompletedWork<Output> {
  readonly status: "completed";
  readonly result: Output;
  readonly evidence?: readonly Evidence[];
  readonly limitations?: readonly Limitation[];
}

export interface DiagnosticWork {
  readonly status: Extract<NonCompletedStatus, "blocked" | "failed">;
  readonly diagnostic: Diagnostic;
  readonly evidence?: readonly Evidence[];
  readonly limitations?: readonly Limitation[];
}

export type TaskWorkOutcome<Output> = CompletedWork<Output> | DiagnosticWork;

export interface CreateTaskRuntimeOptions<Output> {
  readonly goal: string;
  readonly configuration: EffectiveConfiguration;
  readonly resultSchema: z.ZodType<Output>;
  readonly inference: ModelInferencePort;
  readonly language: RequestLanguage;
  readonly model?: string;
  readonly callerSignal?: AbortSignal;
  readonly clock?: TaskClock;
  readonly createTaskId?: () => string;
  readonly onProgress?: (event: TaskProgressEvent) => void;
}

export interface TaskRuntime<Output> {
  readonly task_id: string;
  readonly model: string;
  readonly config_revision: string;
  readonly configuration: EffectiveConfiguration;
  state(): "queued" | "processing" | TerminalStatus;
  cancel(): void;
  finishQueued(
    reason: "queue_timeout" | "task_cancelled",
  ): Promise<TaskResponse<Output>>;
  run(
    work: (context: TaskExecutionContext) => Promise<TaskWorkOutcome<Output>>,
  ): Promise<TaskResponse<Output>>;
}

export class TaskLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TaskLifecycleError";
  }
}

const nodeClock: TaskClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export function createTaskRuntime<Output>(
  options: CreateTaskRuntimeOptions<Output>,
): TaskRuntime<Output> {
  if (options.goal.trim().length === 0) {
    throw new TaskLifecycleError("A non-empty task goal is required.");
  }
  const configuration = deepFreeze(structuredClone(options.configuration));
  const model = options.model ?? configuration.lm_studio.default_model;
  if (!configuration.lm_studio.allowed_models.includes(model)) {
    throw new TaskLifecycleError(
      "The selected task model is not allowed by protected policy.",
    );
  }
  const taskId = options.createTaskId?.() ?? randomUUID();
  if (taskId.trim().length === 0) {
    throw new TaskLifecycleError("The task identifier must be non-empty.");
  }
  const clock = options.clock ?? nodeClock;
  const content = createContentScope(options.goal);
  const cancellation = new AbortController();
  let currentState: "queued" | "processing" | TerminalStatus = "queued";
  let runPromise: Promise<TaskResponse<Output>> | undefined;
  let sequence = 0;

  emit("queued");

  function emit(stage: ProgressStage): void {
    sequence += 1;
    try {
      options.onProgress?.({
        task_id: taskId,
        stage,
        sequence,
        occurred_at_ms: clock.now(),
      });
    } catch {
      // A transport observer cannot change task execution.
    }
  }

  function cancel(): void {
    cancellation.abort();
  }

  function run(
    work: (context: TaskExecutionContext) => Promise<TaskWorkOutcome<Output>>,
  ): Promise<TaskResponse<Output>> {
    runPromise ??= execute(work);
    return runPromise;
  }

  function finishQueued(
    reason: "queue_timeout" | "task_cancelled",
  ): Promise<TaskResponse<Output>> {
    if (runPromise !== undefined) {
      return runPromise;
    }
    const outcome: InterruptOutcome =
      reason === "queue_timeout"
        ? { status: "timed_out", code: "queue_timeout" }
        : { status: "cancelled", code: "task_cancelled" };
    const response = responseForOutcome(
      outcome,
      options.resultSchema,
      taskId,
      model,
      configuration.revision,
      options.language,
    );
    currentState = response.status;
    cancellation.abort();
    content.close();
    runPromise = Promise.resolve(response);
    return runPromise;
  }

  async function execute(
    work: (context: TaskExecutionContext) => Promise<TaskWorkOutcome<Output>>,
  ): Promise<TaskResponse<Output>> {
    currentState = "processing";
    const processingStartedAt = clock.now();
    const processingDeadline =
      processingStartedAt + configuration.limits.processing_timeout_ms;
    const processingTimeout = new AbortController();
    const signals = [cancellation.signal, processingTimeout.signal];
    if (options.callerSignal !== undefined) {
      signals.push(options.callerSignal);
    }
    const signal = AbortSignal.any(signals);
    let settleInterruption: ((outcome: InterruptOutcome) => void) | undefined;
    const interruption = new Promise<InterruptOutcome>((resolve) => {
      settleInterruption = resolve;
    });
    let interrupted = false;
    const interrupt = (outcome: InterruptOutcome): void => {
      if (interrupted) {
        return;
      }
      interrupted = true;
      settleInterruption?.(outcome);
    };
    const onCancellation = (): void => {
      interrupt({ status: "cancelled", code: "task_cancelled" });
      cancellation.abort();
    };
    cancellation.signal.addEventListener("abort", onCancellation, {
      once: true,
    });
    options.callerSignal?.addEventListener("abort", onCancellation, {
      once: true,
    });
    if (cancellation.signal.aborted || options.callerSignal?.aborted === true) {
      onCancellation();
    }
    const timer = clock.setTimeout(() => {
      interrupt({ status: "timed_out", code: "processing_timeout" });
      processingTimeout.abort();
    }, configuration.limits.processing_timeout_ms);

    const context: TaskExecutionContext = {
      task_id: taskId,
      model,
      config_revision: configuration.revision,
      configuration,
      signal,
      content,
      remainingProcessingTimeMs: () =>
        Math.max(0, processingDeadline - clock.now()),
      reportProgress: (stage) => {
        if (currentState !== "processing") {
          throw new TaskLifecycleError(
            "Progress cannot be emitted after task termination.",
          );
        }
        emit(stage);
      },
      inferStructured: <InferenceOutput>(
        request: TaskInferenceRequest<InferenceOutput>,
      ) => {
        const remaining = Math.max(0, processingDeadline - clock.now());
        if (remaining < 1) {
          return Promise.reject(
            new InferenceError(
              "inference_timeout",
              "The task processing deadline has elapsed.",
            ),
          );
        }
        return options.inference.inferStructured({
          ...request,
          model,
          timeout_ms: remaining,
          signal,
        });
      },
    };

    const workOutcome = Promise.resolve()
      .then(() => work(context))
      .catch((error: unknown): TaskWorkOutcome<Output> =>
        failedWork(error, options.language),
      );

    let outcome: TaskWorkOutcome<Output> | InterruptOutcome;
    try {
      outcome = await Promise.race([workOutcome, interruption]);
      let response: TaskResponse<Output>;
      try {
        response = responseForOutcome(
          outcome,
          options.resultSchema,
          taskId,
          model,
          configuration.revision,
          options.language,
        );
      } catch (error: unknown) {
        response = responseForOutcome(
          failedWork(error, options.language),
          options.resultSchema,
          taskId,
          model,
          configuration.revision,
          options.language,
        );
      }
      currentState = response.status;
      return response;
    } finally {
      clock.clearTimeout(timer);
      cancellation.signal.removeEventListener("abort", onCancellation);
      options.callerSignal?.removeEventListener("abort", onCancellation);
      processingTimeout.abort();
      cancellation.abort();
      content.close();
    }
  }

  return Object.freeze({
    task_id: taskId,
    model,
    config_revision: configuration.revision,
    configuration,
    state: () => currentState,
    cancel,
    finishQueued,
    run,
  });
}

interface InterruptOutcome {
  readonly status: "cancelled" | "timed_out";
  readonly code: "task_cancelled" | "queue_timeout" | "processing_timeout";
}

function responseForOutcome<Output>(
  outcome: TaskWorkOutcome<Output> | InterruptOutcome,
  resultSchema: z.ZodType<Output>,
  taskId: string,
  model: string,
  configRevision: string,
  language: RequestLanguage,
): TaskResponse<Output> {
  if (outcome.status === "completed") {
    return createCompletedTaskResponse(resultSchema, {
      task_id: taskId,
      status: "completed",
      model,
      config_revision: configRevision,
      result: outcome.result,
      evidence: [...(outcome.evidence ?? [])],
      limitations: [...(outcome.limitations ?? [])],
    });
  }
  if ("diagnostic" in outcome) {
    return createDiagnosticTaskResponse({
      task_id: taskId,
      status: outcome.status,
      model,
      config_revision: configRevision,
      diagnostic: outcome.diagnostic,
      evidence: [...(outcome.evidence ?? [])],
      limitations: [...(outcome.limitations ?? [])],
    });
  }

  const timedOut = outcome.status === "timed_out";
  return createDiagnosticTaskResponse({
    task_id: taskId,
    status: outcome.status,
    model,
    config_revision: configRevision,
    diagnostic: createDiagnostic({
      code: outcome.code,
      message: {
        language,
        text:
          outcome.code === "queue_timeout"
            ? "The task exceeded its queue deadline."
            : timedOut
              ? "The task exceeded its processing deadline."
              : "The task was cancelled.",
      },
    }),
    evidence: [],
    limitations: [],
  });
}

function failedWork<Output>(
  error: unknown,
  language: RequestLanguage,
): TaskWorkOutcome<Output> {
  const inferenceCode =
    error instanceof InferenceError ? error.code : undefined;
  const code =
    inferenceCode === "model_unauthorized"
      ? "model_unauthorized"
      : inferenceCode === "model_unavailable"
        ? "model_unavailable"
        : inferenceCode === undefined
          ? "internal_error"
          : "inference_failed";

  return {
    status: "failed",
    diagnostic: createDiagnostic({
      code,
      message: {
        language,
        text:
          inferenceCode === undefined
            ? "The task failed because of an unexpected local error."
            : "The model did not return a usable completed result.",
      },
    }),
  };
}

function createContentScope(initialGoal: string): TaskContentScope & {
  close(): void;
} {
  const values: Record<TaskContentKind, string[]> = {
    goals: [initialGoal],
    snippets: [],
    prompts: [],
    responses: [],
    patches: [],
  };
  let closed = false;

  return {
    append: (kind, value) => {
      if (closed) {
        throw new TaskLifecycleError("Task content is no longer available.");
      }
      values[kind].push(value);
    },
    read: (kind) => (closed ? [] : [...values[kind]]),
    close: () => {
      for (const content of Object.values(values)) {
        content.fill("");
        content.length = 0;
      }
      closed = true;
    },
  };
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
