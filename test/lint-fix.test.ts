import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  type ModelInferencePort,
  type StructuredInferenceRequest,
} from "../src/features/model-inference/index.js";
import {
  RepositoryAccessError,
  createOutboundContextCollector,
  createRepositoryReadCapability,
  type CreateOutboundContextCollectorInput,
  type OutboundContextCollector,
  type RepositoryReadCapability,
} from "../src/features/repository-exploration/index.js";
import {
  FixLintViolationsResultSchema,
  LintFixError,
  detectLinter,
  fixLintViolations,
  parseBiome,
  parseRuff,
  validateLintPatch,
} from "../src/features/lint-fix/index.js";
import { PatchPolicyError } from "../src/features/test-proposal/index.js";

const ROOT = "/repo";
const MODEL = "qwen/default";

interface CapturedCall {
  readonly system: string;
  readonly user: string;
  readonly outputName: string;
}

void test("ESLint JSON output with three violations produces a validated patch fixing all three", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      "const a = 1",
      "export function f(x) {",
      '  return x == "y"',
      "}",
      "export const b = 2",
      "",
    ].join("\n"),
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        {
          ruleId: "no-unused-vars",
          severity: 2,
          message: "'a' is assigned a value but never used.",
          line: 1,
          column: 6,
        },
        {
          ruleId: "eqeqeq",
          severity: 1,
          message: "Expected '===' and instead saw '=='.",
          line: 3,
          column: 10,
        },
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 5,
          column: 19,
        },
      ],
    },
  ]);
  const patch = modifyDiff("src/app.ts", 1, [
    "-const a = 1",
    "+const a = 1;",
    " export function f(x) {",
    '-  return x == "y"',
    '+  return x === "y"',
    " }",
    " export const b = 2",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(patch, [
        { file: "src/app.ts", line: 1, rule_id: "no-unused-vars" },
        { file: "src/app.ts", line: 3, rule_id: "eqeqeq" },
        { file: "src/app.ts", line: 5, rule_id: "semi" },
      ]),
      calls,
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.patch, patch);
  assert.equal(result.fixed_violations.length, 3);
  assert.equal(result.unfixed_violations.length, 0);
  assert.equal(FixLintViolationsResultSchema.safeParse(result).success, true);
  const user = JSON.parse(calls[0]?.user ?? "{}") as {
    linter?: string;
    files?: readonly {
      path?: string;
      violations?: readonly unknown[];
    }[];
  };
  assert.equal(user.linter, "eslint");
  assert.equal(user.files?.[0]?.path, "src/app.ts");
  assert.equal(user.files?.[0]?.violations?.length, 3);
});

void test("auto-detection relativizes absolute file paths inside the repository", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "const a = 1\nexport const b = 2\n",
  });
  const lintOutput = JSON.stringify([
    {
      filePath: `${ROOT}/src/app.ts`,
      messages: [
        {
          ruleId: "no-unused-vars",
          severity: 2,
          message: "'a' is assigned a value but never used.",
          line: 1,
          column: 6,
        },
      ],
    },
  ]);
  const patch = modifyDiff("src/app.ts", 1, [
    "-const a = 1",
    "+const a = 1;",
    " export const b = 2",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(patch, [
        { file: "src/app.ts", line: 1, rule_id: "no-unused-vars" },
      ]),
      calls,
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.fixed_violations.length, 1);
  const user = JSON.parse(calls[0]?.user ?? "{}") as {
    linter?: string;
    files?: readonly { path?: string }[];
  };
  assert.equal(user.linter, "eslint");
  assert.equal(user.files?.[0]?.path, "src/app.ts");
});

void test("Biome JSON output is parsed with explicit lines and span-derived lines", () => {
  const parsed = parseBiome(
    JSON.stringify({
      diagnostics: [
        {
          category: "lint/suspicious/noDebugger",
          description: "This is an unexpected use of the debugger statement.",
          severity: "error",
          location: {
            path: { file: "src/app.ts" },
            start: { line: 4, column: 3 },
          },
        },
        {
          category: "lint/style/noUselessElse",
          severity: "warning",
          description: "This else clause can be omitted.",
          location: {
            path: { file: "src/app.ts" },
            span: [10, 15],
            source_code: "x = y\nfunction z() {\n  a\n  b\n}\n",
          },
        },
      ],
    }),
  );
  assert.deepEqual(parsed, [
    {
      file: "src/app.ts",
      line: 4,
      column: 3,
      rule_id: "lint/suspicious/noDebugger",
      severity: "error",
      message: "This is an unexpected use of the debugger statement.",
    },
    {
      file: "src/app.ts",
      line: 2,
      column: 1,
      rule_id: "lint/style/noUselessElse",
      severity: "warning",
      message: "This else clause can be omitted.",
    },
  ]);
});

