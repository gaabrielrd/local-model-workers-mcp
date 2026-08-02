<Task 025: Multi-provider engine support>
**Status:** In progress (UX increment done: interactive harness selection component in `src/features/installation/select-options.ts`, integrated into `setup`/`init`; multi-provider engine still pending)
**Depends on:** Tasks 007, 023
**PRD coverage:** New capability CAP-14

## Objective

Abstract the inference layer to support multiple local model providers beyond LM Studio, including Ollama, vLLM, and LocalAI, with automatic health-based failover.

## Requirements

- Refactor `ModelInferencePort` to support multiple provider backends behind a unified interface.
- Define a `ProviderConfig` type: `{ name: string, type: 'lm-studio' | 'ollama' | 'vllm' | 'localai', base_url: string, bearer_token?: string, allowed_models: string[], priority: number }`.
- Add a new optional `providers` array to the configuration schema. When present, replaces the single `LMW_LM_STUDIO_BASE_URL` provider.
- When `providers` is absent, maintain backward compatibility with the existing single-provider environment variables.
- Implement provider adapters:
  - **LM Studio** (existing): `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`.
  - **Ollama**: `/api/chat` (structured output via `format: 'json'`), `/api/embed`, `/api/tags`.
  - **vLLM**: `/v1/chat/completions` (OpenAI-compatible), `/v1/models`.
  - **LocalAI**: `/v1/chat/completions` (OpenAI-compatible), `/v1/models`.
- Implement health-based failover:
  - On startup, health-check all configured providers.
  - Route requests to the highest-priority healthy provider that has the requested model.
  - If the primary provider fails with a transient error after retry exhaustion, failover to the next healthy provider.
  - Periodically re-check failed providers (configurable interval, default 60 seconds).
- `check_health` tool reports status of all configured providers.
- `get_config` includes provider status and routing information.
- All existing features (`explore_repository`, `propose_tests`, etc.) work transparently with any provider.

## Non-scope

Cloud providers (OpenAI, Anthropic, Google), load balancing across providers for the same request, automatic provider discovery, model downloading or installation.

## Implementation outline

1. Define `ProviderAdapter` interface extending `ModelInferencePort` with provider metadata.
2. Implement Ollama adapter in `src/features/model-inference/ollama.ts`.
3. Implement vLLM adapter in `src/features/model-inference/vllm.ts`.
4. Implement LocalAI adapter in `src/features/model-inference/localai.ts`.
5. Implement `ProviderRouter` that wraps multiple adapters with health checking and failover.
6. Extend configuration schema with `providers` array.
7. Update `createMcpApplicationRuntime` to initialize the router.
8. Update `check_health` to report all provider statuses.
9. Maintain backward compatibility when `providers` is absent.

## Expected areas

- `src/features/model-inference/contracts.ts` — `ProviderAdapter` interface
- `src/features/model-inference/ollama.ts` — Ollama adapter
- `src/features/model-inference/vllm.ts` — vLLM adapter
- `src/features/model-inference/localai.ts` — LocalAI adapter
- `src/features/model-inference/router.ts` — Provider router with failover
- `src/features/configuration/configuration.ts` — Schema extension
- `src/features/health/health.ts` — Multi-provider health reporting
- `test/provider-router.test.ts` — Router and failover tests
- `test/ollama.test.ts`, `test/vllm.test.ts`, `test/localai.test.ts` — Adapter tests

## Tests

- Single LM Studio provider (backward compatibility) works identically to current behavior.
- Ollama adapter sends correct request format to `/api/chat` and parses response.
- Ollama adapter lists models via `/api/tags`.
- vLLM adapter uses OpenAI-compatible endpoints correctly.
- LocalAI adapter uses OpenAI-compatible endpoints correctly.
- Failover: primary provider returns 503, request succeeds via secondary provider.
- All providers unhealthy: returns appropriate error.
- Health check reports status of all configured providers.
- Model routing works across providers (model available on provider B but not A).
- Provider priority is respected (highest priority healthy provider is used first).
- Failed provider is re-checked after the configured interval.
- `get_config` includes provider status.
- Existing tests continue passing with default single-provider configuration.

## Risks

- Ollama's structured output support (`format: 'json'`) is less strict than LM Studio's JSON Schema mode; output validation must be strict.
- vLLM and LocalAI may have subtly different OpenAI-compatible implementations; test with real instances before release.
- Multiple providers increase configuration complexity; provide clear documentation and validation errors.

## Acceptance criteria

- All 4 provider types can list models and perform structured inference.
- Failover works transparently when the primary provider is unhealthy.
- Backward compatibility is maintained when only environment variables are configured.
- `check_health` reports status of all providers.
- Configuration validation rejects invalid provider configurations.
- `npm run validate` passes.
