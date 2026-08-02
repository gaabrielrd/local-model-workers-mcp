import { z } from "zod";

import {
  InferenceError,
  type EmbeddingRequest,
  type EmbeddingResult,
  type InferenceUsage,
  type ModelCatalog,
  type ModelInferencePort,
  type RequestOptions,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from "./contracts.js";

const DEFAULT_MAX_RESPONSE_BYTES = 1_024 * 1_024;
const INVALID_PROBE_TOKEN = "lmw-deliberately-invalid-health-probe";
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const ModelsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(256),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const UsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ChatResponseSchema = z
  .object({
    model: z.string().trim().min(1),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable(),
            message: z
              .object({
                content: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
    usage: UsageSchema,
  })
  .passthrough();

const EmbeddingDataSchema = z
  .object({
    embedding: z.array(z.number()),
    index: z.number().int().nonnegative(),
  })
  .passthrough();

const EmbeddingUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  })
  .passthrough();

const EmbeddingResponseSchema = z
  .object({
    model: z.string().trim().min(1),
    data: z.array(EmbeddingDataSchema).min(1),
    usage: EmbeddingUsageSchema,
  })
  .passthrough();

export interface LmStudioClientOptions {
  readonly baseUrl: string;
  readonly bearerToken?: string;
  readonly allowedModels: readonly string[];
  readonly retryCount?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface RequestContext {
  readonly deadline: number;
  readonly callerSignal?: AbortSignal;
}

export function createLmStudioClient(
  options: LmStudioClientOptions,
): ModelInferencePort {
  const validated = validateOptions(options);

  return {
    listModels: (requestOptions) =>
      listModels(validated, requestOptions, validated.bearerToken),
    isAuthenticationEnforced: async (requestOptions) => {
      const invalidToken =
        validated.bearerToken === INVALID_PROBE_TOKEN
          ? `${INVALID_PROBE_TOKEN}-different`
          : INVALID_PROBE_TOKEN;
      try {
        await listModels(validated, requestOptions, invalidToken);
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
    },
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) =>
      inferStructured(validated, request),
    embedText: (request: EmbeddingRequest) => embedText(validated, request),
  };
}

interface ValidatedOptions {
  readonly baseUrl: URL;
  readonly bearerToken?: string;
  readonly allowedModels: ReadonlySet<string>;
  readonly retryCount: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof globalThis.fetch;
}

function validateOptions(options: LmStudioClientOptions): ValidatedOptions {
  let baseUrl: URL;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch {
    throw invalidConfiguration("The LM Studio base URL is invalid.");
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw invalidConfiguration(
      "The LM Studio base URL must use HTTP(S) without embedded credentials.",
    );
  }
  const bearerToken = options.bearerToken?.trim();
  if (
    options.allowedModels.length === 0 ||
    options.allowedModels.some((model) => model.trim().length === 0)
  ) {
    throw invalidConfiguration("At least one allowed model is required.");
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
    baseUrl,
    ...(bearerToken === undefined || bearerToken.length === 0
      ? {}
      : { bearerToken }),
    allowedModels: new Set(options.allowedModels),
    retryCount,
    maxResponseBytes,
    fetch: options.fetch ?? globalThis.fetch,
  };
}

async function listModels(
  options: ValidatedOptions,
  requestOptions: RequestOptions,
  token: string | undefined,
): Promise<ModelCatalog> {
  const context = requestContext(requestOptions);
  const payload = await requestJson(
    options,
    endpoint(options.baseUrl, "models"),
    { method: "GET" },
    token,
    context,
  );
  const parsed = ModelsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw malformedResponse("LM Studio returned a malformed model catalog.");
  }

  return {
    models: [...new Set(parsed.data.data.map((model) => model.id))].sort(),
  };
}

async function inferStructured<Output>(
  options: ValidatedOptions,
  requestInput: StructuredInferenceRequest<Output>,
): Promise<StructuredInferenceResult<Output>> {
  validateInferenceRequest(requestInput);
  if (!options.allowedModels.has(requestInput.model)) {
    throw new InferenceError(
      "model_unauthorized",
      "The requested model is not allowed by protected policy.",
    );
  }

  const context = requestContext(requestInput);
  const catalog = await listModels(
    options,
    {
      timeout_ms: remainingTime(context),
      ...(requestInput.signal === undefined
        ? {}
        : { signal: requestInput.signal }),
    },
    options.bearerToken,
  );
  if (!catalog.models.includes(requestInput.model)) {
    throw new InferenceError(
      "model_unavailable",
      "The requested allowed model is unavailable in LM Studio.",
    );
  }

  const payload = JSON.stringify({
    model: requestInput.model,
    messages: requestInput.messages,
    max_tokens: requestInput.max_tokens,
    temperature: 0,
    stream: false,
    reasoning_effort: "none",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: requestInput.output_name,
        strict: true,
        schema: z.toJSONSchema(requestInput.output_schema),
      },
    },
  });

  let lastTransientError: InferenceError | undefined;
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    try {
      const responsePayload = await requestJson(
        options,
        endpoint(options.baseUrl, "chat/completions"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        },
        options.bearerToken,
        context,
      );
      return parseInferenceResponse(responsePayload, requestInput);
    } catch (error: unknown) {
      if (!(error instanceof InferenceError) || !error.retryable) {
        throw error;
      }
      lastTransientError = error;
    }
  }

  throw (
    lastTransientError ??
    new InferenceError(
      "inference_failed",
      "LM Studio inference failed without a completed response.",
    )
  );
}

