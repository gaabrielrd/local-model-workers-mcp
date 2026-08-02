# ADR-0008: Use LM Studio's OpenAI-compatible JSON Schema API

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-03, RF-19, RF-21; RN-02 through RN-04; CA-03 through CA-05, CA-28, CA-29, CA-31, CA-32

## Context

LM Studio exposes both a native REST API and OpenAI-compatible endpoints. The
application needs model discovery with optional authentication, strict
structured results, bounded retries, cancellation, and model identity
enforcement. Native chat has
useful stateful behavior, but the approved V1 does not need server-side chat
state and benefits more from the compatible endpoint's JSON Schema contract.

Controlled probes against the developer's available Qwen3.5 9B and Gemma 4 12B
QAT models confirmed structured JSON Schema, tool calling, and vision. The
Nomic model produced 768-dimensional embeddings. Both LLMs spent a tiny output
budget on reasoning when reasoning remained enabled, while structured output
completed when it was disabled.

The same environment accepted a deliberately invalid Bearer token. Reachability
therefore cannot be treated as proof that authentication is enforced.

## Decision

Support LM Studio 0.4.0 or later and use `GET /v1/models` plus non-streaming
`POST /v1/chat/completions`. When a token is configured, send Bearer
authentication only in the `Authorization` header; otherwise omit the header.
Use strict `response_format: json_schema`, disable
reasoning for structured operations, and validate the decoded result again
against the caller's local Zod schema.

Perform an allowlist and model-catalog preflight before inference, then verify
that the completed response names the requested model. Reject partial,
malformed, schema-invalid, model-mismatched, and responses above 1 MiB.

Keep cancellation and a monotonic caller deadline active through body parsing.
Retry only transient inference failures, once by default. Treat HTTP 408, 429,
500, 502, 503, and 504 plus network failures as transient. Do not retry
authentication, authorization, unavailable-model, invalid-output, partial, or
oversized-response failures.

Health reports unauthenticated mode as healthy `not_configured` after a
successful catalog request. When a token is configured, health also calls
`/models` with a fixed invalid credential; accepting it is
`authentication_not_enforced` and makes health unhealthy. Health accepts no
repository input or repository adapter.

## Consequences

### Positive

- Structured inference uses a contract passed by both available LLMs and is
  validated independently of model compliance.
- The server cannot silently substitute an unauthorized or different model.
- Default reasoning cannot unexpectedly consume structured-output budgets.
- Authentication mode is explicit and compatible with both `lms` and
  token-enabled LM Studio deployments.
- Non-streaming responses cannot expose partial model output as completed.

### Negative

- Every inference performs a catalog preflight before generation.
- Health performs an additional deliberately invalid authentication request
  only when a token is configured.
- Reasoning is unavailable for structured calls until a future use case defines
  an explicit budget and output policy for it.
- LM Studio releases before 0.4.0 and APIs that omit OpenAI-compatible JSON
  Schema are unsupported.

## Alternatives considered

### Use the native `/api/v1/chat` endpoint

Rejected for V1 because stateful chat is unnecessary and the compatible API
already provides the required structured-output contract.

### Use tool calling as the result transport

Rejected because tool capability was observed but JSON Schema maps directly to
the application's result schemas without granting or simulating remote tools.

### Consider HTTP 200 sufficient authentication evidence

Rejected because the controlled instance returned 200 for an invalid token
when authentication was disabled.
