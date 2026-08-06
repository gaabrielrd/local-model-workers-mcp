import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  BUILT_IN_SUPERVISION,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import {
  InferenceError,
  type ModelInferencePort,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from "../src/features/model-inference/index.js";
import {
  CapacityError,
  createDiagnostic,
  createTaskRuntime,
  runTaskWithCapacity,
  type TaskCapacityCoordinator,
  type TaskClock,
  type TaskContentKind,
  type TaskExecutionContext,
  type TaskProgressEvent,
  type TaskTerminalMetadata,
} from "../src/features/task-execution/index.js";

const ResultSchema = z.object({ value: z.string() }).strict();
const CONTENT_KINDS: readonly TaskContentKind[] = [
  "goals",
  "snippets",
  "prompts",
  "responses",
  "patches",
];

void test("creates unique isolated tasks with immutable starting snapshots", async () => {
  const sourceConfiguration = configuration();
  const firstContexts: TaskExecutionContext[] = [];
  const secondContexts: TaskExecutionContext[] = [];
  let identifier = 0;
  const createTaskId = () => `task-${(identifier += 1)}`;
  const first = createTaskRuntime({
    goal: "first private goal",
    configuration: sourceConfiguration,
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    createTaskId,
  });
  const second = createTaskRuntime({
    goal: "second private goal",
    configuration: sourceConfiguration,
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    createTaskId,
  });

  sourceConfiguration.limits.processing_timeout_ms = 1;
  const [firstResult, secondResult] = await Promise.all([
    first.run((context) => {
      firstContexts.push(context);
      assert.deepEqual(context.content.read("goals"), ["first private goal"]);
      context.content.append("snippets", "first private snippet");
      assert.deepEqual(secondContexts, []);
      return Promise.resolve({ status: "completed", result: { value: "one" } });
    }),
    second.run((context) => {
      secondContexts.push(context);
      assert.deepEqual(context.content.read("goals"), ["second private goal"]);
      assert.deepEqual(context.content.read("snippets"), []);
      return Promise.resolve({ status: "completed", result: { value: "two" } });
    }),
  ]);

  assert.notEqual(first.task_id, second.task_id);
  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "completed");
  assert.equal(
    first.configuration.limits.processing_timeout_ms,
    BUILT_IN_LIMITS.processing_timeout_ms,
  );
  assert.equal(Object.isFrozen(first.configuration), true);
  assertContentCleared(firstContexts[0]);
  assertContentCleared(secondContexts[0]);
});

void test("queued duration does not consume the processing deadline", async () => {
  const clock = new FakeClock();
  const runtime = createTaskRuntime({
    goal: "wait safely",
    configuration: configuration(),
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    clock,
  });

  clock.advance(60 * 60 * 1_000);
  const result = await runtime.run((context) => {
    assert.equal(
      context.remainingProcessingTimeMs(),
      BUILT_IN_LIMITS.processing_timeout_ms,
    );
    return Promise.resolve({ status: "completed", result: { value: "ok" } });
  });

  assert.equal(result.status, "completed");
});

void test("uses the captured configured processing deadline and cleans timed-out content", async () => {
  const clock = new FakeClock();
  const configured = configuration(100);
  let captured: TaskExecutionContext | undefined;
  const runtime = createTaskRuntime({
    goal: "time out",
    configuration: configured,
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    clock,
  });

  const pending = runtime.run((context) => {
    captured = context;
    context.content.append("prompts", "private pending prompt");
    return new Promise(() => undefined);
  });
  await Promise.resolve();
  clock.advance(99);
  assert.equal(captured?.remainingProcessingTimeMs(), 1);
  clock.advance(1);
  const result = await pending;

  assert.equal(result.status, "timed_out");
  assert.equal(
    result.status === "timed_out" ? result.diagnostic.code : undefined,
    "processing_timeout",
  );
  assert.equal(runtime.state(), "timed_out");
  assertContentCleared(captured);
});