function validateInferenceRequest<Output>(
  requestInput: StructuredInferenceRequest<Output>,
): void {
  if (
    requestInput.model.trim().length === 0 ||
    requestInput.messages.length === 0 ||
    requestInput.messages.some((message) => message.content.length === 0) ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(requestInput.output_name) ||
    !Number.isInteger(requestInput.max_tokens) ||
    requestInput.max_tokens < 1
  ) {
    throw invalidConfiguration("The structured inference request is invalid.");
  }
  requestContext(requestInput);
}

async function embedText(
  options: ValidatedOptions,
  requestInput: EmbeddingRequest,
): Promise<EmbeddingResult> {
  if (requestInput.model.trim().length === 0) {
    throw invalidConfiguration("The embedding request model is required.");
  }
  const normalizedInput =
    typeof requestInput.input === "string"
      ? [requestInput.input]
      : [...requestInput.input];
  if (
    normalizedInput.length === 0 ||
    normalizedInput.some((text) => text.length === 0)
  ) {
    throw invalidConfiguration(
      "The embedding request input must contain at least one non-empty string.",
    );
  }

  if (!options.allowedModels.has(requestInput.model)) {
    throw new InferenceError(
      "model_unauthorized",
      "The requested model is not allowed by protected policy.",
    );
  }

  const context = requestContext(requestInput);
  const catalog = await listModels(
    options,
    {
      timeout_ms: remainingTime(context),
      ...(requestInput.signal === undefined
        ? {}
        : { signal: requestInput.signal }),
    },
    options.bearerToken,
  );
  if (!catalog.models.includes(requestInput.model)) {
    throw new InferenceError(
      "model_unavailable",
      "The requested allowed model is unavailable in LM Studio.",
    );
  }

  const payload = JSON.stringify({
    model: requestInput.model,
    input: normalizedInput,
  });

  let lastTransientError: InferenceError | undefined;
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    try {
      const responsePayload = await requestJson(
        options,
        endpoint(options.baseUrl, "embeddings"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        },
        options.bearerToken,
        context,
      );
      return parseEmbeddingResponse(responsePayload, requestInput);
    } catch (error: unknown) {
      if (!(error instanceof InferenceError) || !error.retryable) {
        throw error;
      }
      lastTransientError = error;
    }
  }

  throw (
    lastTransientError ??
    new InferenceError(
      "inference_failed",
      "LM Studio embedding failed without a completed response.",
    )
  );
}

function parseEmbeddingResponse(
  payload: unknown,
  requestInput: EmbeddingRequest,
): EmbeddingResult {
  const parsed = EmbeddingResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw malformedResponse(
      "LM Studio returned a malformed embedding response.",
    );
  }
  if (parsed.data.model !== requestInput.model) {
    throw malformedResponse(
      "LM Studio returned an embedding response for a different model.",
    );
  }

  const sorted = [...parsed.data.data].sort((a, b) => a.index - b.index);

  return {
    model: parsed.data.model,
    embeddings: sorted.map((entry) => entry.embedding),
    usage: {
      prompt_tokens: parsed.data.usage.prompt_tokens,
      total_tokens: parsed.data.usage.total_tokens,
    },
  };
}

function parseInferenceResponse<Output>(
  payload: unknown,
  requestInput: StructuredInferenceRequest<Output>,
): StructuredInferenceResult<Output> {
  const parsed = ChatResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw malformedResponse(
      "LM Studio returned a malformed inference response.",
    );
  }
  const choice = parsed.data.choices[0];
  if (parsed.data.model !== requestInput.model) {
    throw malformedResponse(
      "LM Studio returned a response for a different model.",
    );
  }
  if (choice === undefined || choice.finish_reason !== "stop") {
    throw new InferenceError(
      "incomplete_response",
      "LM Studio did not return a complete structured response.",
    );
  }

  let untrustedOutput: unknown;
  try {
    untrustedOutput = JSON.parse(choice.message.content) as unknown;
  } catch {
    throw malformedResponse("LM Studio returned invalid structured JSON.");
  }
  const output = requestInput.output_schema.safeParse(untrustedOutput);
  if (!output.success) {
    throw malformedResponse(
      "LM Studio returned output that does not match the required schema.",
    );
  }

  return {
    model: parsed.data.model,
    output: output.data,
    usage: usage(parsed.data.usage),
  };
}

