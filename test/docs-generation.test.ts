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
  parseUntrustedPrompt,
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
  DocsGenerationError,
  GenerateDocsPatchResultSchema,
  buildUnifiedDiff,
  detectDocumentableFile,
  docsMarkdownPathForTarget,
  generateDocsPatch,
  validateDocsPatch,
} from "../src/features/docs-generation/index.js";
import type { PostProcessingService } from "../src/features/post-processing/index.js";
import { PatchPolicyError } from "../src/features/test-proposal/index.js";

const ROOT = "/repo";
const MODEL = "qwen/default";

const USAGE = {
  prompt_tokens: 1,
  completion_tokens: 1,
  total_tokens: 2,
  reasoning_tokens: 0,
};

interface CapturedCall {
  readonly system: string;
  readonly user: string;
  readonly outputName: string;
}

void test("inline TypeScript documentation produces a validated additions-only patch", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "export class Calculator {}",
      "const helper = () => 1;",
    ].join("\n"),
  });

  const result = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src/app.ts", doc_type: "inline" },
    inference: fakeInference(
      {
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [
              { name: "add", content: "Adds two numbers." },
              { name: "Calculator", content: "A calculator." },
            ],
          },
        ],
        summary: "Documented public symbols of src/app.ts.",
      },
      calls,
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(
    result.patch,
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,5 +1,11 @@",
      "+/**",
      "+ * Adds two numbers.",
      "+ */",
      " export function add(a: number, b: number): number {",
      "   return a + b;",
      " }",
      "+/**",
      "+ * A calculator.",
      "+ */",
      " export class Calculator {}",
      " const helper = () => 1;",
      "",
    ].join("\n"),
  );
  assert.equal(result.changed_lines, 6);
  assert.deepEqual(result.files, [
    {
      path: "src/app.ts",
      additions: 6,
      deletions: 0,
      changed_lines: 6,
    },
  ]);
  assert.equal(GenerateDocsPatchResultSchema.safeParse(result).success, true);

  const docsCall = calls.find((call) => call.outputName === "docs_generation");
  assert.ok(docsCall !== undefined);
  const user = promptPayload(docsCall.user) as unknown as {
    task?: string;
    doc_type?: string;
    files?: readonly {
      path?: string;
      language?: string;
      style?: string;
      symbols?: readonly { name?: string }[];
    }[];
  };
  assert.equal(user.task, "generate_docs_patch");
  assert.equal(user.doc_type, "inline");
  assert.equal(user.files?.[0]?.path, "src/app.ts");
  assert.equal(user.files?.[0]?.language, "typescript");
  assert.equal(user.files?.[0]?.style, "jsdoc");
  assert.deepEqual(
    user.files?.[0]?.symbols?.map((symbol) => symbol.name),
    ["add", "Calculator"],
  );
});

void test("a blocked post-processing hook fails the documentation generation closed", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n"),
  });

  await assert.rejects(
    generateDocsPatch({
      input: {
        repository_root: ROOT,
        target: "src/app.ts",
        doc_type: "inline",
      },
      inference: fakeInference({
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [{ name: "add", content: "Adds two numbers." }],
          },
        ],
        summary: "Documented add.",
      }),
      repositoryRead,
      model: MODEL,
      collectorFactory: safeCollector,
      inspectPath: () => Promise.resolve("safe"),
      post_processing_hooks: [{ command: "docs-policy" }],
      postProcessing: blockedPostProcessing("Docs policy rejected the patch."),
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError &&
      error.code === "invalid_output" &&
      /Docs policy rejected/.test(error.message),
  );
});

void test("a hook-transformed documentation patch is delivered after revalidation", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n"),
  });
  const original = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,6 @@",
    "+/**",
    "+ * Adds two numbers.",
    "+ */",
    " export function add(a: number, b: number): number {",
    "   return a + b;",
    " }",
    "",
  ].join("\n");
  const transformed = original.replace(
    "+ * Adds two numbers.",
    "+ * Adds two numbers. (formatted)",
  );

  const result = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src/app.ts", doc_type: "inline" },
    inference: fakeInference({
      files: [
        {
          path: "src/app.ts",
          symbol_docs: [{ name: "add", content: "Adds two numbers." }],
        },
      ],
      summary: "Documented add.",
    }),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
    post_processing_hooks: [{ command: "formatter" }],
    postProcessing: transformingPostProcessing(transformed),
  });

  assert.ok(result.patch.includes("(formatted)"));
});

