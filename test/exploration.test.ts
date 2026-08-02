import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import {
  InferenceError,
  type ModelInferencePort,
} from "../src/features/model-inference/index.js";
import {
  createOutboundContextCollector,
  exploreRepository,
  type CreateOutboundContextCollectorInput,
  type RepositoryReadCapability,
} from "../src/features/repository-exploration/index.js";
import type {
  TaskCapacityCoordinator,
  TaskProgressEvent,
} from "../src/features/task-execution/index.js";

const ROOT = "/fixture/repository";
const MODEL = "qwen/default";
const ROUTED_MODEL = "gemma/routed";

void test("rejects invalid requests and roots before model inference", async () => {
  let inferenceCalls = 0;
  let capabilityCalls = 0;
  const inference = inferenceFrom([], () => {
    inferenceCalls += 1;
  });

  await assert.rejects(
    exploreRepository({
      request: { goal: "", repository_root: ROOT },
      configuration: configuration(),
      inference,
      coordinator: immediateCoordinator,
      language: "en",
      capabilityFactory: () => {
        capabilityCalls += 1;
        return Promise.reject(new Error("must not open"));
      },
    }),
  );
  assert.equal(capabilityCalls, 0);
  assert.equal(inferenceCalls, 0);

  await assert.rejects(
    exploreRepository({
      request: {
        goal: "inspect",
        repository_root: ROOT,
        priority_paths: ["../escape"],
      },
      configuration: configuration(),
      inference,
      coordinator: immediateCoordinator,
      language: "en",
      capabilityFactory: () => {
        capabilityCalls += 1;
        return Promise.reject(new Error("invalid root or scope"));
      },
    }),
  );
  assert.equal(capabilityCalls, 1);
  assert.equal(inferenceCalls, 0);
});

void test("routes exploration to a task-specific configured model", async () => {
  const result = await run(
    [
      {
        action: "finalize",
        summary: "The module exports one constant.",
        relevant_files: ["src/app.ts"],
        evidence: [
          {
            path: "src/app.ts",
            start_line: 1,
            end_line: 1,
            explanation: "This line defines the export.",
          },
        ],
        risks: ["The value is hard-coded."],
        next_steps: ["Add behavior around the exported value."],
      },
    ],
    {
      configuration: routedConfiguration(),
      capability: capabilityWithContent(
        "src/app.ts",
        "export const value = 1;",
      ),
    },
  );

  assert.equal(result.model, ROUTED_MODEL);
});

void test("performs a bounded read and returns locally verified evidence", async () => {
  const prompts: string[] = [];
  const capability = capabilityWithContent(
    "src/app.ts",
    "export const value = 1;",
  );
  const result = await run(
    [
      {
        action: "read_snippet",
        input: { path: "src/app.ts", start_line: 1, line_count: 1 },
        relevance: "Defines the exported value.",
      },
      {
        action: "finalize",
        summary: "The module exports one constant.",
        relevant_files: ["src/app.ts"],
        evidence: [
          {
            path: "src/app.ts",
            start_line: 1,
            end_line: 1,
            explanation: "This line defines the export.",
          },
        ],
        risks: ["The value is hard-coded."],
        next_steps: ["Add behavior around the exported value."],
      },
    ],
    { capability, prompts },
  );

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.result.relevant_files, ["src/app.ts"]);
  assert.deepEqual(result.result.analyzed_files, ["src/app.ts"]);
  assert.equal(result.evidence[0]?.path, "src/app.ts");
  assert.equal(result.evidence[0]?.start_line, 1);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /untrusted quoted data/u);
  assert.match(prompts[1] ?? "", /export const value = 1/u);
});

