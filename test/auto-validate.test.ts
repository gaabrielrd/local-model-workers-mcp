import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  BUILT_IN_SUPERVISION,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import {
  AutoValidateInputSchema,
  applyValidatedPatch,
  autoValidateTests,
  createSandbox,
  detectTestCommand,
  runSandboxProcess,
  splitCommand,
  type SandboxProcessRun,
  type CreateSandboxOptions,
} from "../src/features/auto-validate/index.js";
import type { ModelInferencePort } from "../src/features/model-inference/index.js";
import type { TaskCapacityCoordinator } from "../src/features/task-execution/index.js";
import type { ValidatedTestPatch } from "../src/features/test-proposal/index.js";
import { PatchApplyError } from "../src/features/auto-validate/index.js";

const MODEL = "qwen/default";

void test("passes on the first iteration, returns evidence, and never touches the original repository", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(
    path.join(root, "package.json"),
    '{"scripts":{"test":"node --test"}}\n',
  );
  await mkdir(path.join(root, "test"));
  const before = await snapshotTree(root);

  let sandboxRoot: string | undefined;
  let disposed = false;
  const sandboxFactory = async (options: CreateSandboxOptions) => {
    const sandbox = await createSandbox(options);
    sandboxRoot = sandbox.root;
    return {
      ...sandbox,
      dispose: async () => {
        disposed = true;
        await sandbox.dispose();
      },
    };
  };
  const progress: string[] = [];
  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage for the value" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(
        unifiedDiff("test/value.test.ts", ["+test('value', () => {});"]),
      ),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory,
    commandRunner: () => Promise.resolve(passingRun("2 passed")),
    onIterationProgress: (event) =>
      progress.push(`${event.iteration}:${event.status}`),
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.status, "validated");
    assert.equal(response.result.test_command, "npm test");
    assert.equal(response.result.iteration_count, 1);
    assert.deepEqual(response.result.test_results, {
      passed: 2,
      failed: 0,
      errors: 0,
    });
    assert.equal(response.result.attempts[0]?.passed, true);
    assert.equal(response.result.attempts[0]?.exit_code, 0);
  }
  assert.deepEqual(progress, [
    "1:generating",
    "1:applying",
    "1:running",
    "1:analyzing",
  ]);
  assert.equal(disposed, true);
  const createdRoot = sandboxRoot;
  if (createdRoot !== undefined) {
    await assert.rejects(() => access(createdRoot), { code: "ENOENT" });
  }
  assert.deepEqual(await snapshotTree(root), before);
});

void test("fails on the first iteration and validates after model refinement", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));
  let calls = 0;

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage for the value" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(
        unifiedDiff("test/value.test.ts", ["+test('value', () => {});"]),
      ),
      proposalOutput(
        unifiedDiff("test/value.test.ts", [
          "+test('value', () => { expect(1).toBe(1); });",
        ]),
      ),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
    commandRunner: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? failingRun("1 failed") : passingRun("1 passed"),
      );
    },
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.status, "validated");
    assert.equal(response.result.iteration_count, 2);
    assert.equal(response.result.attempts[0]?.passed, false);
    assert.equal(response.result.attempts[1]?.passed, true);
    assert.match(response.result.patch, /expect\(1\)\.toBe\(1\)/u);
  }
});

void test("returns the best attempt with diagnostics when all iterations fail", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage for the value" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(unifiedDiff("test/a.test.ts", ["+test('a', () => {});"])),
      proposalOutput(unifiedDiff("test/b.test.ts", ["+test('b', () => {});"])),
      proposalOutput(unifiedDiff("test/c.test.ts", ["+test('c', () => {});"])),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
    commandRunner: () => Promise.resolve(failingRun("3 failed")),
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.status, "exhausted");
    assert.equal(response.result.iteration_count, 3);
    assert.equal(response.result.max_iterations, 3);
    assert.equal(response.result.attempts.length, 3);
    assert.equal(response.result.diagnostics.length, 1);
    assert.equal(response.result.limitations[0]?.code, "unvalidated_tests");
    assert.equal(
      response.result.attempts.every((attempt) => attempt.passed === false),
      true,
    );
  }
});

