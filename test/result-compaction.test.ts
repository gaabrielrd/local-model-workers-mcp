import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTerseResult,
  renderToolResult,
} from "../src/features/mcp-server/index.js";

void test("terse compaction drops exploration prose fields but keeps structure", () => {
  const output = {
    status: "completed",
    result: {
      summary: { language: "pt-BR", text: "Análise concluída." },
      relevant_files: ["src/index.ts", "src/config.ts"],
      risks: [{ language: "pt-BR", text: "Risco de leitura." }],
      next_steps: [{ language: "pt-BR", text: "Ler o arquivo B." }],
      analyzed_files: ["src/index.ts"],
      relevant_unread_files: ["docs/todo.md"],
      limitation_impact: { language: "pt-BR", text: "Sem impacto." },
    },
    evidence: [
      {
        path: "src/index.ts",
        start_line: 1,
        end_line: 10,
        explanation: { language: "pt-BR", text: "Justificativa longa." },
      },
    ],
    limitations: [],
  };

  const compacted = compactTerseResult(output);

  assert.equal(compacted.status, "completed");
  assert.equal("risks" in (compacted.result as Record<string, unknown>), false);
  assert.equal(
    "next_steps" in (compacted.result as Record<string, unknown>),
    false,
  );
  assert.equal(
    "limitation_impact" in (compacted.result as Record<string, unknown>),
    false,
  );
  assert.deepEqual(
    (compacted.result as { relevant_files: readonly string[] }).relevant_files,
    ["src/index.ts", "src/config.ts"],
  );
  const evidence = compacted.evidence as readonly Record<string, unknown>[];
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.path, "src/index.ts");
  assert.equal(evidence[0]?.start_line, 1);
  assert.equal("explanation" in evidence[0], false);
  assert.deepEqual(compacted.limitations, []);
});

void test("terse compaction drops auto-validate per-attempt patches but keeps the final patch", () => {
  const output = {
    status: "validated",
    test_command: "npm test",
    iteration_count: 2,
    max_iterations: 3,
    attempts: [
      {
        iteration: 1,
        patch: "diff --git a/test/a.test.ts b/test/a.test.ts\n+huge",
        affected_files: ["test/a.test.ts"],
        passed: false,
        exit_code: 1,
        timed_out: false,
        test_results: { passed: 0, failed: 1, errors: 0 },
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_excerpt: "output",
        stderr_excerpt: "errors",
      },
    ],
    patch: "diff --git a/test/a.test.ts b/test/a.test.ts\n+final validated",
    test_results: { passed: 2, failed: 0, errors: 0 },
    diagnostics: [],
    limitations: [],
  };

  const compacted = compactTerseResult(output);

  const attempts = compacted.attempts as readonly Record<string, unknown>[];
  assert.equal(attempts.length, 1);
  assert.equal("patch" in (attempts[0] as Record<string, unknown>), false);
  assert.equal(attempts[0]?.stdout_excerpt, "output");
  assert.equal(attempts[0]?.iteration, 1);
  assert.match(compacted.patch as string, /final validated/);
});

void test("terse compaction drops analyze_diff architectural notes", () => {
  const output = {
    summary: "Analisado.",
    changed_files_count: 2,
    additions: 10,
    deletions: 4,
    impact_rating: "medium",
    architectural_notes: ["Impacto moderado."],
  };

  const compacted = compactTerseResult(output);

  assert.equal(compacted.summary, "Analisado.");
  assert.equal(compacted.changed_files_count, 2);
  assert.equal("architectural_notes" in compacted, false);
});

void test("terse compaction leaves unrelated structured data untouched", () => {
  const output = {
    schema_version: 1,
    files: [
      {
        path: "src/a.ts",
        summary: "Resumo do módulo.",
        symbols: [{ name: "f", kind: "function", signature: "f(): void" }],
        exports: ["f"],
        dependencies: ["node:fs"],
      },
    ],
    nested: { list: [{ keep: "value" }], count: 3 },
  };

  assert.deepEqual(compactTerseResult(output), output);
});

void test("renderToolResult returns identical content for standard and verbose", () => {
  const structured = { status: "ok", evidence: [{ path: "a.ts" }] };

  const standard = renderToolResult(structured, "standard");
  const verbose = renderToolResult(structured, "verbose");

  assert.deepEqual(standard, verbose);
  assert.equal(standard.content[0]?.text, JSON.stringify(structured));
  assert.deepEqual(standard.structuredContent, structured);
});

void test("renderToolResult compacts both representations in terse mode", () => {
  const structured = {
    status: "ok",
    risks: ["Algo"],
    next_steps: ["Passo"],
    evidence: [{ path: "a.ts", explanation: { text: "Porquê" } }],
  };

  const rendered = renderToolResult(structured, "terse");

  assert.equal(
    rendered.content[0]?.text,
    JSON.stringify(rendered.structuredContent),
  );
  assert.deepEqual(rendered.structuredContent, compactTerseResult(structured));
  assert.equal("risks" in rendered.structuredContent, false);
  const evidence = rendered.structuredContent.evidence as readonly Record<
    string,
    unknown
  >[];
  assert.equal("explanation" in evidence[0]!, false);
});
