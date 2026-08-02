import { z } from "zod";

import { DiagnosticSchema, LimitationSchema } from "../task-execution/index.js";

export const DEFAULT_AUTO_VALIDATE_ITERATIONS = 3;
export const MAX_AUTO_VALIDATE_ITERATIONS = 5;
export const DEFAULT_TIMEOUT_PER_ITERATION_MS = 120_000;
export const MAX_TIMEOUT_PER_ITERATION_MS = 300_000;
export const SANDBOX_CAPTURE_LIMIT_BYTES = 64 * 1_024;

export const AutoValidateInputSchema = z
  .object({
    repository_root: z.string().trim().min(1).max(4_096),
    goal: z.string().trim().min(1).max(4_000),
    max_iterations: z
      .number()
      .int()
      .min(1)
      .max(MAX_AUTO_VALIDATE_ITERATIONS)
      .optional(),
    test_command: z.string().trim().max(1_000).optional(),
    timeout_per_iteration_ms: z
      .number()
      .int()
      .min(1)
      .max(MAX_TIMEOUT_PER_ITERATION_MS)
      .optional(),
  })
  .strict();

export type AutoValidateInput = z.infer<typeof AutoValidateInputSchema>;

export const AutoValidatePhaseSchema = z.enum([
  "generating",
  "applying",
  "running",
  "analyzing",
]);

export type AutoValidatePhase = z.infer<typeof AutoValidatePhaseSchema>;

export const TestRunSummarySchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  })
  .strict();

export type TestRunSummary = z.infer<typeof TestRunSummarySchema>;

export interface AutoValidateProgressEvent {
  readonly iteration: number;
  readonly status: AutoValidatePhase;
  readonly test_results?: TestRunSummary;
}

export const AutoValidateAttemptSchema = z
  .object({
    iteration: z.number().int().positive(),
    patch: z.string(),
    affected_files: z.array(z.string().trim().min(1)),
    passed: z.boolean(),
    exit_code: z.number().int().nullable(),
    timed_out: z.boolean(),
    test_results: TestRunSummarySchema,
    apply_error: z.string().max(4_000).optional(),
    stdout_truncated: z.boolean(),
    stderr_truncated: z.boolean(),
    stdout_excerpt: z.string().max(4_000),
    stderr_excerpt: z.string().max(4_000),
  })
  .strict();

export type AutoValidateAttempt = z.infer<typeof AutoValidateAttemptSchema>;

export const AutoValidateStatusSchema = z.enum([
  "validated",
  "blocked",
  "exhausted",
]);

export type AutoValidateStatus = z.infer<typeof AutoValidateStatusSchema>;

export const AutoValidateResultSchema = z
  .object({
    status: AutoValidateStatusSchema,
    test_command: z.string(),
    iteration_count: z.number().int().nonnegative(),
    max_iterations: z.number().int().positive(),
    attempts: z.array(AutoValidateAttemptSchema),
    patch: z.string(),
    test_results: TestRunSummarySchema.optional(),
    diagnostics: z.array(DiagnosticSchema),
    limitations: z.array(LimitationSchema),
  })
  .strict();

export type AutoValidateResult = z.infer<typeof AutoValidateResultSchema>;