void test("moves to the next iteration when the sandbox process times out", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));
  let calls = 0;

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(unifiedDiff("test/a.test.ts", ["+test('a', () => {});"])),
      proposalOutput(unifiedDiff("test/b.test.ts", ["+test('b', () => {});"])),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
    commandRunner: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? {
              ...passingRun("2 passed"),
              exit_code: null,
              timed_out: true,
              signal_code: null,
            }
          : passingRun("2 passed"),
      );
    },
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.status, "validated");
    assert.equal(response.result.attempts[0]?.timed_out, true);
    assert.equal(response.result.attempts[0]?.exit_code, null);
    assert.equal(response.result.iteration_count, 2);
  }
});

void test("auto-detects pytest for Python sandbox copies", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "pytest.ini"), "[pytest]\n");
  await mkdir(path.join(root, "tests"));
  let sandboxRoot: string | undefined;
  const sandboxFactory = async (options: CreateSandboxOptions) => {
    const sandbox = await createSandbox(options);
    sandboxRoot = sandbox.root;
    return sandbox;
  };

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(
        unifiedDiff("tests/test_value.py", [
          "+def test_value():",
          "+    assert 1 == 1",
        ]),
      ),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory,
    commandRunner: () => Promise.resolve(passingRun("1 passed")),
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.test_command, "python -m pytest");
  }
  await assert.rejects(() => access(sandboxRoot ?? ""), { code: "ENOENT" });
});

void test("uses an explicit test command verbatim", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));

  const response = await autoValidateTests({
    request: {
      repository_root: root,
      goal: "Add coverage",
      test_command: "node --test test/",
    },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(unifiedDiff("test/a.test.ts", ["+test('a', () => {});"])),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
    commandRunner: (options) => {
      assert.equal(options.command, "node");
      assert.deepEqual(options.args, ["--test", "test/"]);
      return Promise.resolve(passingRun("1 passed"));
    },
  });

  assert.equal(response.status, "completed");
  if (response.status === "completed") {
    assert.equal(response.result.test_command, "node --test test/");
  }
});

void test("blocks when no test command can be auto-detected or provided", async (t) => {
  const root = await repositoryRoot(t);

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage" },
    configuration: configuration(),
    inference: inferenceFrom([]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(false),
  });

  assert.equal(response.status, "blocked");
  if (response.status === "blocked") {
    assert.equal(response.diagnostic.code, "invalid_configuration");
    assert.equal(response.limitations[0]?.code, "missing_test_infrastructure");
  }
});

void test("blocks on an empty explicit test command", async (t) => {
  const root = await repositoryRoot(t);

  const response = await autoValidateTests({
    request: {
      repository_root: root,
      goal: "Add coverage",
      test_command: "   ",
    },
    configuration: configuration(),
    inference: inferenceFrom([]),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
  });

  assert.equal(response.status, "blocked");
  if (response.status === "blocked") {
    assert.equal(response.diagnostic.code, "invalid_request");
  }
});

void test("blocks on unresolved conflicts without consuming extra iterations", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));
  let calls = 0;

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage" },
    configuration: configuration(),
    inference: inferenceFrom(
      [
        proposalOutput(
          unifiedDiff("test/a.test.ts", ["+test('a', () => {});"]),
          ["test/a.test.ts"],
          ["Goal and behavior disagree."],
        ),
      ],
      () => {
        calls += 1;
      },
    ),
    coordinator: immediateCoordinator,
    language: "en",
    sandboxFactory: () => fakeSandbox(),
  });

  assert.equal(response.status, "blocked");
  if (response.status === "blocked") {
    assert.equal(response.diagnostic.code, "invalid_evidence");
  }
  assert.equal(calls, 1);
});

void test("cancellation aborts the loop and cleans up the sandbox", async (t) => {
  const root = await repositoryRoot(t);
  await writeFile(path.join(root, "package.json"), "{}");
  await mkdir(path.join(root, "test"));
  const controller = new AbortController();
  let disposed = false;

  const response = await autoValidateTests({
    request: { repository_root: root, goal: "Add coverage" },
    configuration: configuration(),
    inference: inferenceFrom([
      proposalOutput(unifiedDiff("test/a.test.ts", ["+test('a', () => {});"])),
      proposalOutput(unifiedDiff("test/b.test.ts", ["+test('b', () => {});"])),
    ]),
    coordinator: immediateCoordinator,
    language: "en",
    signal: controller.signal,
    sandboxFactory: async () => {
      const sandbox = await fakeSandbox();
      return {
        ...sandbox,
        dispose: async () => {
          disposed = true;
          await sandbox.dispose();
        },
      };
    },
    commandRunner: () => {
      controller.abort();
      return Promise.resolve(failingRun("1 failed"));
    },
  });

  assert.equal(response.status, "cancelled");
  assert.equal(disposed, true);
});