void test("Biome JSON output drives a full fix run", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "const value = 1\nexport function f() {}\n",
  });
  const lintOutput = JSON.stringify({
    diagnostics: [
      {
        category: "lint/style/noVar",
        description: "Unexpected var, use let or const instead.",
        severity: "error",
        location: {
          path: { file: "src/app.ts" },
          start: { line: 1, column: 1 },
        },
      },
    ],
  });
  const patch = modifyDiff("src/app.ts", 1, [
    "-const value = 1",
    "+const value = 2",
    " export function f() {}",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput, linter: "biome" },
    inference: fakeInference(
      remoteFix(patch, [
        { file: "src/app.ts", line: 1, rule_id: "lint/style/noVar" },
      ]),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.patch, patch);
  assert.equal(result.fixed_violations.length, 1);
});

void test("Ruff JSON output for Python files is parsed", () => {
  const parsed = parseRuff(
    JSON.stringify([
      {
        code: "F401",
        message: "`os` imported but unused",
        filename: "src/app.py",
        location: { row: 2, column: 1 },
        end_location: { row: 2, column: 4 },
        fix: null,
        url: "https://docs.astral.sh/ruff/rules/unused-import/",
        fix_availability: "sometimes",
        noqa_row: 2,
      },
    ]),
  );
  assert.deepEqual(parsed, [
    {
      file: "src/app.py",
      line: 2,
      column: 1,
      rule_id: "F401",
      severity: "error",
      message: "`os` imported but unused",
    },
  ]);
});

void test("auto-detection identifies the linter from the output format", () => {
  assert.equal(
    detectLinter(JSON.stringify([{ filePath: "src/app.ts", messages: [] }])),
    "eslint",
  );
  assert.equal(
    detectLinter(
      JSON.stringify([
        {
          code: "F401",
          message: "unused",
          filename: "src/app.py",
          location: { row: 1, column: 1 },
        },
      ]),
    ),
    "ruff",
  );
  assert.equal(detectLinter('{"diagnostics": []}'), "biome");
  assert.throws(
    () => detectLinter("not json"),
    (error: unknown) =>
      error instanceof LintFixError && error.code === "invalid_lint_output",
  );
  assert.throws(
    () => detectLinter("[]"),
    (error: unknown) =>
      error instanceof LintFixError && error.code === "invalid_lint_output",
  );
});

void test("a patch changing lines far from a reported violation is rejected", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "line one\nline two\nline three\nline four\nline five\n",
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 2,
          column: 1,
        },
      ],
    },
  ]);
  const farPatch = modifyDiff("src/app.ts", 20, [
    "-line twenty",
    "+line twenty;",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(farPatch, [{ file: "src/app.ts", line: 2, rule_id: "semi" }]),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.patch, "");
  assert.equal(result.fixed_violations.length, 0);
  assert.equal(result.unfixed_violations.length, 1);
  assert.match(
    result.unfixed_violations[0]?.reason ?? "",
    /outside the reported violation area/u,
  );
});

void test("a patch that modifies unreported files is rejected", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "const a = 1;\n",
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 1,
          column: 1,
        },
      ],
    },
  ]);
  const patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-const a = 1;",
    "+const a = 1",
    "diff --git a/src/unreported.ts b/src/unreported.ts",
    "--- a/src/unreported.ts",
    "+++ b/src/unreported.ts",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(patch, [{ file: "src/app.ts", line: 1, rule_id: "semi" }]),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.patch, "");
  assert.equal(result.fixed_violations.length, 0);
  assert.match(result.unfixed_violations[0]?.reason ?? "", /not reported/u);
});

