import type { z } from "zod";

export const INFERENCE_ERROR_CODES = Object.freeze([
  "invalid_configuration",
  "endpoint_unreachable",
  "authentication_failed",
  "authentication_not_enforced",
  "model_unauthorized",
  "model_unavailable",
  "inference_cancelled",
  "inference_timeout",
  "transient_failure",
  "inference_failed",
  "malformed_response",
  "response_too_large",
  "incomplete_response",
] as const);

export type InferenceErrorCode = (typeof INFERENCE_ERROR_CODES)[number];

export class InferenceError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly retryable: boolean;

  public constructor(
    code: InferenceErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "InferenceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface InferenceMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface StructuredInferenceRequest<Output> {
  readonly model: string;
  readonly messages: readonly InferenceMessage[];
  readonly output_name: string;
  readonly output_schema: z.ZodType<Output>;
  readonly max_tokens: number;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
}

export interface InferenceUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly reasoning_tokens: number;
}

export interface StructuredInferenceResult<Output> {
  readonly model: string;
  readonly output: Output;
  readonly usage: InferenceUsage;
}

export interface ModelCatalog {
  readonly models: readonly string[];
}

export interface EmbeddingRequest {
  readonly model: string;
  readonly input: string | readonly string[];
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
}

export interface EmbeddingUsage {
  readonly prompt_tokens: number;
  readonly total_tokens: number;
}

export interface EmbeddingResult {
  readonly model: string;
  readonly embeddings: readonly (readonly number[])[];
  readonly usage: EmbeddingUsage;
}

export interface RequestOptions {
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
}

export interface ModelInferencePort {
  listModels(options: RequestOptions): Promise<ModelCatalog>;
  isAuthenticationEnforced(options: RequestOptions): Promise<boolean>;
  inferStructured<Output>(
    request: StructuredInferenceRequest<Output>,
  ): Promise<StructuredInferenceResult<Output>>;
  embedText(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
