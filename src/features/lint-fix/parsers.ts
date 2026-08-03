import { z } from "zod";

import {
  LintFixError,
  type LintViolation,
  type LinterName,
} from "./contracts.js";

export function parseLintOutput(
  output: string,
  linter: LinterName | "auto",
): LintViolation[] {
  const selected = linter === "auto" ? detectLinter(output) : linter;
  switch (selected) {
    case "eslint":
      return parseEslint(output);
    case "biome":
      return parseBiome(output);
    case "ruff":
      return parseRuff(output);
  }
}

export function detectLinter(output: string): LinterName {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw malformed();
  }
  if (Array.isArray(data)) {
    if (isRecord(data[0]) && Array.isArray(data[0].messages)) {
      return "eslint";
    }
    if (
      isRecord(data[0]) &&
      typeof data[0].filename === "string" &&
      isRecord(data[0].location)
    ) {
      return "ruff";
    }
  }
  if (isRecord(data) && Array.isArray(data.diagnostics)) {
    return "biome";
  }
  throw malformed();
}

const EslintMessageSchema = z
  .object({
    ruleId: z.string().nullable().optional(),
    severity: z.number().int().min(0).max(2).optional(),
    message: z.string().min(1),
    line: z.number().int().min(1),
    column: z.number().int().min(1).optional(),
  })
  .passthrough();

const EslintFileSchema = z
  .object({
    filePath: z.string().min(1),
    messages: z.array(EslintMessageSchema),
  })
  .passthrough();

export function parseEslint(output: string): LintViolation[] {
  const data: unknown = parseJson(output);
  const parsed = z.array(EslintFileSchema).safeParse(data);
  if (!parsed.success) {
    throw new LintFixError(
      "invalid_lint_output",
      "ESLint JSON output is malformed.",
    );
  }
  const violations: LintViolation[] = [];
  for (const file of parsed.data) {
    for (const message of file.messages) {
      violations.push({
        file: file.filePath,
        line: message.line,
        column: message.column ?? 1,
        rule_id: message.ruleId ?? "eslint",
        severity: severityName(message.severity),
        message: message.message,
      });
    }
  }
  return violations;
}

const RuffViolationSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    filename: z.string().min(1),
    location: z.object({
      row: z.number().int().min(1),
      column: z.number().int().min(1),
    }),
  })
  .passthrough();

export function parseRuff(output: string): LintViolation[] {
  const data: unknown = parseJson(output);
  const parsed = z.array(RuffViolationSchema).safeParse(data);
  if (!parsed.success) {
    throw new LintFixError(
      "invalid_lint_output",
      "Ruff JSON output is malformed.",
    );
  }
  return parsed.data.map((violation) => ({
    file: violation.filename,
    line: violation.location.row,
    column: violation.location.column,
    rule_id: violation.code,
    severity: "error",
    message: violation.message,
  }));
}

const BiomeDiagnosticSchema = z
  .object({
    category: z.string().min(1),
    severity: z.enum(["error", "warning", "information", "info"]).optional(),
    description: z.string().optional(),
    message: z.unknown().optional(),
    location: z
      .object({
        path: z.object({ file: z.string().min(1) }).optional(),
        span: z.array(z.number().int()).optional(),
        source_code: z.string().optional(),
        start: z
          .object({
            line: z.number().int().min(1),
            column: z.number().int().min(1),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const BiomeOutputSchema = z
  .object({
    diagnostics: z.array(BiomeDiagnosticSchema),
  })
  .passthrough();

export function parseBiome(output: string): LintViolation[] {
  const data: unknown = parseJson(output);
  const parsed = BiomeOutputSchema.safeParse(data);
  if (!parsed.success) {
    throw new LintFixError(
      "invalid_lint_output",
      "Biome JSON output is malformed.",
    );
  }
  const violations: LintViolation[] = [];
  for (const diagnostic of parsed.data.diagnostics) {
    const spanStart = diagnostic.location?.span?.[0];
    violations.push({
      file: diagnostic.location?.path?.file ?? "<unknown>",
      line:
        diagnostic.location?.start?.line ??
        lineFromSpan(diagnostic.location?.source_code, spanStart) ??
        1,
      column: diagnostic.location?.start?.column ?? 1,
      rule_id: diagnostic.category,
      severity: diagnostic.severity ?? "error",
      message: biomeMessageText(diagnostic),
    });
  }
  return violations;
}

function biomeMessageText(diagnostic: {
  readonly description?: string | undefined;
  readonly message?: unknown;
}): string {
  if (
    typeof diagnostic.description === "string" &&
    diagnostic.description.length > 0
  ) {
    return diagnostic.description;
  }
  if (typeof diagnostic.message === "string" && diagnostic.message.length > 0) {
    return diagnostic.message;
  }
  return "Lint violation.";
}

function lineFromSpan(
  sourceCode: string | undefined,
  spanStart: number | undefined,
): number | undefined {
  if (typeof sourceCode !== "string" || typeof spanStart !== "number") {
    return undefined;
  }
  let line = 1;
  const limit = Math.min(spanStart, sourceCode.length);
  for (let index = 0; index < limit; index += 1) {
    if (sourceCode[index] === "\n") line += 1;
  }
  return line;
}

function severityName(severity: number | undefined): string {
  if (severity === 2) return "error";
  if (severity === 1) return "warning";
  return "info";
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new LintFixError(
      "invalid_lint_output",
      "Lint output is not valid JSON.",
    );
  }
}

function malformed(): LintFixError {
  return new LintFixError(
    "invalid_lint_output",
    "Lint output format is not recognized.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTypeOutput(
  output: string,
  checker: "tsc" | "mypy" | "pyright" | "auto" = "auto",
): LintViolation[] {
  const lines = output.split("\n");
  const violations: LintViolation[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (checker === "tsc" || checker === "auto") {
      const tscMatch =
        /^([^\s:(]+)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*(?:-\s*)?error\s+(TS\d+):\s*(.+)$/u.exec(
          line,
        );
      if (tscMatch !== null) {
        const file = tscMatch[1]!;
        const lineNum = parseInt(tscMatch[2] ?? tscMatch[4] ?? "1", 10);
        const colNum = parseInt(tscMatch[3] ?? tscMatch[5] ?? "1", 10);
        const ruleId = tscMatch[6]!;
        const msg = tscMatch[7]!;
        violations.push({
          file,
          line: lineNum,
          column: colNum,
          rule_id: ruleId,
          severity: "error",
          message: msg,
        });
        continue;
      }
    }

    if (checker === "mypy" || checker === "pyright" || checker === "auto") {
      const mypyMatch =
        /^([^\s:]+):(\d+)(?::(\d+))?:\s*(error|warning):\s*(.+?)(?:\s*\[([a-z0-9_-]+)\])?$/u.exec(
          line,
        );
      if (mypyMatch !== null) {
        const file = mypyMatch[1]!;
        const lineNum = parseInt(mypyMatch[2]!, 10);
        const colNum = parseInt(mypyMatch[3] ?? "1", 10);
        const sev = mypyMatch[4]!;
        const msg = mypyMatch[5]!;
        const ruleId = mypyMatch[6] ?? "type-error";
        violations.push({
          file,
          line: lineNum,
          column: colNum,
          rule_id: ruleId,
          severity: sev,
          message: msg,
        });
        continue;
      }
    }
  }

  if (violations.length === 0) {
    throw new LintFixError(
      "invalid_lint_output",
      "No type checker errors recognized in output.",
    );
  }

  return violations;
}
