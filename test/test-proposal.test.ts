import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import {
  createOutboundContextCollector,
  type CreateOutboundContextCollectorInput,
  type RepositoryReadCapability,
} from "../src/features/repository-exploration/index.js";
import type { TaskCapacityCoordinator } from "../src/features/task-execution/index.js";
import { proposeTests } from "../src/features/test-proposal/index.js";

const MODEL = "qwen/default";

void test("returns a validated test-only proposal and never executes suggested commands", async (t) => {
  const root = await repositoryRoot(t);
  const capability = testCapability(() => "export const value = 1;");
  const inference = inferenceFrom([
    explorationRead(),
    explorationFinal(),
    proposal(unifiedDiff("test/value.test.ts", ["+test('value', () => {});"])),
  ]);

  const response = await run(root, capability, inference);

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.deepEqual(response.result.affected_files, ["test/value.test.ts"]);
    assert.deepEqual(response.result.required_dependencies, ["vitest"]);
    assert.deepEqual(response.result.suggested_commands, [
      "do-not-run --marker",
    ]);
    assert.equal(response.evidence[0]?.path, "src/value.ts");
  }
});

void test("blocks without calling the model when no test infrastructure exists", async (t) => {
  const root = await repositoryRoot(t);
  let calls = 0;
  const capability = testCapability(() => "source", false);

  const response = await run(
    root,
    capability,
    inferenceFrom([], () => calls++),
  );

  assert.equal(response.status, "blocked");
  assert.equal(calls, 0);
  if (response.status === "blocked") {
    assert.equal(response.limitations[0]?.code, "missing_test_infrastructure");
  }
});

void test("returns a division plan and no patch for oversized proposals", async (t) => {
  const root = await repositoryRoot(t);
  const patches = Array.from({ length: 11 }, (_, index) =>
    unifiedDiff(`test/case-${index}.test.ts`, ["+new"]),
  );
  const response = await run(
    root,
    testCapability(() => "source"),
    inferenceFrom([
      explorationRead(),
      explorationFinal(),
      proposal(
        patches.join(""),
        Array.from({ length: 11 }, (_, index) => `test/case-${index}.test.ts`),
      ),
    ]),
  );

  assert.equal(response.status, "blocked");
  if (response.status === "blocked") {
    assert.equal(response.diagnostic.code, "patch_limit_exceeded");
    assert.equal(response.limitations[0]?.code, "division_plan");
    assert.equal("result" in response, false);
  }
});

void test("blocks unresolved behavior conflicts and stale source fingerprints", async (t) => {
  const root = await repositoryRoot(t);
  const conflict = proposal(unifiedDiff("test/value.test.ts", ["+new"]));
  conflict.unresolved_conflicts = ["Goal and production behavior disagree."];
  const conflictResponse = await run(
    root,
    testCapability(() => "source"),
    inferenceFrom([explorationRead(), explorationFinal(), conflict]),
  );
  assert.equal(conflictResponse.status, "blocked");

  let changed = false;
  const staleResponse = await run(
    root,
    testCapability(() => (changed ? "changed" : "source")),
    inferenceFrom(
      [
        explorationRead(),
        explorationFinal(),
        proposal(unifiedDiff("test/value.test.ts", ["+new"])),
      ],
      (_call, outputName) => {
        if (outputName === "test_proposal") changed = true;
      },
    ),
  );
  assert.equal(staleResponse.status, "blocked");
  if (staleResponse.status === "blocked") {
    assert.equal(staleResponse.diagnostic.code, "invalid_evidence");
  }
});

async function run(
  root: string,
  capability: RepositoryReadCapability,
  inference: ModelInferencePort,
) {
  return await proposeTests({
    request: { goal: "Add coverage for value", repository_root: root },
    configuration: configuration(),
    inference,
    coordinator: immediateCoordinator,
    language: "en",
    capabilityFactory: () => Promise.resolve(capability),
    collectorFactory: safeCollector,
  });
}

function testCapability(
  source: () => string,
  infrastructure = true,
): RepositoryReadCapability {
  return {
    listDirectory: () =>
      Promise.resolve({
        entries: infrastructure
          ? [
              {
                path: "package.json",
                name: "package.json",
                kind: "file" as const,
              },
              { path: "test", name: "test", kind: "directory" as const },
              { path: "src", name: "src", kind: "directory" as const },
            ]
          : [{ path: "src", name: "src", kind: "directory" as const }],
        truncated: false,
      }),
    searchText: () =>
      Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      }),
    readSnippet: (input) => {
      const content = source();
      return Promise.resolve({
        path: input.path,
        start_line: input.start_line ?? 1,
        end_line: input.start_line ?? 1,
        content,
        truncated: false,
      });
    },
  };
}

function inferenceFrom(
  outputs: readonly unknown[],
  onCall?: (call: number, outputName: string) => void,
): ModelInferencePort {
  const remaining = [...outputs];
  let calls = 0;
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: (request) => {
      calls += 1;
      onCall?.(calls, request.output_name);
      const parsed = request.output_schema.parse(remaining.shift());
      return Promise.resolve({
        model: request.model,
        output: parsed,
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

function explorationRead() {
  return {
    action: "read_snippet",
    input: { path: "src/value.ts", start_line: 1, line_count: 1 },
    relevance: "Observable production behavior.",
  };
}

function explorationFinal() {
  return {
    action: "finalize",
    summary: "The module exposes a value.",
    relevant_files: ["src/value.ts"],
    evidence: [
      {
        path: "src/value.ts",
        start_line: 1,
        end_line: 1,
        explanation: "Defines the value.",
      },
    ],
    risks: [],
    next_steps: [],
  };
}

function proposal(patch: string, affectedFiles = ["test/value.test.ts"]) {
  return {
    patch,
    test_summary: "Covers the exported value.",
    affected_files: affectedFiles,
    premises: ["The existing test runner remains authoritative."],
    suggested_commands: ["do-not-run --marker"],
    required_dependencies: ["vitest"],
    unresolved_conflicts: [] as string[],
  };
}

function unifiedDiff(file: string, body: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body,
    "",
  ].join("\n");
}

function safeCollector(input: CreateOutboundContextCollectorInput) {
  return createOutboundContextCollector({
    ...input,
    gitIgnorePolicy: { isIgnored: () => Promise.resolve(false) },
    projectIgnorePolicy: { excludes: () => false, ignored_negation_rules: 0 },
  });
}

const immediateCoordinator: TaskCapacityCoordinator = {
  runWithCapacity: (_input, work) => work(),
};

async function repositoryRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "proposal-flow-"));
  await mkdir(path.join(root, "test"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function configuration(): EffectiveConfiguration {
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
    limits: BUILT_IN_LIMITS,
    administrative_maxima: ADMINISTRATIVE_MAXIMA,
    fixed_limits: FIXED_LIMITS,
    origins: {
      "lm_studio.base_url": "protected",
      "lm_studio.authentication": "protected",
      "lm_studio.allowed_models": "protected",
      "lm_studio.default_model": "global",
      "lm_studio.embedding_model": "built_in",
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