void test("supports filtered listing and search without exposing rejected paths", async () => {
  const prompts: string[] = [];
  const capability: RepositoryReadCapability = {
    listDirectory: () =>
      Promise.resolve({
        entries: [
          { path: "src/app.ts", name: "app.ts", kind: "file" },
          { path: ".env", name: ".env", kind: "file" },
        ],
        truncated: false,
      }),
    searchText: () =>
      Promise.resolve({
        matches: [
          { path: "src/app.ts", line: 1, preview: "export const value = 1;" },
        ],
        visited_files: 1,
        scanned_bytes: 23,
        truncated: false,
      }),
    readSnippet: () =>
      Promise.resolve({
        path: "src/app.ts",
        start_line: 1,
        end_line: 1,
        content: "export const value = 1;",
        truncated: false,
      }),
  };
  const result = await run(
    [
      {
        action: "list_directory",
        input: {},
        relevance: "Discover source files.",
      },
      {
        action: "search_text",
        input: { query: "export", mode: "literal" },
        relevance: "Find exports.",
      },
      {
        action: "finalize",
        summary: "One source export was found.",
        relevant_files: ["src/app.ts"],
        evidence: [
          {
            path: "src/app.ts",
            start_line: 1,
            end_line: 1,
            explanation: "The search result identifies the export.",
          },
        ],
        risks: [],
        next_steps: [],
      },
    ],
    { capability, prompts },
  );

  assert.equal(result.status, "completed");
  assert.equal(
    prompts.some((prompt) => prompt.includes('{"path":".env","kind":"file"}')),
    false,
  );
  assert.equal(
    prompts.some((prompt) => prompt.includes("src/app.ts")),
    true,
  );
});

void test("blocks invented ranges and content changed before delivery", async (t) => {
  const cases = [
    {
      name: "invented range",
      evidence: { path: "src/app.ts", start_line: 2, end_line: 2 },
      stale: false,
    },
    {
      name: "stale content",
      evidence: { path: "src/app.ts", start_line: 1, end_line: 1 },
      stale: true,
    },
  ] as const;
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      let reads = 0;
      const capability = capabilityWithContent("src/app.ts", () => {
        reads += 1;
        return fixture.stale && reads > 1
          ? "export const value = 2;"
          : "export const value = 1;";
      });
      const result = await run(
        [
          {
            action: "read_snippet",
            input: { path: "src/app.ts", start_line: 1, line_count: 1 },
            relevance: "Read the export.",
          },
          {
            action: "finalize",
            summary: "Summary",
            relevant_files: ["src/app.ts"],
            evidence: [
              {
                ...fixture.evidence,
                explanation: "Proposed evidence.",
              },
            ],
            risks: [],
            next_steps: [],
          },
        ],
        { capability },
      );

      assert.equal(result.status, "blocked");
      if (result.status === "blocked") {
        assert.equal(result.diagnostic.code, "invalid_evidence");
      }
      assert.deepEqual(result.evidence, []);
    });
  }
});

void test("reports interaction and context exhaustion explicitly", async (t) => {
  await t.test("interaction limit", async () => {
    const result = await run(
      [
        {
          action: "list_directory",
          input: {},
          relevance: "Keep exploring.",
        },
      ],
      {
        configuration: configuration({ maxInteractions: 1 }),
        capability: capabilityWithContent("src/app.ts", "line"),
      },
    );
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.equal(result.diagnostic.code, "interaction_limit_exceeded");
    }
  });

  await t.test("context budget", async () => {
    const result = await run(
      [
        {
          action: "read_snippet",
          input: { path: "src/large.ts", start_line: 1, line_count: 1 },
          relevance: "Read a large line.",
        },
        {
          action: "finalize",
          summary: "The file could not fit in context.",
          relevant_files: [],
          evidence: [],
          risks: ["The analysis is incomplete."],
          next_steps: ["Increase the context budget."],
        },
      ],
      {
        configuration: configuration({ contextBytes: 10 }),
        capability: capabilityWithContent("src/large.ts", "x".repeat(100)),
      },
    );
    assert.equal(result.status, "completed");
    if (result.status !== "completed") return;
    assert.ok(
      result.limitations.some(
        (limitation) => limitation.code === "context_budget_exceeded",
      ),
    );
    assert.ok(result.result.limitation_impact !== null);
  });
});

void test("preserves Portuguese human text and English technical fields", async () => {
  const result = await run(
    [
      {
        action: "finalize",
        summary: "O repositório está vazio para este objetivo.",
        relevant_files: [],
        evidence: [],
        risks: ["A análise tem pouco contexto."],
        next_steps: ["Adicione arquivos relevantes."],
      },
    ],
    { language: "pt-BR" },
  );

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.result.summary.language, "pt-BR");
  assert.match(result.result.summary.text, /repositório/u);
  assert.deepEqual(Object.keys(result.result), [
    "summary",
    "relevant_files",
    "risks",
    "next_steps",
    "analyzed_files",
    "relevant_unread_files",
    "limitation_impact",
  ]);
});