void test("violations requiring architectural changes are reported as unfixed with reasons", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export const unused = 1;\nexport function f() {}\n",
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        {
          ruleId: "no-unused-vars",
          severity: 2,
          message: "unused",
          line: 1,
          column: 13,
        },
      ],
    },
  ]);
  const patch = modifyDiff("src/app.ts", 1, [
    "-export const unused = 1;",
    "+export const used = 1;",
    " export function f() {}",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(
        patch,
        [],
        [
          {
            file: "src/app.ts",
            line: 1,
            rule_id: "no-unused-vars",
            reason: "requires_architectural_change",
          },
        ],
      ),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.fixed_violations.length, 0);
  assert.equal(result.unfixed_violations.length, 1);
  assert.equal(
    result.unfixed_violations[0]?.reason,
    "requires_architectural_change",
  );
});

void test("violations in files beyond max_files are reported as unfixed", async () => {
  const repositoryRead = fakeRepoRead({
    "src/a.ts": "const a = 1;\n",
    "src/b.ts": "const b = 1;\n",
    "src/c.ts": "const c = 1;\n",
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/a.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      filePath: "src/b.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      filePath: "src/c.ts",
      messages: [
        {
          ruleId: "semi",
          severity: 2,
          message: "Missing semicolon.",
          line: 1,
          column: 1,
        },
      ],
    },
  ]);
  const patch = [
    modifyDiff("src/a.ts", 1, ["-const a = 1;", "+const a = 1"]),
    modifyDiff("src/b.ts", 1, ["-const b = 1;", "+const b = 1"]),
  ].join("");

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput, max_files: 2 },
    inference: fakeInference(
      remoteFix(patch, [
        { file: "src/a.ts", line: 1, rule_id: "semi" },
        { file: "src/b.ts", line: 1, rule_id: "semi" },
      ]),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.fixed_violations.length, 2);
  assert.equal(result.unfixed_violations.length, 1);
  assert.equal(result.unfixed_violations[0]?.file, "src/c.ts");
  assert.equal(result.unfixed_violations[0]?.reason, "max_files_exceeded");
});

