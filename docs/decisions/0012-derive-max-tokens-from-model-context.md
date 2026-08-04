# ADR-0012: Derive `max_tokens` from the model context window

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Each feature shipped a hard-coded per-response token cap to LM Studio. The
largest values (12,000 for lint-fix, test-proposal, docs-generation, and
auto-validate) exceed what small local models can actually emit. Two failure
paths resulted, both surfacing during processing before the server replied:

1. The model stops at its own output limit while composing a strict-JSON answer,
   LM Studio returns `finish_reason: "length"`, and the server rejects the
   response as `incomplete_response`.
2. Some LM Studio versions reject a request whose `max_tokens` exceeds the
   model's context window.

The OpenAI-compatible `GET /v1/models` catalog carries no context information,
so the client could not know the real limit per model.

## Decision

In the LM Studio provider, clamp the per-response `max_tokens` to the model's
context window before sending the chat request:

```
effectiveMaxTokens = min(featureIntent, modelContext)
```

The feature still expresses its intent through `TaskInferenceRequest.max_tokens`
(which also serves as the cap for providers that do not expose context), but the
effective value sent to LM Studio is bounded by the model's context. `modelContext`
is resolved from the LM Studio native REST catalog:

1. `GET /api/v1/models`, preferring the loaded instance's
   `loaded_instances[].config.context_length` over `max_context_length`;
2. falling back to `GET /api/v0/models` `data[].max_context_length` only when the
   v1 endpoint is unavailable (HTTP 404);
3. otherwise leaving the feature intent unchanged (best effort, never fails the
   task).

The context lookup is best-effort: malformed or transient responses are treated
as "unknown" and never fail the inference. A `finish_reason` other than `stop`
remains a hard `incomplete_response`, but the diagnostic now reports the
`finish_reason`, the requested `max_tokens`, and the completion token count so
truncation is actionable.

## Consequences

### Positive

- Requests never ask LM Studio for more output tokens than the model can produce.
- The effective cap tracks the model (and its loaded context length), not a
  per-feature constant that drifts from reality.
- Truncation reports enough detail to distinguish a genuine model limit from a
  misconfiguration.
- Ollama, vLLM, and LocalAI keep their current behavior; the change is
  self-contained in the LM Studio adapter.

### Negative

- Every structured inference adds one catalog request for context (and a second
  only when the v1 endpoint is absent).
- A feature whose intent is larger than the loaded context still fails with
  `incomplete_response` when the model genuinely runs out of room; the fix
  removes impossible requests, not finite-model limits.
- Features still carry intent caps; the adapter is now the source of truth for
  the actual limit, which can surprise a reader of the feature code.

## Alternatives considered

### Lower the hard-coded caps to a safe constant

Rejected: a constant cannot track models with different context windows and
would have to be re-derived for every model family.

### Expose context to every feature via the task context

Rejected: the task layer does not need model metadata; keeping the derivation in
the provider adapter preserves the port contract and leaves other providers
unaffected.

### Treat `finish_reason: "length"` as a successful partial result

Rejected: a length-truncated strict-JSON response is unusable by construction
and silently accepting it would propagate corrupt output.
