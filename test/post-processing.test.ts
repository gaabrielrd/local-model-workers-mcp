import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT,
  type PostProcessingHook,
} from "../src/features/configuration/index.js";
import {
  createPostProcessingRunner,
  type PostProcessingAdapters,
  type RunHookProcessOptions,
} from "../src/features/post-processing/index.js";

interface CapturedRun {
  readonly hook: PostProcessingHook;
  readonly cwd: string;
  readonly stdin: string;
}

function fakeAdapters(
  runs: CapturedRun[],
  perRunStdout: readonly string[] = [],
): {
  readonly adapters: PostProcessingAdapters;
  readonly created: string[];
  readonly removed: string[];
  readonly outcome: {
    exit_code: number | null;
    signal_code: string | null;
    stdout: string;
    stderr: string;
    timed_out: boolean;
    error: string | null;
    duration_ms: number;
  };
} {
  const created: string[] = [];
  const removed: string[] = [];
  const state = {
    exit_code: 0 as number | null,
    signal_code: null as string | null,
    stdout: "",
    stderr: "",
    timed_out: false,
    error: null as string | null,
    duration_ms: 5,
  };
  return {
    created,
    removed,
    outcome: state,
    adapters: {
      createTempDirectory: async () => {
        const directory = path.join(
          os.tmpdir(),
          `lmw-hook-test-${created.length}`,
        );
        await mkdir(directory, { recursive: true });
        created.push(directory);
        return directory;
      },
      removeDirectory: (directory) => {
        removed.push(directory);
        return Promise.resolve();
      },
      runProcess: (options: RunHookProcessOptions) => {
        runs.push({
          hook: options.hook,
          cwd: options.cwd,
          stdin: options.stdin,
        });
        const stdout = perRunStdout[runs.length - 1] ?? state.stdout;
        return Promise.resolve({ ...state, stdout });
      },
    },
  };
}

const PATCH = [
  "diff --git a/src/value.ts b/src/value.ts",
  "--- a/src/value.ts",
  "+++ b/src/value.ts",
  "@@ -1,1 +1,1 @@",
  " export const value = 1;",
  "+export const added = 2;",
  "",
].join("\n");

const HOOK: PostProcessingHook = { command: "formatter", args: ["--fix"] };

void test("empty hook list passes the patch through without creating a directory", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, created } = fakeAdapters(captured);
  const service = createPostProcessingRunner({ adapters });

  const outcome = await service.applyPatchHooks({
    hooks: [],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.deepEqual(outcome, { status: "passed", patch: PATCH, executed: [] });
  assert.deepEqual(captured, []);
  assert.deepEqual(created, []);
});

void test("an unchanged hook output passes the patch through untouched", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, created, removed } = fakeAdapters(captured);
  const service = createPostProcessingRunner({ adapters });
  let validations = 0;

  const outcome = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => {
      validations += 1;
      return Promise.resolve(PATCH);
    },
  });

  assert.equal(outcome.status, "passed");
  if (outcome.status === "passed") {
    assert.equal(outcome.patch, PATCH);
    assert.deepEqual(outcome.executed, ["formatter --fix"]);
  }
  assert.equal(validations, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.stdin, PATCH);
  assert.equal(created.length, 1);
  assert.deepEqual(removed, created);
});

void test("a transformed hook output is re-validated before being accepted", async () => {
  const transformed = PATCH.replace(
    "export const value = 1;",
    "export const value = 1; // formatted",
  );
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.stdout = transformed;
  const service = createPostProcessingRunner({ adapters });
  let validatedWith = "";

  const result = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: (patch) => {
      validatedWith = patch;
      return Promise.resolve(patch);
    },
  });

  assert.equal(result.status, "passed");
  if (result.status === "passed") {
    assert.equal(result.patch, transformed);
  }
  assert.equal(validatedWith, transformed);
});

void test("a rejected transformation blocks the patch", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.stdout = PATCH.replace("src/value.ts", "src/outside.ts");
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => Promise.reject(new Error("Patch escapes the repository.")),
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "hook_failed");
    assert.equal(result.hook, "formatter --fix");
    assert.match(result.diagnostic, /rejected by the local patch policy/);
  }
});

void test("a non-zero exit blocks the patch and reports stderr", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.exit_code = 1;
  outcome.stderr = "missing license header";
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "hook_failed");
    assert.equal(result.hook, "formatter --fix");
    assert.match(result.diagnostic, /exited with code 1/);
    assert.match(result.diagnostic, /missing license header/);
  }
});

void test("a timed-out hook blocks the patch with the configured timeout", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.timed_out = true;
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [{ command: "slow-hook", timeout_ms: 123 }],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "hook_timed_out");
    assert.match(result.diagnostic, /timed out after 123ms/);
  }
});

void test("a timed-out hook without an explicit timeout reports the default", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.timed_out = true;
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.match(
      result.diagnostic,
      new RegExp(
        `timed out after ${POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT}ms`,
      ),
    );
  }
});

void test("a spawn failure blocks the patch with the process error", async () => {
  const captured: CapturedRun[] = [];
  const { adapters, outcome } = fakeAdapters(captured);
  outcome.error = "ENOENT: no such command";
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.code, "hook_spawn_failed");
    assert.match(result.diagnostic, /could not be started/);
  }
});

void test("hooks run against a temporary directory, never the repository", async () => {
  const repoRoot = path.join(os.tmpdir(), `lmw-hook-repo-${process.pid}`);
  await mkdir(repoRoot, { recursive: true });
  await writeFile(
    path.join(repoRoot, "tracked.ts"),
    "export const tracked = 1;\n",
  );
  const captured: CapturedRun[] = [];
  const { adapters, created, removed } = fakeAdapters(captured);
  const service = createPostProcessingRunner({ adapters });

  const outcome = await service.applyPatchHooks({
    hooks: [HOOK],
    patch: PATCH,
    validate: () => Promise.resolve(PATCH),
  });

  assert.equal(outcome.status, "passed");
  assert.equal(captured.length, 1);
  const run = captured[0];
  assert.ok(run !== undefined);
  assert.notEqual(run.cwd, repoRoot);
  assert.equal(created.length, 1);
  assert.equal(run.cwd, created[0]);
  assert.deepEqual(removed, created);
  assert.deepEqual(await readdir(repoRoot), ["tracked.ts"]);
});

void test("multiple hooks run sequentially and the last output wins", async () => {
  const captured: CapturedRun[] = [];
  const first = PATCH;
  const second = PATCH.replace(
    "export const value = 1;",
    "export const value = 1; // step-2",
  );
  const { adapters } = fakeAdapters(captured, ["", second]);
  const service = createPostProcessingRunner({ adapters });

  const result = await service.applyPatchHooks({
    hooks: [
      { command: "first", args: ["a"] },
      { command: "second", args: ["b"] },
    ],
    patch: PATCH,
    validate: (patch) => Promise.resolve(patch),
  });

  assert.equal(result.status, "passed");
  if (result.status === "passed") {
    assert.equal(result.patch, second);
    assert.deepEqual(result.executed, ["first a", "second b"]);
  }
  assert.deepEqual(
    captured.map((run) => run.hook),
    [
      { command: "first", args: ["a"] },
      { command: "second", args: ["b"] },
    ],
  );
  assert.equal(captured[0]?.stdin, PATCH);
  assert.equal(captured[1]?.stdin, first);
});