function blockedPostProcessing(diagnostic: string): PostProcessingService {
  return {
    applyPatchHooks: () =>
      Promise.resolve({
        status: "blocked" as const,
        hook: "docs-policy",
        code: "hook_failed" as const,
        diagnostic,
        executed: ["docs-policy"],
      }),
  };
}

function transformingPostProcessing(next: string): PostProcessingService {
  return {
    applyPatchHooks: () =>
      Promise.resolve({
        status: "passed" as const,
        patch: next,
        executed: ["formatter"],
      }),
  };
}

void test("inline Python documentation uses a google-style docstring and skips documented symbols", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.py": [
      "def add(a, b):",
      "    return a + b",
      "",
      "",
      "def subtract(a, b):",
      '    """Subtracts b from a."""',
      "    return a - b",
      "",
      "",
      "def _private():",
      "    return 0",
    ].join("\n"),
  });

  const result = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src/app.py", doc_type: "inline" },
    inference: fakeInference(
      {
        files: [
          {
            path: "src/app.py",
            symbol_docs: [
              {
                name: "add",
                content:
                  "Adds two numbers.\n\nArgs:\n    a: first\n    b: second\n\nReturns:\n    The sum.",
              },
            ],
          },
        ],
        summary: "Documented add.",
      },
      calls,
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.equal(result.changed_lines, 10);
  assert.match(result.patch, /diff --git a\/src\/app\.py b\/src\/app\.py/u);
  assert.match(result.patch, /\+ {4}"""/u);
  assert.match(result.patch, /\+ {4}Args:/u);
  assert.equal(result.patch.includes("Subtract"), false);

  const docsCall = calls.find((call) => call.outputName === "docs_generation");
  assert.ok(docsCall !== undefined);
  const user = promptPayload(docsCall.user) as unknown as {
    files?: readonly {
      path?: string;
      language?: string;
      style?: string;
      symbols?: readonly { name?: string }[];
    }[];
  };
  assert.equal(user.files?.[0]?.path, "src/app.py");
  assert.equal(user.files?.[0]?.language, "python");
  assert.equal(user.files?.[0]?.style, "google");
  assert.deepEqual(
    user.files?.[0]?.symbols?.map((symbol) => symbol.name),
    ["add"],
  );
});

void test("markdown mode produces a new docs/<slug>.md file", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export function f() {}",
  });

  const result = await generateDocsPatch({
    input: {
      repository_root: ROOT,
      target: "src/app.ts",
      doc_type: "markdown",
    },
    inference: fakeInference({
      files: [{ path: "src/app.ts", symbol_docs: [] }],
      markdown: "# app\n\nModule purpose.\n\n- `f()` example.",
      summary: "Wrote a markdown guide.",
    }),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.match(
    result.patch,
    /diff --git a\/docs\/src-app\.md b\/docs\/src-app\.md/u,
  );
  assert.match(result.patch, /new file mode 100644/u);
  assert.match(result.patch, /--- \/dev\/null/u);
  assert.match(result.patch, /\+# app/u);
  assert.deepEqual(result.files, [
    { path: "docs/src-app.md", additions: 5, deletions: 0, changed_lines: 5 },
  ]);
  assert.equal(result.changed_lines, 5);
});

void test("both mode produces inline documentation and a markdown guide", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export function f() {}",
  });

  const result = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src/app.ts", doc_type: "both" },
    inference: fakeInference({
      files: [
        {
          path: "src/app.ts",
          symbol_docs: [{ name: "f", content: "Does f." }],
        },
      ],
      markdown: "# app\n",
      summary: "Documented the module.",
    }),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.match(result.patch, /\+ \* Does f\./u);
  assert.match(
    result.patch,
    /diff --git a\/docs\/src-app\.md b\/docs\/src-app\.md/u,
  );
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["src/app.ts", "docs/src-app.md"],
  );
  assert.equal(result.changed_lines, 4);
});

void test("already documented symbols are skipped unless force_refresh is set", async () => {
  const source = [
    "/**",
    " * Documented function.",
    " */",
    "export function documented() {}",
    "",
    "export function undocumented() {}",
  ].join("\n");

  const skipCalls: CapturedCall[] = [];
  const skipResult = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src/app.ts", doc_type: "inline" },
    inference: fakeInference(
      {
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [{ name: "undocumented", content: "New docs." }],
          },
        ],
        summary: "Documented the missing symbol.",
      },
      skipCalls,
    ),
    repositoryRead: fakeRepoRead({ "src/app.ts": source }),
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });
  assert.match(skipResult.patch, /\+ \* New docs\./u);
  assert.equal((skipResult.patch.match(/^\+\/\*\*/gmu) ?? []).length, 1);

  const forceCalls: CapturedCall[] = [];
  const forceResult = await generateDocsPatch({
    input: {
      repository_root: ROOT,
      target: "src/app.ts",
      doc_type: "inline",
      force_refresh: true,
    },
    inference: fakeInference(
      {
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [
              { name: "documented", content: "Regenerated documented." },
              { name: "undocumented", content: "New docs." },
            ],
          },
        ],
        summary: "Refreshed all public symbols.",
      },
      forceCalls,
    ),
    repositoryRead: fakeRepoRead({ "src/app.ts": source }),
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });
  assert.match(forceResult.patch, /\+ \* Regenerated documented\./u);
  assert.match(forceResult.patch, /\+ \* New docs\./u);
  assert.equal((forceResult.patch.match(/^\+\/\*\*/gmu) ?? []).length, 2);

  const forceCall = forceCalls.find(
    (call) => call.outputName === "docs_generation",
  );
  assert.ok(forceCall !== undefined);
  const user = promptPayload(forceCall.user) as unknown as {
    files?: readonly {
      symbols?: readonly { name?: string }[];
    }[];
  };
  assert.deepEqual(
    user.files?.[0]?.symbols?.map((symbol) => symbol.name),
    ["documented", "undocumented"],
  );
});

void test("the requested style is applied when compatible with the file language", async () => {
  const runStyle = async (style: string, file: string, source: string) => {
    const calls: CapturedCall[] = [];
    await generateDocsPatch({
      input: {
        repository_root: ROOT,
        target: file,
        doc_type: "inline",
        style,
      },
      inference: fakeInference(
        {
          files: [
            {
              path: file,
              symbol_docs: [{ name: "f", content: "Docs." }],
            },
          ],
          summary: "Documented.",
        },
        calls,
      ),
      repositoryRead: fakeRepoRead({ [file]: source }),
      model: MODEL,
      collectorFactory: safeCollector,
      inspectPath: () => Promise.resolve("safe"),
    });
    const docsCall = calls.find(
      (call) => call.outputName === "docs_generation",
    );
    const user = promptPayload(docsCall?.user ?? "") as unknown as {
      files?: readonly { style?: string }[];
    };
    return user.files?.[0]?.style;
  };

  assert.equal(
    await runStyle("tsdoc", "src/target.ts", "export function f() {}"),
    "tsdoc",
  );
  assert.equal(
    await runStyle("jsdoc", "src/target.ts", "export function f() {}"),
    "jsdoc",
  );
  assert.equal(
    await runStyle("numpy", "src/target.py", "def f():\n    pass"),
    "numpy",
  );
  assert.equal(
    await runStyle("google", "src/target.py", "def f():\n    pass"),
    "google",
  );
  assert.equal(
    await runStyle("numpy", "src/target.ts", "export function f() {}"),
    "jsdoc",
  );
  assert.equal(
    await runStyle("jsdoc", "src/target.py", "def f():\n    pass"),
    "google",
  );
});

void test("a directory target documents every public file within it", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/a.ts": "export function a() {}",
    "src/b.ts": "export class B {}",
  });

  const result = await generateDocsPatch({
    input: { repository_root: ROOT, target: "src", doc_type: "inline" },
    inference: fakeInference(
      {
        files: [
          {
            path: "src/a.ts",
            symbol_docs: [{ name: "a", content: "Docs a." }],
          },
          {
            path: "src/b.ts",
            symbol_docs: [{ name: "B", content: "Docs B." }],
          },
        ],
        summary: "Documented src.",
      },
      calls,
    ),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
    inspectPath: () => Promise.resolve("safe"),
  });

  assert.deepEqual(
    result.files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.match(result.patch, /diff --git a\/src\/a\.ts b\/src\/a\.ts/u);
  assert.match(result.patch, /diff --git a\/src\/b\.ts b\/src\/b\.ts/u);
  assert.equal(
    calls.filter((call) => call.outputName === "module_summary").length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.outputName === "module_aggregate_summary")
      .length,
    1,
  );
});

void test("validateDocsPatch rejects deletions, out-of-scope files, and limit overflows", async () => {
  const deletionPatch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-export function f() {}",
    "+export function g() {}",
    "",
  ].join("\n");
  await assert.rejects(
    validateDocsPatch({
      patch: deletionPatch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError && error.code === "patch_not_allowed",
  );

  const outOfScopePatch = modifyDiff("src/other.ts", 1, ["-a", "+b"]);
  await assert.rejects(
    validateDocsPatch({
      patch: outOfScopePatch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError && error.code === "patch_not_allowed",
  );

  const validPatch = modifyDiff("src/app.ts", 1, ["-a", "+b"]);
  await assert.rejects(
    validateDocsPatch({
      patch: validPatch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      maxFiles: 0,
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError &&
      error.code === "patch_limit_exceeded",
  );
  await assert.rejects(
    validateDocsPatch({
      patch: validPatch,
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
      maxChangedLines: 1,
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError &&
      error.code === "patch_limit_exceeded",
  );
  await assert.rejects(
    validateDocsPatch({
      patch: "not a diff",
      repositoryRoot: ROOT,
      allowedFiles: ["src/app.ts"],
    }),
    (error: unknown) =>
      error instanceof PatchPolicyError && error.code === "malformed_patch",
  );
});

void test("model content that breaks the comment syntax is rejected as invalid output", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export function f() {}",
  });

  await assert.rejects(
    generateDocsPatch({
      input: {
        repository_root: ROOT,
        target: "src/app.ts",
        doc_type: "inline",
      },
      inference: fakeInference({
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [{ name: "f", content: "Bad */ comment." }],
          },
        ],
        summary: "Broken output.",
      }),
      repositoryRead,
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError && error.code === "invalid_output",
  );
});

void test("source files changing between read and delivery return an invalid_evidence error", async () => {
  await assert.rejects(
    generateDocsPatch({
      input: {
        repository_root: ROOT,
        target: "src/app.ts",
        doc_type: "inline",
      },
      inference: fakeInference({
        files: [
          {
            path: "src/app.ts",
            symbol_docs: [{ name: "f", content: "Docs." }],
          },
        ],
        summary: "Documented.",
      }),
      repositoryRead: changingRepoRead({
        "src/app.ts": "export function f() {}",
      }),
      model: MODEL,
      collectorFactory: safeCollector,
      inspectPath: () => Promise.resolve("safe"),
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError && error.code === "invalid_evidence",
  );
});

void test("invalid input returns a clear error", async () => {
  await assert.rejects(
    generateDocsPatch({
      input: { target: "src/app.ts", doc_type: "inline" },
      inference: fakeInference({
        files: [],
        summary: "unused",
      }),
      repositoryRead: fakeRepoRead({}),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError && error.code === "invalid_request",
  );
});

void test("inline mode with every symbol already documented returns no_documentable_files", async () => {
  const calls: CapturedCall[] = [];
  await assert.rejects(
    generateDocsPatch({
      input: {
        repository_root: ROOT,
        target: "src/app.ts",
        doc_type: "inline",
      },
      inference: fakeInference(
        {
          files: [{ path: "src/app.ts", symbol_docs: [] }],
          summary: "unused",
        },
        calls,
      ),
      repositoryRead: fakeRepoRead({
        "src/app.ts": [
          "/**",
          " * Documented.",
          " */",
          "export function f() {}",
        ].join("\n"),
      }),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError &&
      error.code === "no_documentable_files",
  );
  assert.equal(calls.length, 0);
});

void test("a target without documentable code files returns no_documentable_files", async () => {
  await assert.rejects(
    generateDocsPatch({
      input: { repository_root: ROOT, target: "README.md", doc_type: "inline" },
      inference: fakeInference({ files: [], summary: "unused" }),
      repositoryRead: fakeRepoRead({ "README.md": "# Readme\n" }),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof DocsGenerationError &&
      error.code === "no_documentable_files",
  );
});

void test("no repository writes occur during the process", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docs-gen-writes-"));
  await mkdir(path.join(root, "src"));
  const original = "export function f() {}\n";
  await writeFile(path.join(root, "src", "app.ts"), original, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  const repositoryRead = await createRepositoryReadCapability({
    repositoryRoot: root,
  });
  const result = await generateDocsPatch({
    input: { repository_root: root, target: "src/app.ts", doc_type: "inline" },
    inference: fakeInference({
      files: [
        {
          path: "src/app.ts",
          symbol_docs: [{ name: "f", content: "Does f." }],
        },
      ],
      summary: "Documented the module.",
    }),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.match(result.patch, /\+ \* Does f\./u);
  assert.equal(
    await readFile(path.join(root, "src", "app.ts"), "utf8"),
    original,
  );
  assert.deepEqual(await readdir(path.join(root, "src")), ["app.ts"]);
});

void test("docsMarkdownPathForTarget derives a stable docs path", () => {
  assert.equal(docsMarkdownPathForTarget("src/app.ts"), "docs/src-app.md");
  assert.equal(docsMarkdownPathForTarget("./src/app.py"), "docs/src-app.md");
  assert.equal(
    docsMarkdownPathForTarget("src/deep/app.tsx"),
    "docs/src-deep-app.md",
  );
  assert.equal(docsMarkdownPathForTarget("src"), "docs/src.md");
  assert.equal(docsMarkdownPathForTarget("/abs/app.js"), "docs/abs-app.md");
});

void test("buildUnifiedDiff produces modified and new-file unified diffs", () => {
  const modified = buildUnifiedDiff(
    "src/app.ts",
    ["a", "b", "c"],
    ["a", "x", "b", "c"],
  );
  assert.ok(modified);
  assert.equal(modified.additions, 1);
  assert.equal(modified.deletions, 0);
  assert.match(modified.patch, /^diff --git a\/src\/app\.ts b\/src\/app\.ts/u);
  assert.match(modified.patch, /\+x/u);

  const created = buildUnifiedDiff("docs/src-app.md", [], ["# app"]);
  assert.ok(created);
  assert.equal(created.additions, 1);
  assert.match(created.patch, /new file mode 100644/u);
  assert.match(created.patch, /--- \/dev\/null/u);
});

void test("detectDocumentableFile filters by documentation status and style", () => {
  const tsSource = [
    "/** Doc. */",
    "export function f() {}",
    "export function g() {}",
  ].join("\n");
  const ts = detectDocumentableFile("src/app.ts", tsSource);
  assert.equal(ts.language, "typescript");
  assert.equal(ts.style, "jsdoc");
  assert.deepEqual(
    ts.symbols.map((symbol) => symbol.name),
    ["g"],
  );
  const forced = detectDocumentableFile(
    "src/app.ts",
    tsSource,
    undefined,
    true,
  );
  assert.deepEqual(
    forced.symbols.map((symbol) => symbol.name),
    ["f", "g"],
  );

  const pySource = [
    "def a():",
    "    pass",
    "",
    "def b():",
    '    """Doc."""',
    "    pass",
    "",
  ].join("\n");
  const py = detectDocumentableFile("src/app.py", pySource);
  assert.equal(py.language, "python");
  assert.equal(py.style, "google");
  assert.deepEqual(
    py.symbols.map((symbol) => symbol.name),
    ["a"],
  );
  assert.equal(
    detectDocumentableFile("src/app.py", pySource, "numpy").style,
    "numpy",
  );
  assert.equal(
    detectDocumentableFile("src/app.py", pySource, "jsdoc").style,
    "google",
  );
});

function fakeInference(
  docsOutput: unknown,
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

      if (request.output_name === "docs_generation") {
        const output = request.output_schema.parse(docsOutput);
        return Promise.resolve({ model: request.model, output, usage: USAGE });
      }
      const payload = promptPayload(user) as unknown as {
        readonly task?: string;
        readonly path?: string;
        readonly file_summaries?: readonly unknown[];
      };
      const summary =
        payload.task === "summarize_module_aggregate"
          ? `Aggregate of ${payload.file_summaries?.length ?? 0} files`
          : `Summary of ${payload.path}.`;
      const output = request.output_schema.parse({ summary });
      return Promise.resolve({ model: request.model, output, usage: USAGE });
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

function changingRepoRead(
  files: Record<string, string>,
): RepositoryReadCapability {
  const base = fakeRepoRead(files);
  const reads = new Map<string, number>();
  return {
    listDirectory: (input) => base.listDirectory(input),
    searchText: (input) => base.searchText(input),
    readSnippet: (input) => {
      const content = files[input.path];
      if (content === undefined) {
        return Promise.reject(
          new RepositoryAccessError(
            "repository_not_found",
            "read_snippet",
            "File not found.",
          ),
        );
      }
      const count = reads.get(input.path) ?? 0;
      reads.set(input.path, count + 1);
      const changed = count === 0 ? content : `${content}\n// changed`;
      const lines = changed.split("\n");
      const start = input.start_line ?? 1;
      const countRequested = input.line_count ?? 200;
      const selected = lines.slice(start - 1, start - 1 + countRequested);
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

/** Merges the trusted envelope and fenced data so assertions read as before. */
function promptPayload(user: string): Record<string, unknown> {
  const parsed = parseUntrustedPrompt(user);
  if (parsed === undefined) {
    throw new Error("the prompt carried no untrusted-data block");
  }
  return {
    ...(parsed.task as Record<string, unknown>),
    ...(JSON.parse(parsed.data) as Record<string, unknown>),
  };
}