function usage(parsed: z.infer<typeof UsageSchema>): InferenceUsage {
  return {
    prompt_tokens: parsed.prompt_tokens,
    completion_tokens: parsed.completion_tokens,
    total_tokens: parsed.total_tokens,
    reasoning_tokens: parsed.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

async function requestJson(
  options: ValidatedOptions,
  url: URL,
  init: RequestInit,
  token: string | undefined,
  context: RequestContext,
): Promise<unknown> {
  const requestSignal = deadlineSignal(context);
  let response: Response;
  try {
    response = await options.fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      signal: requestSignal.signal,
    });
  } catch (error: unknown) {
    requestSignal.dispose();
    if (context.callerSignal?.aborted === true) {
      throw new InferenceError(
        "inference_cancelled",
        "The LM Studio request was cancelled.",
      );
    }
    if (Date.now() >= context.deadline || requestSignal.timedOut()) {
      throw new InferenceError(
        "inference_timeout",
        "The LM Studio request exceeded its deadline.",
      );
    }
    void error;
    throw new InferenceError(
      "endpoint_unreachable",
      "The LM Studio endpoint could not be reached.",
      true,
    );
  }

  try {
    if (response.status === 401 || response.status === 403) {
      throw new InferenceError(
        "authentication_failed",
        "LM Studio rejected Bearer authentication.",
      );
    }
    if (TRANSIENT_STATUS_CODES.has(response.status)) {
      throw new InferenceError(
        "transient_failure",
        "LM Studio returned a transient failure.",
        true,
      );
    }
    if (response.status === 404) {
      throw new InferenceError(
        "model_unavailable",
        "The requested LM Studio resource or model is unavailable.",
      );
    }
    if (!response.ok) {
      throw new InferenceError(
        "inference_failed",
        "LM Studio rejected the request.",
      );
    }
    return await parseJsonResponse(response, options.maxResponseBytes);
  } catch (error: unknown) {
    if (context.callerSignal?.aborted === true) {
      throw new InferenceError(
        "inference_cancelled",
        "The LM Studio request was cancelled.",
      );
    }
    if (Date.now() >= context.deadline || requestSignal.timedOut()) {
      throw new InferenceError(
        "inference_timeout",
        "The LM Studio request exceeded its deadline.",
      );
    }
    throw error;
  } finally {
    requestSignal.dispose();
  }
}

async function parseJsonResponse(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.parseInt(declaredLength, 10) > maxResponseBytes
  ) {
    throw responseTooLarge();
  }
  if (response.body === null) {
    throw malformedResponse("LM Studio returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const untrustedResult: unknown = await reader.read();
      if (!isByteReadResult(untrustedResult)) {
        throw malformedResponse("LM Studio returned an invalid response body.");
      }
      const result = untrustedResult;
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maxResponseBytes) {
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
    throw malformedResponse("LM Studio returned malformed JSON.");
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
  if (value.done === true) {
    return true;
  }
  return (
    value.done === false &&
    "value" in value &&
    value.value instanceof Uint8Array
  );
}

function requestContext(options: RequestOptions): RequestContext {
  if (!Number.isInteger(options.timeout_ms) || options.timeout_ms < 1) {
    throw invalidConfiguration("The LM Studio timeout must be positive.");
  }
  return {
    deadline: Date.now() + options.timeout_ms,
    ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
  };
}

function remainingTime(context: RequestContext): number {
  const remaining = context.deadline - Date.now();
  if (remaining < 1) {
    throw new InferenceError(
      "inference_timeout",
      "The LM Studio request exceeded its deadline.",
    );
  }
  return remaining;
}

function deadlineSignal(context: RequestContext): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
  readonly timedOut: () => boolean;
} {
  const timeout = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    timeout.abort();
  }, remainingTime(context));
  const signal =
    context.callerSignal === undefined
      ? timeout.signal
      : AbortSignal.any([context.callerSignal, timeout.signal]);

  return {
    signal,
    dispose: () => {
      clearTimeout(timer);
    },
    timedOut: () => didTimeOut,
  };
}

function endpoint(baseUrl: URL, relativePath: string): URL {
  const normalized = new URL(baseUrl.toString());
  normalized.pathname = `${normalized.pathname.replace(/\/$/u, "")}/${relativePath}`;
  return normalized;
}

function invalidConfiguration(message: string): InferenceError {
  return new InferenceError("invalid_configuration", message);
}

function malformedResponse(message: string): InferenceError {
  return new InferenceError("malformed_response", message);
}

function responseTooLarge(): InferenceError {
  return new InferenceError(
    "response_too_large",
    "LM Studio returned a response above the configured byte limit.",
  );
}
