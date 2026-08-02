import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  NON_TASK_TOOL_NAMES,
  TASK_TOOL_NAMES,
  TOOL_NAMES,
} from "../src/features/mcp-server/index.js";
import {
  DiagnosticSchema,
  ERROR_CODES,
  EvidenceSchema,
  LocalizedTextSchema,
  REDACTED_TEXT,
  TERMINAL_STATUSES,
  createCompletedTaskResponse,
  createDiagnostic,
  createDiagnosticTaskResponse,
  type CompletedTaskResponse,
} from "../src/features/task-execution/index.js";

const summarySchema = z
  .object({
    summary: LocalizedTextSchema,
  })
  .strict();

const identity = {
  task_id: "task-123",
  model: "local-model",
  config_revision: "revision-7",
} as const;

void test("only the six approved tool names exist", () => {
  assert.deepEqual(Object.values(TOOL_NAMES).sort(), [
    "check_health",
    "explore_repository",
    "get_config",
    "propose_tests",
    "update_config",
    "validate_config",
  ]);

  assert.deepEqual(
    [...TASK_TOOL_NAMES, ...NON_TASK_TOOL_NAMES].sort(),
    Object.values(TOOL_NAMES).sort(),
  );
});

void test("terminal states are closed to the approved values", () => {
  assert.deepEqual(TERMINAL_STATUSES, [
    "completed",
    "blocked",
    "failed",
    "cancelled",
    "timed_out",
  ]);
});

void test("a completed task requires identity, result, evidence, and limitations", () => {
  const response: CompletedTaskResponse<z.infer<typeof summarySchema>> =
    createCompletedTaskResponse(summarySchema, {
      ...identity,
      status: "completed",
      result: {
        summary: {
          language: "pt-BR",
          text: "Análise concluída.",
        },
      },
      evidence: [
        {
          path: "src/example.ts",
          start_line: 3,
          end_line: 5,
          explanation: {
            language: "pt-BR",
            text: "O comportamento aparece neste trecho.",
          },
        },
      ],
      limitations: [],
    });

  assert.equal(response.status, "completed");
  assert.equal(response.result.summary.language, "pt-BR");
  assert.equal(response.task_id, identity.task_id);
});

void test("completed responses reject diagnostics, partial results, and missing identity", () => {
  const validResult = {
    summary: { language: "en", text: "Done." },
  };

  assert.throws(() =>
    createCompletedTaskResponse(summarySchema, {
      ...identity,
      status: "completed",
      result: validResult,
      evidence: [],
      limitations: [],
      diagnostic: createDiagnostic({
        code: "internal_error",
        message: { language: "en", text: "Partial." },
      }),
    }),
  );

  assert.throws(() =>
    createCompletedTaskResponse(summarySchema, {
      ...identity,
      status: "completed",
      result: validResult,
      partial_result: validResult,
      evidence: [],
      limitations: [],
    }),
  );

  assert.throws(() =>
    createCompletedTaskResponse(summarySchema, {
      status: "completed",
      model: identity.model,
      config_revision: identity.config_revision,
      result: validResult,
      evidence: [],
      limitations: [],
    }),
  );
});

for (const status of ["blocked", "failed", "cancelled", "timed_out"] as const) {
  void test(`${status} tasks contain diagnostics and no result`, () => {
    const response = createDiagnosticTaskResponse({
      ...identity,
      status,
      diagnostic: createDiagnostic({
        code: status === "blocked" ? "invalid_evidence" : "internal_error",
        message: { language: "en", text: "Task did not complete." },
      }),
      evidence: [],
      limitations: [],
    });

    assert.equal(response.status, status);

    assert.throws(() =>
      createDiagnosticTaskResponse({
        ...response,
        result: { summary: "must not be serialized" },
      }),
    );
  });
}

void test("evidence requires a valid positive line range", () => {
  assert.throws(() =>
    EvidenceSchema.parse({
      path: "src/example.ts",
      start_line: 8,
      end_line: 3,
      explanation: { language: "en", text: "Invalid range." },
    }),
  );

  assert.throws(() =>
    EvidenceSchema.parse({
      path: "src/example.ts",
      start_line: 0,
      end_line: 1,
      explanation: { language: "en", text: "Invalid start." },
    }),
  );
});

void test("unknown technical states and error codes are rejected", () => {
  assert.throws(() =>
    createDiagnosticTaskResponse({
      ...identity,
      status: "running",
      diagnostic: createDiagnostic({
        code: "internal_error",
        message: { language: "en", text: "Invalid state." },
      }),
      evidence: [],
      limitations: [],
    }),
  );

  assert.throws(() =>
    DiagnosticSchema.parse({
      code: "unknown_error",
      message: { language: "en", text: "Invalid code." },
      issues: [],
      redaction_count: 0,
    }),
  );

  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
});

void test("Portuguese changes human text without translating technical fields", () => {
  const response = createDiagnosticTaskResponse({
    ...identity,
    status: "blocked",
    diagnostic: createDiagnostic({
      code: "invalid_evidence",
      message: {
        language: "pt-BR",
        text: "A evidência não pôde ser validada.",
      },
    }),
    evidence: [],
    limitations: [],
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.diagnostic.code, "invalid_evidence");
  assert.equal(response.diagnostic.message.language, "pt-BR");
  assert.match(response.diagnostic.message.text, /evidência/u);
});

void test("diagnostics redact known secrets and report whether replacement occurred", () => {
  const untouchedPlaceholder = createDiagnostic({
    code: "internal_error",
    message: { language: "en", text: `Literal ${REDACTED_TEXT}` },
  });
  const secret = "super-secret-token";
  const redacted = createDiagnostic(
    {
      code: "invalid_configuration",
      message: { language: "en", text: `Token ${secret} is invalid.` },
      issues: [
        {
          field: "authorization",
          message: { language: "en", text: `${secret} cannot be used.` },
        },
      ],
    },
    [secret, secret],
  );

  assert.equal(untouchedPlaceholder.redaction_count, 0);
  assert.equal(redacted.redaction_count, 2);
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(secret, "u"));
  assert.match(redacted.message.text, /\[REDACTED\]/u);
});

void test("secret replacement occurs in one pass", () => {
  const redacted = createDiagnostic(
    {
      code: "invalid_configuration",
      message: { language: "en", text: "The token is super-secret-token." },
    },
    ["super-secret-token", "ACT"],
  );

  assert.equal(redacted.message.text, `The token is ${REDACTED_TEXT}.`);
  assert.equal(redacted.redaction_count, 1);
});

void test("diagnostic issue fields are bounded technical identifiers", () => {
  assert.throws(() =>
    createDiagnostic({
      code: "invalid_configuration",
      message: { language: "en", text: "Invalid field." },
      issues: [
        {
          field: "Token super-secret-token",
          message: { language: "en", text: "Invalid." },
        },
      ],
    }),
  );
});
