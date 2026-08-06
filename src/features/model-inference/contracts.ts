import type { z } from "zod";

import type { CircuitState } from "./circuit-breaker.js";

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
  /** Provider being served when the error was raised, when attributable. */
  public provider: string | undefined = undefined;

  public constructor(
    code: InferenceErrorCode,
    message: string,
    retryable = false,
    provider?: string,
  ) {
    super(message);
    this.name = "InferenceError";
    this.code = code;
    this.retryable = retryable;
    this.provider = provider;
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
  /** Provider that served the request, when attributable. */
  readonly provider?: string;
  /** Retry attempts performed before this result, when attributable. */
  readonly retries?: number;
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

export const PROVIDER_TYPES = [
  "lm-studio",
  "ollama",
  "vllm",
  "localai",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderConfig {
  readonly name: string;
  readonly type: ProviderType;
  readonly base_url: string;
  readonly bearer_token?: string;
  readonly allowed_models: readonly string[];
  readonly priority: number;
  /**
   * Require TLS certificate validation for this provider. Unset means the
   * default for the host: on for remote, off for loopback.
   */
  readonly tls_verify?: boolean;
}

export interface ProviderMetadata extends Omit<ProviderConfig, "bearer_token"> {
  readonly token_configured: boolean;
}

export interface ProviderAdapter extends ModelInferencePort {
  readonly provider: ProviderMetadata;
}

export interface ProviderStatus {
  readonly name: string;
  readonly type: ProviderType;
  readonly priority: number;
  readonly status: "healthy" | "unhealthy" | "unknown";
  readonly circuit_state: CircuitState;
  readonly models: readonly string[];
  readonly last_checked_at: string | null;
  readonly error_code?: InferenceErrorCode;
}

export interface ProviderRouterPort extends ModelInferencePort {
  refreshHealth(options: RequestOptions): Promise<readonly ProviderStatus[]>;
  getProviderStatus(): readonly ProviderStatus[];
  routeForModel(model: string): ProviderStatus | null;
}
