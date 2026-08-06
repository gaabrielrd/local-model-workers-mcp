import { z } from "zod";

export const LINT_FIX_MAX_FILES = 20;
export const LINT_FIX_DEFAULT_MAX_FILES = 10;
export const LINT_FIX_MAX_CHANGED_LINES = 500;
export const LINT_FIX_CONTEXT_RADIUS = 5;
export const LINT_FIX_MAX_INPUT_BYTES = 2 * 1_024 * 1_024;
export const LINT_FIX_MAX_SOURCE_LINES_PER_FILE = 600;

export const LINTER_NAMES = Object.freeze(["eslint", "biome", "ruff"] as const);
export type LinterName = (typeof LINTER_NAMES)[number];

export const FixLintViolationsInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    lint_output: z.string().min(1).max(LINT_FIX_MAX_INPUT_BYTES),
    linter: z.enum(["eslint", "biome", "ruff", "auto"]).default("auto"),
    /**
     * Re-run the linter against the patched sandbox copy and report what is
     * left. Off by default: verification costs a real tool run.
     */
    verify: z.boolean().default(false),
    verify_command: z.string().trim().min(1).max(1_000).optional(),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(LINT_FIX_MAX_FILES)
      .default(LINT_FIX_DEFAULT_MAX_FILES),
  })
  .strict();

export type FixLintViolationsInput = z.infer<
  typeof FixLintViolationsInputSchema
>;

export const FixTypeErrorsInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    type_output: z.string().min(1).max(LINT_FIX_MAX_INPUT_BYTES),
    checker: z.enum(["tsc", "mypy", "pyright", "auto"]).default("auto"),
    /**
     * Re-run the type checker against the patched sandbox copy and report what
     * is left. Off by default: verification costs a real tool run.
     */
    verify: z.boolean().default(false),
    verify_command: z.string().trim().min(1).max(1_000).optional(),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(LINT_FIX_MAX_FILES)
      .default(LINT_FIX_DEFAULT_MAX_FILES),
  })
  .strict();

export type FixTypeErrorsInput = z.infer<typeof FixTypeErrorsInputSchema>;

export interface LintViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly rule_id: string;
  readonly severity: string;
  readonly message: string;
}

export const FixedViolationSchema = z
  .object({
    file: z.string().trim().min(1).max(4_096),
    line: z.number().int().min(1).max(10_000_000),
    rule_id: z.string().trim().min(1).max(512),
  })
  .strict();

export const UnfixedViolationSchema = z
  .object({
    file: z.string().trim().min(1).max(4_096),
    line: z.number().int().min(1).max(10_000_000),
    rule_id: z.string().trim().min(1).max(512),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const FixVerificationSchema = z
  .object({
    status: z.enum(["verified", "not_fixed", "unavailable", "apply_failed"]),
    violations_before: z.number().int().nonnegative().max(100_000),
    violations_after: z.number().int().nonnegative().max(100_000).optional(),
    command: z.string().max(1_000).optional(),
    reason: z.string().max(4_000).optional(),
  })
  .strict();

export const FixLintViolationsResultSchema = z
  .object({
    patch: z.string().max(2 * 1_024 * 1_024),
    fixed_violations: z.array(FixedViolationSchema).max(500),
    unfixed_violations: z.array(UnfixedViolationSchema).max(500),
    summary: z.string().trim().min(1).max(8_000),
    /** Additive: absent when verification did not run. */
    verification: FixVerificationSchema.optional(),
  })
  .strict();

export type FixedViolation = z.infer<typeof FixedViolationSchema>;
export type UnfixedViolation = z.infer<typeof UnfixedViolationSchema>;
export type FixLintViolationsResult = z.infer<
  typeof FixLintViolationsResultSchema
>;

export type LintFixErrorCode =
  | "invalid_request"
  | "invalid_lint_output"
  | "no_fixable_files"
  | "invalid_evidence";

export class LintFixError extends Error {
  public readonly code: LintFixErrorCode;

  public constructor(code: LintFixErrorCode, message: string) {
    super(message);
    this.name = "LintFixError";
    this.code = code;
  }
}