void test("input schema bounds iteration count and timeout", () => {
  assert.throws(() =>
    AutoValidateInputSchema.parse({
      repository_root: "/x",
      goal: "g",
      max_iterations: 6,
    }),
  );
  assert.throws(() =>
    AutoValidateInputSchema.parse({
      repository_root: "/x",
      goal: "g",
      timeout_per_iteration_ms: 300_001,
    }),
  );
  const parsed = AutoValidateInputSchema.parse({
    repository_root: "/x",
    goal: "g",
  });
  assert.equal(parsed.max_iterations, undefined);
  assert.equal(parsed.timeout_per_iteration_ms, undefined);
});

void test("sandbox process output capture is bounded to 64KB", async () => {
  const run = await runSandboxProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(100000))"],
    cwd: os.tmpdir(),
    timeout_ms: 10_000,
  });
  assert.equal(run.stdout.length, 64 * 1_024);
  assert.equal(run.stdout_truncated, true);
  assert.equal(run.exit_code, 0);
});

void test("sandbox timeout kills the child process", async () => {
  const startedAt = Date.now();
  const run = await runSandboxProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    cwd: os.tmpdir(),
    timeout_ms: 150,
  });
  assert.equal(run.timed_out, true);
  assert.equal(run.exit_code, null);
  assert.ok(Date.now() - startedAt < 10_000);
});

void test("splitCommand parses quoted arguments", () => {
  assert.deepEqual(splitCommand("npm test"), ["npm", "test"]);
  assert.deepEqual(splitCommand('node --run "with space"'), [
    "node",
    "--run",
    "with space",
  ]);
  assert.deepEqual(splitCommand("   "), []);
});

void test("detectTestCommand recognizes npm and pytest projects", async (t) => {
  const npmRoot = await repositoryRoot(t);
  await writeFile(path.join(npmRoot, "package.json"), "{}");
  await mkdir(path.join(npmRoot, "test"));
  assert.deepEqual(await detectTestCommand(npmRoot), {
    command: "npm",
    args: ["test"],
  });

  const pythonRoot = await repositoryRoot(t);
  await writeFile(path.join(pythonRoot, "pytest.ini"), "[pytest]\n");
  await mkdir(path.join(pythonRoot, "tests"));
  assert.deepEqual(await detectTestCommand(pythonRoot), {
    command: "python",
    args: ["-m", "pytest"],
  });

  const emptyRoot = await repositoryRoot(t);
  assert.equal(await detectTestCommand(emptyRoot), undefined);
});

void test("applyValidatedPatch creates new files and edits existing content", async (t) => {
  const root = await repositoryRoot(t);
  const existing = path.join(root, "test");
  await mkdir(existing);
  await writeFile(
    path.join(existing, "value.test.ts"),
    "const a = 1;\nconst b = 2;\n",
  );

  await applyValidatedPatch({
    root,
    patch: validated(
      unifiedDiff("test/added.test.ts", ["+test('added', () => {});"]),
    ),
  });
  const added = await readFile(path.join(existing, "added.test.ts"), "utf8");
  assert.equal(added, "test('added', () => {});\n");

  await applyValidatedPatch({
    root,
    patch: validated(
      [
        "diff --git a/test/value.test.ts b/test/value.test.ts",
        "--- a/test/value.test.ts",
        "+++ b/test/value.test.ts",
        "@@ -1,2 +1,2 @@",
        "-const a = 1;",
        "+const a = 10;",
        " const b = 2;",
        "",
      ].join("\n"),
    ),
  });
  const edited = await readFile(path.join(existing, "value.test.ts"), "utf8");
  assert.equal(edited, "const a = 10;\nconst b = 2;\n");
});

void test("applyValidatedPatch rejects paths escaping the sandbox root", async (t) => {
  const root = await repositoryRoot(t);
  const escaped = unifiedDiff("test/../escape.test.ts", [
    "+test('x', () => {});",
  ]);
  await assert.rejects(
    () =>
      applyValidatedPatch({
        root,
        patch: validated(escaped),
      }),
    (error: unknown) =>
      error instanceof PatchApplyError && error.code === "path_not_allowed",
  );
});

