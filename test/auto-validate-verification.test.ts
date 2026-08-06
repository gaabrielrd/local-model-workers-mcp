import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  verifyPatchInSandbox,
  type RunSandboxProcessOptions,
  type SandboxProcessRun,
} from "../src/features/auto-validate/index.js";

void test("a clean patch is applied and the command runs against the result", async (t) => {
  const root = await sandbox(t, { "src/app.ts": "const a = 1\n" });
  let received: RunSandboxProcessOptions | undefined;

  const outcome = await verifyPatchInSandbox({
    root,
    patch: {
      patch: modifyDiff("src/app.ts", ["-const a = 1", "+const a = 1;"]),
    },
    command: { command: "npm", args: ["run", "lint"] },
    timeout_ms: 5_000,
    commandRunner: (options) => {
      received = options;
      return Promise.resolve(processRun({ exit_code: 0 }));
    },
  });

  assert.equal(outcome.status, "ran");
  if (outcome.status === "ran") {
    assert.equal(outcome.run.exit_code, 0);
  }
  // The command ran inside the sandbox, never the caller's repository.
  assert.equal(received?.cwd, root);
  assert.deepEqual(received?.args, ["run", "lint"]);
  // The patch really landed on disk.
  assert.equal(
    await readFile(path.join(root, "src/app.ts"), "utf8"),
    "const a = 1;\n",
  );
});

void test("a patch that does not apply is reported, not thrown", async (t) => {
  const root = await sandbox(t, { "src/app.ts": "const a = 1\n" });
  let ran = false;

  const outcome = await verifyPatchInSandbox({
    root,
    // Context that does not match the file on disk.
    patch: {
      patch: modifyDiff("src/app.ts", [
        "-const somethingElse = 9",
        "+const somethingElse = 10",
      ]),
    },
    command: { command: "npm", args: ["test"] },
    timeout_ms: 5_000,
    commandRunner: () => {
      ran = true;
      return Promise.resolve(processRun({ exit_code: 0 }));
    },
  });

  assert.equal(outcome.status, "apply_failed");
  if (outcome.status === "apply_failed") {
    assert.ok(outcome.error.length > 0);
  }
  // An unapplied patch must never reach the command.
  assert.equal(ran, false, "the command must not run on a rejected patch");
});

void test("onBeforeRun fires only after a successful apply", async (t) => {
  const root = await sandbox(t, { "src/app.ts": "const a = 1\n" });
  const events: string[] = [];

  await verifyPatchInSandbox({
    root,
    patch: {
      patch: modifyDiff("src/app.ts", ["-const a = 1", "+const a = 1;"]),
    },
    command: { command: "npm", args: ["test"] },
    timeout_ms: 5_000,
    onBeforeRun: () => events.push("before-run"),
    commandRunner: () => {
      events.push("run");
      return Promise.resolve(processRun({ exit_code: 0 }));
    },
  });
  assert.deepEqual(events, ["before-run", "run"]);

  const rejected: string[] = [];
  await verifyPatchInSandbox({
    root,
    patch: { patch: modifyDiff("src/app.ts", ["-nope", "+nope!"]) },
    command: { command: "npm", args: ["test"] },
    timeout_ms: 5_000,
    onBeforeRun: () => rejected.push("before-run"),
    commandRunner: () => Promise.resolve(processRun({ exit_code: 0 })),
  });
  assert.deepEqual(rejected, [], "a rejected patch announces no run");
});

void test("a failing command is reported as ran, not as an error", async (t) => {
  const root = await sandbox(t, { "src/app.ts": "const a = 1\n" });

  const outcome = await verifyPatchInSandbox({
    root,
    patch: {
      patch: modifyDiff("src/app.ts", ["-const a = 1", "+const a = 1;"]),
    },
    command: { command: "npm", args: ["run", "lint"] },
    timeout_ms: 5_000,
    commandRunner: () =>
      Promise.resolve(
        processRun({ exit_code: 1, stderr: "2 problems remaining" }),
      ),
  });

  // "The command failed" is a verification result the caller acts on, not an
  // exception: it is exactly the signal that the patch did not fix the problem.
  assert.equal(outcome.status, "ran");
  if (outcome.status === "ran") {
    assert.equal(outcome.run.exit_code, 1);
    assert.match(outcome.run.stderr, /2 problems remaining/u);
  }
});

void test("the caller's timeout and abort signal reach the runner", async (t) => {
  const root = await sandbox(t, { "src/app.ts": "const a = 1\n" });
  const controller = new AbortController();
  let received: RunSandboxProcessOptions | undefined;

  await verifyPatchInSandbox({
    root,
    patch: {
      patch: modifyDiff("src/app.ts", ["-const a = 1", "+const a = 1;"]),
    },
    command: { command: "npm", args: ["test"] },
    timeout_ms: 1_234,
    signal: controller.signal,
    commandRunner: (options) => {
      received = options;
      return Promise.resolve(processRun({ exit_code: 0 }));
    },
  });

  assert.equal(received?.timeout_ms, 1_234);
  assert.equal(received?.signal, controller.signal);
});

async function sandbox(
  t: test.TestContext,
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-verify-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await rm(path.dirname(target), { recursive: true, force: true }).catch(
      () => undefined,
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

function modifyDiff(file: string, body: readonly string[]): string {
  const additions = body.filter((line) => line.startsWith("+")).length;
  const deletions = body.filter((line) => line.startsWith("-")).length;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${body.length - additions} +1,${body.length - deletions} @@`,
    ...body,
    "",
  ].join("\n");
}

function processRun(
  overrides: Partial<SandboxProcessRun> = {},
): SandboxProcessRun {
  return {
    exit_code: 0,
    signal_code: null,
    stdout: "",
    stderr: "",
    stdout_truncated: false,
    stderr_truncated: false,
    timed_out: false,
    error: null,
    duration_ms: 1,
    ...overrides,
  };
}
