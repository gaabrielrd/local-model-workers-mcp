import { z } from "zod";

import {
  InferenceError,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ModelCatalog,
  type ProviderAdapter,
  type ProviderConfig,
  type RequestOptions,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from "./contracts.js";
import { transportError } from "./transport-security.js";

const DEFAULT_MAX_RESPONSE_BYTES = 1_024 * 1_024;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const INVALID_PROBE_TOKEN = "local-model-workers-invalid-health-probe";

const TagsSchema = z
  .object({
    models: z.array(
      z
        .object({
          name: z.string().trim().min(1).max(256),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ChatSchema = z
  .object({
    model: z.string().trim().min(1),
    message: z.object({ content: z.string() }).passthrough(),
    done: z.literal(true),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
    eval_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const EmbedSchema = z
  .object({
    model: z.string().trim().min(1).optional(),
    embeddings: z.array(z.array(z.number()).min(1)).min(1),
    prompt_eval_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export interface OllamaAdapterOptions {
  readonly configuration: ProviderConfig;
  readonly retryCount?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly workspaceLabel?: string;
}

interface ValidatedOptions {
  readonly configuration: ProviderConfig;
  readonly baseUrl: URL;
  readonly allowedModels: ReadonlySet<string>;
  readonly retryCount: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof globalThis.fetch;
  readonly workspaceLabel?: string;
}

interface RequestContext {
  readonly deadline: number;
  readonly callerSignal?: AbortSignal;
}

export function createOllamaAdapter(
  options: OllamaAdapterOptions,
): ProviderAdapter {
  const validated = validateOptions(options);
  const token = validated.configuration.bearer_token?.trim();
  return {
    provider: Object.freeze({
      name: validated.configuration.name,
      type: "ollama",
      base_url: validated.configuration.base_url,
      allowed_models: Object.freeze([
        ...validated.configuration.allowed_models,
      ]),
      priority: validated.configuration.priority,
      token_configured: token !== undefined && token.length > 0,
    }),
    listModels: (requestOptions) => listModels(validated, requestOptions),
    isAuthenticationEnforced: (requestOptions) =>
      isAuthenticationEnforced(validated, requestOptions, token),
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) =>
      inferStructured(validated, request),
    embedText: (request) => embedText(validated, request),
  };
}

async function isAuthenticationEnforced(
  options: ValidatedOptions,
  requestOptions: RequestOptions,
  configuredToken: string | undefined,
): Promise<boolean> {
  if (configuredToken === undefined) return false;
  const invalidToken =
    configuredToken === INVALID_PROBE_TOKEN
      ? `${INVALID_PROBE_TOKEN}-different`
      : INVALID_PROBE_TOKEN;
  try {
    await requestJson(
      options,
      endpoint(options.baseUrl, "api/tags"),
      { method: "GET" },
      requestContext(requestOptions),
      invalidToken,
    );
    return false;
  } catch (error: unknown) {
    if (
      error instanceof InferenceError &&
      error.code === "authentication_failed"
    ) {
      return true;
    }
    throw error;
  }
}

function validateOptions(options: OllamaAdapterOptions): ValidatedOptions {
  const { configuration } = options;
  if (configuration.type !== "ollama") {
    throw invalidConfiguration(
      "The Ollama adapter requires an Ollama provider.",
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuration.base_url);
  } catch {
    throw invalidConfiguration("The Ollama base URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0 ||
    configuration.name.trim().length === 0 ||
    configuration.allowed_models.length === 0 ||
    !Number.isInteger(configuration.priority)
  ) {
    throw invalidConfiguration("The Ollama provider configuration is invalid.");
  }
  const retryCount = options.retryCount ?? 1;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 1) {
    throw invalidConfiguration("Inference retry count must be zero or one.");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw invalidConfiguration("The response byte limit must be positive.");
  }
  return {
    configuration,
    baseUrl,
    allowedModels: new Set(configuration.allowed_models),
    retryCount,
    maxResponseBytes,
    fetch: options.fetch ?? globalThis.fetch,
    ...(options.workspaceLabel === undefined ||
    options.workspaceLabel.trim().length === 0
      ? {}
      : { workspaceLabel: options.workspaceLabel.trim() }),
  };
}

async function listModels(
  options: ValidatedOptions,
  requestOptions: RequestOptions,
): Promise<ModelCatalog> {
  const { value: payload } = await withRetry(
    options,
    requestContext(requestOptions),
    (context) =>
      requestJson(
        options,
        endpoint(options.baseUrl, "api/tags"),
        { method: "GET" },
        context,
      ),
  );
  const parsed = TagsSchema.safeParse(payload);
  if (!parsed.success) {
    throw malformedResponse("Ollama returned a malformed model catalog.");
  }
  return {
    models: [...new Set(parsed.data.models.map((model) => model.name))].sort(),
  };
}

async function inferStructured<Output>(
  options: ValidatedOptions,
  request: StructuredInferenceRequest<Output>,
): Promise<StructuredInferenceResult<Output>> {
  validateModel(options, request.model);
  if (
    request.messages.length === 0 ||
    request.messages.some((message) => message.content.length === 0) ||
    !Number.isInteger(request.max_tokens) ||
    request.max_tokens < 1
  ) {
    throw invalidConfiguration("The structured inference request is invalid.");
  }
  const context = requestContext(request);
  await requireAvailableModel(options, request.model, context);
  const { value: payload, retries } = await withRetry(
    options,
    context,
    (activeContext) =>
      requestJson(
        options,
        endpoint(options.baseUrl, "api/chat"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: false,
            format: z.toJSONSchema(request.output_schema),
            options: { temperature: 0, num_predict: request.max_tokens },
          }),
        },
        activeContext,
      ),
  );
  const parsed = ChatSchema.safeParse(payload);
  if (!parsed.success || parsed.data.model !== request.model) {
    throw malformedResponse("Ollama returned a malformed inference response.");
  }
  if (
    parsed.data.done_reason !== undefined &&
    parsed.data.done_reason !== "stop"
  ) {
    throw new InferenceError(
      "incomplete_response",
      "Ollama did not return a complete structured response.",
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(parsed.data.message.content) as unknown;
  } catch {
    throw malformedResponse("Ollama returned invalid structured JSON.");
  }
  const validatedOutput = request.output_schema.safeParse(output);
  if (!validatedOutput.success) {
    throw malformedResponse(
      "Ollama returned output that does not match the required schema.",
    );
  }
  const promptTokens = parsed.data.prompt_eval_count ?? 0;
  const completionTokens = parsed.data.eval_count ?? 0;
  return {
    model: parsed.data.model,
    output: validatedOutput.data,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      reasoning_tokens: 0,
    },
    retries,
  };
}

async function embedText(
  options: ValidatedOptions,
  request: EmbeddingRequest,
): Promise<EmbeddingResult> {
  validateModel(options, request.model);
  const input =
    typeof request.input === "string" ? [request.input] : [...request.input];
  if (input.length === 0 || input.some((text) => text.length === 0)) {
    throw invalidConfiguration(
      "The embedding input must contain non-empty text.",
    );
  }
  const context = requestContext(request);
  await requireAvailableModel(options, request.model, context);
  const { value: payload } = await withRetry(
    options,
    context,
    (activeContext) =>
      requestJson(
        options,
        endpoint(options.baseUrl, "api/embed"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: request.model, input }),
        },
        activeContext,
      ),
  );
  const parsed = EmbedSchema.safeParse(payload);
  if (
    !parsed.success ||
    (parsed.data.model !== undefined && parsed.data.model !== request.model) ||
    parsed.data.embeddings.length !== input.length
  ) {
    throw malformedResponse("Ollama returned a malformed embedding response.");
  }
  const promptTokens = parsed.data.prompt_eval_count ?? 0;
  return {
    model: request.model,
    embeddings: parsed.data.embeddings,
    usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
  };
}

async function requireAvailableModel(
  options: ValidatedOptions,
  model: string,
  context: RequestContext,
): Promise<void> {
  const catalog = await listModels(options, {
    timeout_ms: remainingTime(context),
    ...(context.callerSignal === undefined
      ? {}
      : { signal: context.callerSignal }),
  });
  if (!catalog.models.includes(model)) {
    throw new InferenceError(
      "model_unavailable",
      "The requested model is unavailable in Ollama.",
    );
  }
}

function validateModel(options: ValidatedOptions, model: string): void {
  if (
    model.trim().length === 0 ||
    (!options.allowedModels.has("*") && !options.allowedModels.has(model))
  ) {
    throw new InferenceError(
      "model_unauthorized",
      "The requested model is not allowed by provider policy.",
    );
  }
}

async function withRetry<T>(
  options: ValidatedOptions,
  context: RequestContext,
  operation: (context: RequestContext) => Promise<T>,
): Promise<{ value: T; retries: number }> {
  let lastError: InferenceError | undefined;
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    try {
      return { value: await operation(context), retries: attempt };
    } catch (error: unknown) {
      if (!(error instanceof InferenceError) || !error.retryable) throw error;
      lastError = error;
    }
  }
  throw (
    lastError ??
    new InferenceError("inference_failed", "Ollama request failed.")
  );
}

async function requestJson(
  options: ValidatedOptions,
  url: URL,
  init: RequestInit,
  context: RequestContext,
  bearerToken = options.configuration.bearer_token,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(remainingTime(context));
  const signal =
    context.callerSignal === undefined
      ? timeout
      : AbortSignal.any([context.callerSignal, timeout]);
  let response: Response;
  try {
    response = await options.fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        ...(bearerToken === undefined
          ? {}
          : { authorization: `Bearer ${bearerToken}` }),
        ...(options.workspaceLabel === undefined
          ? {}
          : { "X-Workspace-Label": options.workspaceLabel }),
      },
      signal,
    });
  } catch (error: unknown) {
    if (context.callerSignal?.aborted === true) {
      throw new InferenceError(
        "inference_cancelled",
        "The Ollama request was cancelled.",
      );
    }
    if (Date.now() >= context.deadline || timeout.aborted) {
      throw new InferenceError(
        "inference_timeout",
        "The Ollama request timed out.",
      );
    }
    throw transportError(error, "The Ollama endpoint could not be reached.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new InferenceError(
      "authentication_failed",
      "Ollama rejected authentication.",
    );
  }
  if (TRANSIENT_STATUS_CODES.has(response.status)) {
    throw new InferenceError(
      "transient_failure",
      "Ollama returned a transient failure.",
      true,
    );
  }
  if (response.status === 404) {
    throw new InferenceError(
      "model_unavailable",
      "The Ollama resource is unavailable.",
    );
  }
  if (!response.ok) {
    throw new InferenceError(
      "inference_failed",
      "Ollama rejected the request.",
    );
  }
  try {
    return await parseJsonResponse(response, options.maxResponseBytes);
  } catch (error: unknown) {
    if (error instanceof InferenceError) throw error;
    if (context.callerSignal?.aborted === true) {
      throw new InferenceError(
        "inference_cancelled",
        "The Ollama request was cancelled.",
      );
    }
    if (Date.now() >= context.deadline || timeout.aborted) {
      throw new InferenceError(
        "inference_timeout",
        "The Ollama request timed out.",
      );
    }
    throw transportError(error, "The Ollama response stream failed.");
  }
}

async function parseJsonResponse(
  response: Response,
  maximum: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.parseInt(declaredLength, 10) > maximum
  ) {
    throw responseTooLarge();
  }
  if (response.body === null) {
    throw malformedResponse("Ollama returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const untrustedResult: unknown = await reader.read();
      if (!isByteReadResult(untrustedResult)) {
        throw malformedResponse("Ollama returned an invalid response body.");
      }
      const result = untrustedResult;
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximum) {
        await reader.cancel();
        throw responseTooLarge();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw malformedResponse("Ollama returned malformed JSON.");
  }
}

function isByteReadResult(
  value: unknown,
): value is
  | { readonly done: true; readonly value?: undefined }
  | { readonly done: false; readonly value: Uint8Array } {
  if (typeof value !== "object" || value === null || !("done" in value)) {
    return false;
  }
  if (value.done === true) return true;
  return (
    value.done === false &&
    "value" in value &&
    value.value instanceof Uint8Array
  );
}

function responseTooLarge(): InferenceError {
  return new InferenceError(
    "response_too_large",
    "The Ollama response is too large.",
  );
}

function requestContext(options: RequestOptions): RequestContext {
  if (!Number.isInteger(options.timeout_ms) || options.timeout_ms < 1) {
    throw invalidConfiguration("The request timeout must be positive.");
  }
  return {
    deadline: Date.now() + options.timeout_ms,
    ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
  };
}

function remainingTime(context: RequestContext): number {
  return Math.max(1, context.deadline - Date.now());
}

function endpoint(baseUrl: URL, path: string): URL {
  const normalized = new URL(baseUrl);
  normalized.pathname = `${normalized.pathname.replace(/\/$/u, "")}/${path}`;
  return normalized;
}

function invalidConfiguration(message: string): InferenceError {
  return new InferenceError("invalid_configuration", message);
}

function malformedResponse(message: string): InferenceError {
  return new InferenceError("malformed_response", message);
}
