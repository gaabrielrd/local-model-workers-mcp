import { z } from "zod";

export const TERMINAL_STATUSES = Object.freeze([
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "timed_out",
] as const);

export const TerminalStatusSchema = z.enum(TERMINAL_STATUSES);
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

export const NON_COMPLETED_STATUSES = Object.freeze([
  "blocked",
  "failed",
  "cancelled",
  "timed_out",
] as const);

export const NonCompletedStatusSchema = z.enum(NON_COMPLETED_STATUSES);
export type NonCompletedStatus = z.infer<typeof NonCompletedStatusSchema>;

export const PROGRESS_STAGES = Object.freeze([
  "queued",
  "exploring",
  "consulting_model",
  "preparing_result",
] as const);

export const ProgressStageSchema = z.enum(PROGRESS_STAGES);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

export const ERROR_CODES = Object.freeze([
  "invalid_request",
  "invalid_configuration",
  "repository_not_found",
  "repository_access_denied",
  "invalid_evidence",
  "model_unauthorized",
  "model_unavailable",
  "inference_failed",
  "context_limit_exceeded",
  "interaction_limit_exceeded",
  "patch_not_allowed",
  "patch_limit_exceeded",
  "configuration_conflict",
  "confirmation_required",
  "task_cancelled",
  "queue_timeout",
  "processing_timeout",
  "internal_error",
] as const);

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const RequestLanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);

export type RequestLanguage = z.infer<typeof RequestLanguageSchema>;

export const LocalizedTextSchema = z
  .object({
    language: RequestLanguageSchema,
    text: z.string().trim().min(1),
  })
  .strict();

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const EvidenceSchema = z
  .object({
    path: z.string().trim().min(1),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    explanation: LocalizedTextSchema,
  })
  .strict()
  .refine((evidence) => evidence.end_line >= evidence.start_line, {
    message: "end_line must be greater than or equal to start_line",
    path: ["end_line"],
  });

export type Evidence = z.infer<typeof EvidenceSchema>;

export const LimitationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*$/u),
    description: LocalizedTextSchema,
    impact: LocalizedTextSchema,
    affected_paths: z.array(z.string().trim().min(1)),
  })
  .strict();

export type Limitation = z.infer<typeof LimitationSchema>;

export const DiagnosticIssueSchema = z
  .object({
    field: z
      .string()
      .trim()
      .max(128)
      .regex(/^[a-z][a-z0-9_.]*$/u)
      .optional(),
    message: LocalizedTextSchema,
  })
  .strict();

export type DiagnosticIssue = z.infer<typeof DiagnosticIssueSchema>;

export const DiagnosticSchema = z
  .object({
    code: ErrorCodeSchema,
    message: LocalizedTextSchema,
    issues: z.array(DiagnosticIssueSchema),
    redaction_count: z.number().int().nonnegative(),
  })
  .strict();

export type Diagnostic = z.infer<typeof DiagnosticSchema>;

const taskIdentityFields = {
  task_id: z.string().trim().min(1).max(256),
  model: z.string().trim().min(1).max(256),
  config_revision: z.string().trim().min(1).max(256),
} as const;

export interface CompletedTaskResponse<Result> {
  task_id: string;
  status: "completed";
  model: string;
  config_revision: string;
  result: Result;
  evidence: Evidence[];
  limitations: Limitation[];
}

export interface DiagnosticTaskResponse {
  task_id: string;
  status: NonCompletedStatus;
  model: string;
  config_revision: string;
  diagnostic: Diagnostic;
  evidence: Evidence[];
  limitations: Limitation[];
}

export type TaskResponse<Result> =
  CompletedTaskResponse<Result> | DiagnosticTaskResponse;

export function completedTaskResponseSchema<Result>(
  resultSchema: z.ZodType<Result>,
) {
  return z
    .object({
      ...taskIdentityFields,
      status: z.literal("completed"),
      result: resultSchema,
      evidence: z.array(EvidenceSchema),
      limitations: z.array(LimitationSchema),
    })
    .strict();
}

export const DiagnosticTaskResponseSchema = z
  .object({
    ...taskIdentityFields,
    status: NonCompletedStatusSchema,
    diagnostic: DiagnosticSchema,
    evidence: z.array(EvidenceSchema),
    limitations: z.array(LimitationSchema),
  })
  .strict();

export function createCompletedTaskResponse<Result>(
  resultSchema: z.ZodType<Result>,
  input: unknown,
): CompletedTaskResponse<Result> {
  return completedTaskResponseSchema(resultSchema).parse(input);
}

export function createDiagnosticTaskResponse(
  input: unknown,
): DiagnosticTaskResponse {
  return DiagnosticTaskResponseSchema.parse(input);
}
