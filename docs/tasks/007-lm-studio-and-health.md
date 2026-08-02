# Task 007: Integrate LM Studio and implement health diagnostics

**Status:** Pending  
**Depends on:** Tasks 002-003  
**PRD coverage:** RF-03, RF-19, RF-21; RN-02 through RN-04; CA-03 through CA-05, CA-28, CA-29, CA-31, CA-32

## Objective

Implement an authenticated, cancelable LM Studio adapter and a repository-free
health use case that validates configuration, connectivity, authentication, and
model availability.

## Requirements

- Confirm and pin the supported LM Studio API contract from authoritative
  documentation and a controlled compatibility test.
- Send Bearer authentication without exposing it in URLs, errors, diagnostics,
  or logs.
- Permit only configured model identifiers and never substitute silently.
- Distinguish invalid configuration, unreachable endpoint, authentication
  failure, missing default model, unavailable allowed model, timeout, malformed
  response, and transient failure.
- Perform one retry by default only for classified transient inference failures.
- Honor cancellation and caller deadlines through the HTTP stack.
- `check_health` must not accept or inspect a repository root.
- Return status for configuration, reachability, authentication, default model,
  and each allowed model.

## Assumptions to resolve

Select endpoint paths, API version, streaming versus non-streaming behavior,
structured-output protocol, timeout ownership, retryable error classes, and
compatible LM Studio versions. Record them in integration documentation and an
ADR if they constrain more than this adapter.

## Non-scope

No repository context, exploration loop, test patch, MCP registration, or real
network dependency in the default suite.

## Implementation outline

1. Define a transport-neutral inference port.
2. Implement the HTTP adapter with authentication, cancellation, deadlines, and
   strict response parsing.
3. Implement allowlist and default-model validation before inference.
4. Add a retry policy with exactly bounded attempts and classified errors.
5. Implement the health use case independently of repository features.
6. Build a local fake LM Studio server for integration tests.
7. Document supported API behavior and secret-safe troubleshooting.

## Expected areas

- `src/features/model-inference`
- `src/features/health`
- HTTP adapter and fake server fixtures
- Integration documentation and compatibility ADR

## Tests

- Healthy configuration and every health failure category.
- Invalid token never appears in returned or captured diagnostics.
- Default model missing and requested model unauthorized/unavailable.
- No fallback model request is made.
- One transient failure retries once; permanent failures do not retry.
- Two transient failures return a non-completed structured error.
- Cancellation aborts the request and consumes no extra retry.
- Malformed or oversized remote responses fail closed.
- Health tests assert that repository adapters are never called.

## Risks

- LM Studio compatibility can drift across versions.
- Broad retry classification can duplicate expensive requests.
- HTTP libraries can include authorization headers in thrown errors.
- Streaming parsers can accidentally expose partial output as completed.

## Acceptance criteria

- CA-03 through CA-05, CA-28, CA-29, CA-31, and CA-32 pass.
- The supported LM Studio contract is documented and contract-tested.
- Every failure path redacts the Bearer token.
- Health requires no repository input or access.
- `npm run validate` passes.