void test("validateLintPatch enforces file and changed-line limits", async () => {
  const patch = modifyDiff("src/app.ts", 1, ["-a", "+b"]);
  await assert.rejects(
    validateLintPatch({
      patch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      violationLines: new Map([["src/app.ts", [1]]]),
      maxFiles: 0,
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError &&
      error.code === "patch_limit_exceeded",
  );
  await assert.rejects(
    validateLintPatch({
      patch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      violationLines: new Map([["src/app.ts", [1]]]),
      maxChangedLines: 1,
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError &&
      error.code === "patch_limit_exceeded",
  );
  await assert.rejects(
    validateLintPatch({
      patch: "not a diff",
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      violationLines: new Map([["src/app.ts", [1]]]),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError && error.code === "malformed_patch",
  );
  await assert.rejects(
    validateLintPatch({
      patch: [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,1 +1,1 @@",
        "-a",
        "+b",
        "",
      ].join("\n"),
      repositoryRoot: ROOT,
      allowedFiles: ["src/other.ts"],
      violationLines: new Map([["src/other.ts", [1]]]),
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError && error.code === "patch_not_allowed",
  );
});

void test("sensitive files are excluded by content filtering", async () => {
  const repositoryRead = fakeRepoRead({ "src/.env": "SECRET=value\n" });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/.env",
      messages: [
        { ruleId: "no-secret", severity: 2, message: "x", line: 1, column: 1 },
      ],
    },
  ]);

  const result = await fixLintViolations({
    input: { repository_root: ROOT, lint_output: lintOutput },
    inference: fakeInference(remoteFix("", [])),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.patch, "");
  assert.equal(result.fixed_violations.length, 0);
  assert.equal(result.unfixed_violations[0]?.reason, "sensitive_path");
});

void test("malformed lint output returns a clear error", async () => {
  await assert.rejects(
    fixLintViolations({
      input: { repository_root: ROOT, lint_output: "not json" },
      inference: fakeInference(remoteFix("", [])),
      repositoryRead: fakeRepoRead({}),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof LintFixError && error.code === "invalid_lint_output",
  );
});

void test("invalid input returns a clear error", async () => {
  await assert.rejects(
    fixLintViolations({
      input: { lint_output: "[]" },
      inference: fakeInference(remoteFix("", [])),
      repositoryRead: fakeRepoRead({}),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof LintFixError && error.code === "invalid_request",
  );
});

void test("no repository writes occur during the process", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lint-fix-writes-"));
  await mkdir(path.join(root, "src"));
  const original = "export const a = 1\n";
  await writeFile(path.join(root, "src", "app.ts"), original, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const repositoryRead = await createRepositoryReadCapability({
    repositoryRoot: root,
  });
  const lintOutput = JSON.stringify([
    {
      filePath: "src/app.ts",
      messages: [
        { ruleId: "semi", severity: 2, message: "x", line: 1, column: 1 },
      ],
    },
  ]);
  const patch = modifyDiff("src/app.ts", 1, [
    "-export const a = 1",
    "+export const a = 1;",
  ]);

  const result = await fixLintViolations({
    input: { repository_root: root, lint_output: lintOutput },
    inference: fakeInference(
      remoteFix(patch, [{ file: "src/app.ts", line: 1, rule_id: "semi" }]),
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.equal(result.patch, patch);
  assert.equal(result.fixed_violations.length, 1);
  assert.equal(
    await readFile(path.join(root, "src", "app.ts"), "utf8"),
    original,
  );
  assert.deepEqual(await readdir(path.join(root, "src")), ["app.ts"]);
});

function fakeInference(
  output: unknown,
  calls: CapturedCall[] = [],
): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) => {
      const system =
        request.messages.find((message) => message.role === "system")
          ?.content ?? "";
      const user =
        request.messages.find((message) => message.role === "user")?.content ??
        "";
      calls.push({ system, user, outputName: request.output_name });
      const parsed = request.output_schema.parse(output);
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

function safeCollector(
  input: CreateOutboundContextCollectorInput,
): Promise<OutboundContextCollector> {
  return createOutboundContextCollector({
    ...input,
    gitIgnorePolicy: { isIgnored: () => Promise.resolve(false) },
    projectIgnorePolicy: {
      excludes: () => false,
      ignored_negation_rules: 0,
    },
  });
}

function remoteFix(
  patch: string,
  fixed: readonly { file: string; line: number; rule_id: string }[],
  unfixed: readonly {
    file: string;
    line: number;
    rule_id: string;
    reason: string;
  }[] = [],
  summary = "Fixed reported violations.",
) {
  return {
    patch,
    fixed_violations: fixed,
    unfixed_violations: unfixed,
    summary,
  };
}

function modifyDiff(
  file: string,
  newStart: number,
  body: readonly string[],
): string {
  const additions = body.filter((line) => line.startsWith("+")).length;
  const deletions = body.filter((line) => line.startsWith("-")).length;
  const oldCount = body.length - additions;
  const newCount = body.length - deletions;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${newStart},${oldCount} +${newStart},${newCount} @@`,
    ...body,
    "",
  ].join("\n");
}

function fakeRepoRead(files: Record<string, string>): RepositoryReadCapability {
  const byPath = new Map(Object.entries(files));
  return {
    listDirectory: (input) => {
      const directory = input?.path ?? ".";
      if (byPath.has(directory)) {
        return Promise.reject(
          new RepositoryAccessError(
            "invalid_request",
            "list_directory",
            "Directory listing requires a directory.",
          ),
        );
      }
      const prefix = directory === "." ? "" : `${directory}/`;
      const seen = new Set<string>();
      const entries: {
        readonly path: string;
        readonly name: string;
        readonly kind: "file" | "directory";
      }[] = [];
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0) continue;
        const first = rest.split("/")[0];
        if (first === undefined || first.length === 0 || seen.has(first))
          continue;
        seen.add(first);
        const full = `${prefix}${first}`;
        entries.push({
          path: full,
          name: first,
          kind: byPath.has(full) ? "file" : "directory",
        });
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      return Promise.resolve({ entries, truncated: false });
    },
    searchText: () =>
      Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      }),
    readSnippet: (input) => {
      const content = byPath.get(input.path);
      if (content === undefined) {
        return Promise.reject(
          new RepositoryAccessError(
            "repository_not_found",
            "read_snippet",
            "File not found.",
          ),
        );
      }
      const lines = content.split("\n");
      const start = input.start_line ?? 1;
      const count = input.line_count ?? 200;
      if (start > lines.length) {
        return Promise.reject(
          new RepositoryAccessError(
            "invalid_request",
            "read_snippet",
            "The requested start line is outside the file.",
          ),
        );
      }
      const selected = lines.slice(start - 1, start - 1 + count);
      return Promise.resolve({
        path: input.path,
        start_line: start,
        end_line: start + selected.length - 1,
        content: selected.join("\n"),
        truncated: start - 1 + selected.length < lines.length,
      });
    },
  };
}
