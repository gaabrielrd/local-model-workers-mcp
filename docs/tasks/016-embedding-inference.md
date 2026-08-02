<Task 016: Embedding inference adapter>
**Status:** Completed
**Depends on:** Tasks 007
**PRD coverage:** New capability CAP-07 prerequisite

## Objective

Extend the LM Studio client (`ModelInferencePort` in `src/features/model-inference/contracts.ts`) with an `embedText` method that sends requests to the OpenAI-compatible `/v1/embeddings` endpoint. The current client only supports `listModels`, `isAuthenticationEnforced`, and `inferStructured` — there is NO embedding support yet.

## Requirements

- Add `embedText(request: EmbeddingRequest): Promise<EmbeddingResult>` to `ModelInferencePort`.
- `EmbeddingRequest` contains: `model: string`, `input: string | string[]`, `timeout_ms: number`, `signal?: AbortSignal`.
- `EmbeddingResult` contains: `model: string`, `embeddings: readonly number[][]`, `usage: { prompt_tokens: number, total_tokens: number }`.
- Validate model against `allowedModels` before sending (same policy as `inferStructured`).
- Send `POST /v1/embeddings` with JSON body `{ model, input }` and parse the OpenAI-compatible response schema.
- Support batch input (array of strings) returning one embedding vector per input string.
- Enforce the same `maxResponseBytes` limit, timeout, cancellation, and authentication logic as existing inference methods.
- Retry transient failures with the same bounded retry policy (1 retry for 408/429/500/502/503/504).
- Return `InferenceError` with appropriate error codes for model unauthorized, unavailable, timeout, malformed response.
- Never send repository content; embedding input is provided by the caller.

## Non-scope

Vector storage, similarity search, indexing, AST parsing, or MCP tool exposure.

## Implementation outline

1. Add `EmbeddingRequest`, `EmbeddingResult`, and `EmbeddingUsage` types to `contracts.ts`.
2. Add `embedText` method signature to `ModelInferencePort`.
3. Define `EmbeddingResponseSchema` (Zod) for the OpenAI `/v1/embeddings` response format in `lm-studio.ts`.
4. Implement `embedText` in `createLmStudioClient` reusing existing `requestJson`, authentication, retry, and timeout infrastructure.
5. Validate model against `allowedModels` and check availability via `listModels` before sending.
6. Add unit tests with fake HTTP server.

## Expected areas

- `src/features/model-inference/contracts.ts` — New types and method signature
- `src/features/model-inference/lm-studio.ts` — Implementation
- `test/lm-studio.test.ts` — Embedding-specific test scenarios

## Tests

- Single string input returns one embedding vector with expected dimensions.
- Batch input (array of 3 strings) returns 3 embedding vectors.
- Unauthorized model returns `model_unauthorized` error.
- Unavailable model (not in catalog) returns `model_unavailable` error.
- Malformed response (missing `data` array) returns `malformed_response`.
- Transient 503 retries once and succeeds on second attempt.
- Timeout aborts the HTTP request and returns `inference_timeout`.
- Cancellation via AbortSignal propagates and returns `inference_cancelled`.
- Response exceeding `maxResponseBytes` is rejected.
- Bearer token is sent when configured; omitted when not configured.

## Risks

- LM Studio embedding response format may vary between model types (GGUF vs safetensors); pin the schema strictly.
- Large batch inputs may exceed LM Studio's context window; caller is responsible for chunking.

## Acceptance criteria

- `embedText` returns dimensionally consistent vectors for supported embedding models.
- All error paths match the existing `InferenceError` taxonomy.
- Existing `inferStructured`, `listModels`, and `isAuthenticationEnforced` tests continue passing.
- `npm run validate` passes.