void test("propagates cancellation to inference and does not make another call", async () => {
  const caller = new AbortController();
  let calls = 0;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const inference = inferencePort(async (request) => {
    calls += 1;
    notifyStarted?.();
    return await new Promise((_, reject) => {
      request.signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted fake inference"));
        },
        { once: true },
      );
    });
  });
  const runtime = createTaskRuntime({
    goal: "cancel inference",
    configuration: configuration(),
    resultSchema: ResultSchema,
    inference,
    language: "en",
    callerSignal: caller.signal,
  });

  const pending = runtime.run(async (context) => {
    await context.inferStructured({
      messages: [{ role: "user", content: "private prompt" }],
      output_name: "task_result",
      output_schema: ResultSchema,
      max_tokens: 100,
    });
    return { status: "completed", result: { value: "unreachable" } };
  });
  await started;
  caller.abort();
  const result = await pending;

  assert.equal(result.status, "cancelled");
  assert.equal(calls, 1);
});

void test("passes inference the remaining original deadline instead of resetting it", async () => {
  const clock = new FakeClock();
  const observedTimeouts: number[] = [];
  const inference = inferencePort((request) => {
    observedTimeouts.push(request.timeout_ms);
    return Promise.resolve({
      model: request.model,
      output: request.output_schema.parse({ value: "model output" }),
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        reasoning_tokens: 0,
      },
    });
  });
  const runtime = createTaskRuntime({
    goal: "bounded inference",
    configuration: configuration(100),
    resultSchema: ResultSchema,
    inference,
    language: "en",
    clock,
  });

  const result = await runtime.run(async (context) => {
    clock.advance(30);
    const inferenceResult = await context.inferStructured({
      messages: [{ role: "user", content: "private prompt" }],
      output_name: "task_result",
      output_schema: ResultSchema,
      max_tokens: 100,
    });
    return { status: "completed", result: inferenceResult.output };
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(observedTimeouts, [70]);
});

void test("commits exactly one terminal result under cancellation and timeout races", async () => {
  const clock = new FakeClock();
  let finishWork: ((value: { value: string }) => void) | undefined;
  const runtime = createTaskRuntime({
    goal: "race safely",
    configuration: configuration(50),
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    clock,
  });
  let workCalls = 0;
  const work = () => {
    workCalls += 1;
    return new Promise<{
      status: "completed";
      result: { value: string };
    }>((resolve) => {
      finishWork = (result) => {
        resolve({ status: "completed", result });
      };
    });
  };

  const firstRun = runtime.run(work);
  const secondRun = runtime.run(work);
  assert.equal(firstRun, secondRun);
  runtime.cancel();
  clock.advance(50);
  const result = await firstRun;
  finishWork?.({ value: "late result" });
  await Promise.resolve();

  assert.equal(result.status, "cancelled");
  assert.equal(runtime.state(), "cancelled");
  assert.equal(workCalls, 1);
});

void test("keeps partial work diagnostic and cleans content for every terminal path", async (t) => {
  const cases = ["completed", "blocked", "failed"] as const;
  for (const terminal of cases) {
    await t.test(terminal, async () => {
      let captured: TaskExecutionContext | undefined;
      const runtime = createTaskRuntime({
        goal: `${terminal} goal`,
        configuration: configuration(),
        resultSchema: ResultSchema,
        inference: unusedInference(),
        language: "en",
      });

      const result = await runtime.run((context) => {
        captured = context;
        context.content.append("responses", `${terminal} private response`);
        if (terminal === "completed") {
          return Promise.resolve({
            status: "completed",
            result: { value: "done" },
          });
        }
        if (terminal === "blocked") {
          return Promise.resolve({
            status: "blocked",
            diagnostic: createDiagnostic({
              code: "context_limit_exceeded",
              message: {
                language: "en",
                text: "Partial context could not produce a complete result.",
              },
            }),
          });
        }
        return Promise.reject(new Error("private raw failure"));
      });

      assert.equal(result.status, terminal);
      assert.equal("partial_result" in result, false);
      assertContentCleared(captured);
    });
  }
});

void test("emits transport-neutral progress events with stable task identity", async () => {
  const clock = new FakeClock();
  const events: TaskProgressEvent[] = [];
  const runtime = createTaskRuntime({
    goal: "report progress",
    configuration: configuration(),
    resultSchema: ResultSchema,
    inference: unusedInference(),
    language: "en",
    clock,
    createTaskId: () => "task-progress",
    onProgress: (event) => {
      events.push(event);
    },
  });

  await runtime.run((context) => {
    context.reportProgress("exploring");
    clock.advance(1);
    context.reportProgress("consulting_model");
    context.reportProgress("preparing_result");
    return Promise.resolve({ status: "completed", result: { value: "ok" } });
  });

  assert.deepEqual(
    events.map((event) => [event.task_id, event.stage, event.sequence]),
    [
      ["task-progress", "queued", 1],
      ["task-progress", "exploring", 2],
      ["task-progress", "consulting_model", 3],
      ["task-progress", "preparing_result", 4],
    ],
  );
});

void test("maps queue timeout and queued cancellation to terminal task responses", async (t) => {
  const cases = [
    ["queue_timeout", "timed_out", "queue_timeout"],
    ["task_cancelled", "cancelled", "task_cancelled"],
  ] as const;
  for (const [capacityCode, status, diagnosticCode] of cases) {
    await t.test(capacityCode, async () => {
      const runtime = createTaskRuntime({
        goal: "remain queued",
        configuration: configuration(),
        resultSchema: ResultSchema,
        inference: unusedInference(),
        language: "en",
      });
      let workCalls = 0;
      const coordinator: TaskCapacityCoordinator = {
        runWithCapacity: () =>
          Promise.reject(
            new CapacityError(capacityCode, "safe capacity fixture"),
          ),
      };

      const result = await runTaskWithCapacity(coordinator, runtime, () => {
        workCalls += 1;
        return Promise.resolve({
          status: "completed",
          result: { value: "unreachable" },
        });
      });

      assert.equal(result.status, status);
      assert.equal(
        "diagnostic" in result ? result.diagnostic.code : undefined,
        diagnosticCode,
      );
      assert.equal(runtime.state(), status);
      assert.equal(workCalls, 0);
    });
  }
});

void test("terminal metadata attributes the serving provider and its retries", async () => {
  let terminal: TaskTerminalMetadata | undefined;
  const inference = inferencePort((request) =>
    Promise.resolve({
      model: request.model,
      output: request.output_schema.parse({ value: "attributed" }),
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        reasoning_tokens: 0,
      },
      provider: "primary",
      retries: 2,
    }),
  );
  const runtime = createTaskRuntime({
    goal: "attribute provider",
    configuration: configuration(),
    resultSchema: ResultSchema,
    inference,
    language: "en",
    onTerminal: (metadata) => {
      terminal = metadata;
    },
  });

  const result = await runtime.run(async (context) => {
    await context.inferStructured({
      messages: [{ role: "user", content: "private prompt" }],
      output_name: "task_result",
      output_schema: ResultSchema,
      max_tokens: 100,
    });
    await context.inferStructured({
      messages: [{ role: "user", content: "private prompt again" }],
      output_name: "task_result",
      output_schema: ResultSchema,
      max_tokens: 100,
    });
    return { status: "completed", result: { value: "ok" } };
  });

  assert.equal(result.status, "completed");
  assert.equal(terminal?.provider, "primary");
  assert.equal(terminal?.retry_count, 4);
});