void test("emits progress in order and treats malformed model actions as failure", async () => {
  const events: TaskProgressEvent[] = [];
  const result = await run([{ action: "run_shell", command: "cat .env" }], {
    onProgress: (event) => events.push(event),
    malformedAsInferenceError: true,
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.diagnostic.code, "inference_failed");
  }
  assert.deepEqual(
    events.map((event) => event.stage),
    ["queued", "exploring", "consulting_model"],
  );
});

interface RunOptions {
  readonly configuration?: EffectiveConfiguration;
  readonly capability?: RepositoryReadCapability;
  readonly prompts?: string[];
  readonly language?: "en" | "pt-BR";
  readonly onProgress?: (event: TaskProgressEvent) => void;
  readonly malformedAsInferenceError?: boolean;
}

async function run(decisions: readonly unknown[], options: RunOptions = {}) {
  const prompts = options.prompts ?? [];
  return await exploreRepository({
    request: { goal: "Inspect the repository", repository_root: ROOT },
    configuration: options.configuration ?? configuration(),
    inference: inferenceFrom(
      decisions,
      undefined,
      prompts,
      options.malformedAsInferenceError,
    ),
    coordinator: immediateCoordinator,
    language: options.language ?? "en",
    capabilityFactory: () =>
      Promise.resolve(
        options.capability ?? capabilityWithContent("src/app.ts", "line"),
      ),
    collectorFactory: safeCollector,
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });
}

function inferenceFrom(
  decisions: readonly unknown[],
  onCall?: () => void,
  prompts: string[] = [],
  malformedAsInferenceError = false,
): ModelInferencePort {
  const remaining = [...decisions];
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: (request) => {
      onCall?.();
      prompts.push(
        request.messages.map((message) => message.content).join("\n"),
      );
      const next = remaining.shift();
      const parsed = request.output_schema.safeParse(next);
      if (!parsed.success) {
        return Promise.reject(
          malformedAsInferenceError
            ? new InferenceError(
                "malformed_response",
                "Malformed fixture decision.",
              )
            : parsed.error,
        );
      }
      return Promise.resolve({
        model: request.model,
        output: parsed.data,
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          reasoning_tokens: 0,
        },
      });
    },
  };
}

const immediateCoordinator: TaskCapacityCoordinator = {
  runWithCapacity: (_input, work) => work(),
};

function capabilityWithContent(
  path: string,
  content: string | (() => string),
): RepositoryReadCapability {
  const read = () => (typeof content === "function" ? content() : content);
  return {
    listDirectory: () => Promise.resolve({ entries: [], truncated: false }),
    searchText: () =>
      Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      }),
    readSnippet: (input) => {
      const value = read();
      const lines = value.split(/\r?\n/u);
      const start = input.start_line ?? 1;
      const selected = lines.slice(
        start - 1,
        start - 1 + (input.line_count ?? 80),
      );
      return Promise.resolve({
        path,
        start_line: start,
        end_line: start + selected.length - 1,
        content: selected.join("\n"),
        truncated: false,
      });
    },
  };
}

function safeCollector(input: CreateOutboundContextCollectorInput) {
  return createOutboundContextCollector({
    ...input,
    gitIgnorePolicy: { isIgnored: () => Promise.resolve(false) },
    projectIgnorePolicy: {
      excludes: () => false,
      ignored_negation_rules: 0,
    },
  });
}

function routedConfiguration(): EffectiveConfiguration {
  const base = configuration();
  return {
    ...base,
    lm_studio: {
      ...base.lm_studio,
      allowed_models: [MODEL, ROUTED_MODEL],
      model_routing: { exploration: ROUTED_MODEL },
    },
    origins: {
      ...base.origins,
      "lm_studio.model_routing.exploration": "global",
    },
  };
}

function configuration(
  overrides: {
    readonly maxInteractions?: number;
    readonly contextBytes?: number;
  } = {},
): EffectiveConfiguration {
  return {
    schema_version: 1,
    revision: `sha256:${"c".repeat(64)}`,
    lm_studio: {
      base_url: "http://127.0.0.1:1234/v1",
      authentication: "bearer",
      token_configured: true,
      allowed_models: [MODEL],
      default_model: MODEL,
    },
    limits: {
      ...BUILT_IN_LIMITS,
      max_exploration_interactions:
        overrides.maxInteractions ??
        BUILT_IN_LIMITS.max_exploration_interactions,
      context_budget_bytes:
        overrides.contextBytes ?? BUILT_IN_LIMITS.context_budget_bytes,
    },
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
