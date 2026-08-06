import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SandboxProcessRun } from "../src/features/auto-validate/index.js";
import {
  lintOutputParser,
  resolveLintVerificationCommand,
  resolveTypeVerificationCommand,
  verifyFix,
} from "../src/features/lint-fix/index.js";

const PATCH = {
  patch: [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-const a = 1",
    "+const a = 1;",
    "",
  ].join("\n"),
};

void test("a clean re-run reports the fix as verified", async (t) => {
  const outcome = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "npx", args: ["eslint", "--format", "json", "."] },
    violationsBefore: 3,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => fakeSandbox(t),
    // eslint reports nothing left.
    commandRunner: () => Promise.resolve(run({ stdout: "[]" })),
  });

  assert.equal(outcome.status, "verified");
  assert.equal(outcome.violations_before, 3);
  assert.equal(outcome.violations_after, 0);
  assert.equal(outcome.command, "npx eslint --format json .");
});

void test("remaining violations are reported as not_fixed with a count", async (t) => {
  const remaining = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 1,
          column: 12,
        },
      ],
    },
  ]);

  const outcome = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "npx", args: ["eslint", "--format", "json", "."] },
    violationsBefore: 3,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => fakeSandbox(t),
    // A linter exits non-zero when it finds something; that is a result, not a
    // failure to verify.
    commandRunner: () =>
      Promise.resolve(run({ exit_code: 1, stdout: remaining })),
  });

  assert.equal(outcome.status, "not_fixed");
  assert.equal(outcome.violations_before, 3);
  assert.equal(outcome.violations_after, 1);
});

void test("a missing command reports unavailable rather than failing the fix", async () => {
  const outcome = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: undefined,
    violationsBefore: 2,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
  });

  assert.equal(outcome.status, "unavailable");
  assert.equal(outcome.violations_before, 2);
  assert.equal(outcome.violations_after, undefined);
  assert.match(outcome.reason ?? "", /No verification command/u);
});

void test("a patch that will not apply is reported, and the tool never runs", async (t) => {
  let ran = false;
  const outcome = await verifyFix({
    repositoryRoot: "/repo",
    patch: {
      patch: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n",
    },
    command: { command: "npx", args: ["eslint"] },
    violationsBefore: 1,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => fakeSandbox(t),
    commandRunner: () => {
      ran = true;
      return Promise.resolve(run({}));
    },
  });

  assert.equal(outcome.status, "apply_failed");
  assert.equal(ran, false);
});

void test("a timed-out or unspawnable command reports unavailable", async (t) => {
  const timedOut = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "npx", args: ["eslint"] },
    violationsBefore: 1,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => fakeSandbox(t),
    commandRunner: () =>
      Promise.resolve(run({ timed_out: true, exit_code: null })),
  });
  assert.equal(timedOut.status, "unavailable");
  assert.match(timedOut.reason ?? "", /deadline/u);

  const unspawnable = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "eslint-not-installed", args: [] },
    violationsBefore: 1,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => fakeSandbox(t),
    commandRunner: () =>
      Promise.resolve(run({ error: "ENOENT", exit_code: null })),
  });
  assert.equal(unspawnable.status, "unavailable");
  assert.match(unspawnable.reason ?? "", /ENOENT/u);
});

void test("a sandbox that cannot be created never blocks the fix", async () => {
  const outcome = await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "npx", args: ["eslint"] },
    violationsBefore: 1,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () => Promise.reject(new Error("no space left")),
  });

  assert.equal(outcome.status, "unavailable");
  assert.match(outcome.reason ?? "", /isolated sandbox/u);
});

void test("the sandbox is disposed even when the command fails", async (t) => {
  let disposed = false;
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-fixverify-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await verifyFix({
    repositoryRoot: "/repo",
    patch: PATCH,
    command: { command: "npx", args: ["eslint"] },
    violationsBefore: 1,
    timeout_ms: 5_000,
    parse: lintOutputParser("eslint"),
    sandboxFactory: () =>
      Promise.resolve({
        root,
        dispose: () => {
          disposed = true;
          return Promise.resolve();
        },
      }),
    commandRunner: () =>
      Promise.resolve(run({ error: "boom", exit_code: null })),
  });

  assert.equal(disposed, true, "a throwaway copy must never be left behind");
});

void test("commands are inferred per tool and overridden explicitly", () => {
  assert.deepEqual(resolveLintVerificationCommand("eslint"), {
    command: "npx",
    args: ["eslint", "--format", "json", "."],
  });
  assert.deepEqual(resolveTypeVerificationCommand("tsc"), {
    command: "npx",
    args: ["tsc", "--noEmit"],
  });

  // "auto" cannot map to a command; the caller must be explicit.
  assert.equal(resolveTypeVerificationCommand("auto"), undefined);

  assert.deepEqual(
    resolveLintVerificationCommand("eslint", "npm run lint -- --format json"),
    { command: "npm", args: ["run", "lint", "--", "--format", "json"] },
  );
});

async function fakeSandbox(
  t: test.TestContext,
): Promise<{ root: string; dispose: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-fixverify-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/app.ts"), "const a = 1\n", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

function run(overrides: Partial<SandboxProcessRun>): SandboxProcessRun {
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