void test("terminal metadata attributes the provider of a failed inference call", async () => {
  let terminal: TaskTerminalMetadata | undefined;
  const inference = inferencePort(() =>
    Promise.reject(
      new InferenceError(
        "inference_failed",
        "the serving provider went away",
        false,
        "failing-provider",
      ),
    ),
  );
  const runtime = createTaskRuntime({
    goal: "attribute failure",
    configuration: configuration(),
    resultSchema: ResultSchema,
    inference,
    language: "en",
    onTerminal: (metadata) => {
      terminal = metadata;
    },
  });

  const result = await runtime.run(async (context) => {
    await context.inferStructured({
      messages: [{ role: "user", content: "private prompt" }],
      output_name: "task_result",
      output_schema: ResultSchema,
      max_tokens: 100,
    });
    return { status: "completed", result: { value: "unreachable" } };
  });

  assert.equal(result.status, "failed");
  assert.equal(terminal?.provider, "failing-provider");
});

function configuration(
  processingTimeoutMs = BUILT_IN_LIMITS.processing_timeout_ms,
) {
  return {
    schema_version: 1,
    revision: `sha256:${"b".repeat(64)}`,
    lm_studio: {
      base_url: "http://127.0.0.1:1234/v1",
      authentication: "bearer",
      token_configured: true,
      allowed_models: ["qwen/default", "gemma/allowed"],
      default_model: "qwen/default",
    },
    limits: {
      ...BUILT_IN_LIMITS,
      processing_timeout_ms: processingTimeoutMs,
    },
    supervision: {
      enabled: BUILT_IN_SUPERVISION.enabled,
      interval_ms: BUILT_IN_SUPERVISION.interval_ms,
      rss_limit_bytes: BUILT_IN_SUPERVISION.rss_limit_mb * 1_024 * 1_024,
      event_loop_lag_ms: BUILT_IN_SUPERVISION.event_loop_lag_ms,
    },
    administrative_maxima: ADMINISTRATIVE_MAXIMA,
    fixed_limits: FIXED_LIMITS,
    profile: "balanced",
    post_processing_hooks: [],
    result_verbosity: "standard",
    routing_strategy: "static",
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
      "supervision.enabled": "built_in",
      "supervision.interval_ms": "built_in",
      "supervision.rss_limit_bytes": "built_in",
      "supervision.event_loop_lag_ms": "built_in",
      "administrative_maxima.max_concurrency": "protected",
      "administrative_maxima.queue_timeout_ms": "protected",
      "administrative_maxima.processing_timeout_ms": "protected",
      "administrative_maxima.max_exploration_interactions": "protected",
      "administrative_maxima.context_budget_bytes": "protected",
      "fixed_limits.patch_max_files": "protected",
      "fixed_limits.patch_max_changed_lines": "protected",
      "fixed_limits.inference_retry_count": "protected",
      profile: "built_in",
      post_processing_hooks: "built_in",
      result_verbosity: "built_in",
      routing_strategy: "built_in",
      workspace_label: "built_in",
    },
  } satisfies EffectiveConfiguration;
}