void test("applyValidatedPatch refuses to write through a symlink escape", async (t) => {
  const root = await repositoryRoot(t);
  const outsideRoot = await repositoryRoot(t);
  const outsideFile = path.join(outsideRoot, "outside.js");
  await writeFile(outsideFile, "export const value = 1;\n");
  await mkdir(path.join(root, "test"));
  try {
    await symlink(outsideFile, path.join(root, "test", "link.test.ts"));
  } catch {
    t.skip("symlinks are not supported on this platform");
    return;
  }
  await assert.rejects(
    () =>
      applyValidatedPatch({
        root,
        patch: validated(
          [
            "diff --git a/test/link.test.ts b/test/link.test.ts",
            "--- a/test/link.test.ts",
            "+++ b/test/link.test.ts",
            "@@ -1,1 +1,1 @@",
            "-export const value = 1;",
            "+export const value = 2;",
            "",
          ].join("\n"),
        ),
      }),
    (error: unknown) =>
      error instanceof PatchApplyError && error.code === "path_not_allowed",
  );
  assert.equal(
    await readFile(outsideFile, "utf8"),
    "export const value = 1;\n",
  );
});

async function fakeSandbox(seeded = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-validate-sandbox-"));
  if (seeded) {
    await writeFile(path.join(root, "package.json"), "{}\n");
  }
  return {
    root,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function passingRun(output: string): SandboxProcessRun {
  return {
    exit_code: 0,
    signal_code: null,
    stdout: output,
    stderr: "",
    stdout_truncated: false,
    stderr_truncated: false,
    timed_out: false,
    error: null,
    duration_ms: 1,
  };
}

function failingRun(stderr: string): SandboxProcessRun {
  return {
    exit_code: 1,
    signal_code: null,
    stdout: "",
    stderr,
    stdout_truncated: false,
    stderr_truncated: false,
    timed_out: false,
    error: null,
    duration_ms: 1,
  };
}

function proposalOutput(
  patch: string,
  affectedFiles = affectedFrom(patch),
  unresolvedConflicts: string[] = [],
) {
  return {
    patch,
    test_summary: "Covers the exported value.",
    affected_files: affectedFiles,
    unresolved_conflicts: unresolvedConflicts,
    suggested_commands: ["npm test"],
  };
}

function affectedFrom(patch: string): string[] {
  const files: string[] = [];
  for (const match of patch.matchAll(
    /^diff --git a\/[^\s"]+ b\/([^\s"]+)$/gmu,
  )) {
    const file = match[1];
    if (file !== undefined) {
      files.push(file);
    }
  }
  return files;
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

function validated(patch: string): ValidatedTestPatch {
  return { patch, files: [], changed_lines: 0 };
}

function inferenceFrom(
  outputs: readonly unknown[],
  onCall?: (call: number) => void,
): ModelInferencePort {
  const remaining = [...outputs];
  let calls = 0;
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: (request) => {
      calls += 1;
      onCall?.(calls);
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

async function repositoryRoot(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "auto-validate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function snapshotTree(root: string): Promise<string[]> {
  const entries: string[] = [];
  const visit = async (directory: string, relative: string) => {
    const names = await readdir(directory, { withFileTypes: true });
    names.sort((left, right) => left.name.localeCompare(right.name));
    for (const name of names) {
      const childRelative = path.join(relative, name.name);
      const childAbsolute = path.join(directory, name.name);
      if (name.isDirectory()) {
        await visit(childAbsolute, childRelative);
      } else if (name.isFile()) {
        entries.push(
          `${childRelative}:${await readFile(childAbsolute, "utf8")}`,
        );
      }
    }
  };
  await visit(root, "");
  return entries;
}

const immediateCoordinator: TaskCapacityCoordinator = {
  runWithCapacity: (_input, work) => work(),
};

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
    supervision: {
      enabled: BUILT_IN_SUPERVISION.enabled,
      interval_ms: BUILT_IN_SUPERVISION.interval_ms,
      rss_limit_bytes: BUILT_IN_SUPERVISION.rss_limit_mb * 1_024 * 1_024,
      event_loop_lag_ms: BUILT_IN_SUPERVISION.event_loop_lag_ms,
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
    },
  };
}