function unusedInference(): ModelInferencePort {
  return inferencePort(() => {
    throw new Error("Inference was not expected.");
  });
}

function inferencePort(
  infer: <Output>(
    request: StructuredInferenceRequest<Output>,
  ) => Promise<StructuredInferenceResult<Output>>,
): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding was not expected.")),
    inferStructured: infer,
  };
}

function assertContentCleared(context: TaskExecutionContext | undefined): void {
  assert.ok(context !== undefined);
  for (const kind of CONTENT_KINDS) {
    assert.deepEqual(context.content.read(kind), []);
  }
  assert.throws(() => {
    context.content.append("prompts", "must not survive");
  }, /no longer available/u);
}

class FakeClock implements TaskClock {
  private current = 0;
  private identifier = 0;
  private readonly timers = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();

  public now(): number {
    return this.current;
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const identifier = (this.identifier += 1);
    this.timers.set(identifier, {
      at: this.current + delayMs,
      callback,
    });
    return identifier;
  }

  public clearTimeout(timer: unknown): void {
    if (typeof timer === "number") {
      this.timers.delete(timer);
    }
  }

  public advance(milliseconds: number): void {
    this.current += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.current)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [identifier, timer] of due) {
      this.timers.delete(identifier);
      timer.callback();
    }
  }
}
