# Task 039: Circuit Breaker & Endpoint Resiliency Engine

**Status:** Completed  
**Depends on:** Task 025 (completed)

## Objective

Add an automated circuit breaker state machine (`Closed` → `Open` → `Half-Open` → `Closed`)
to `ProviderRouter` for local model providers, preventing repeated network timeouts
and cascading delays when a local provider endpoint experiences outages or high latency.

## Key Design Decisions

- **State Machine**: Implement `CircuitBreaker` with 3 states (`closed`, `open`, `half-open`).
- **Configurable Thresholds**: `failureThreshold` (default: 5 failures) and `cooldownMs` (default: 30,000 ms).
- **Probing (Half-Open)**: Automatically transition from `open` to `half-open` after the cooldown elapses, allowing 1 request through to test endpoint health.
- **Provider Router Integration**: Router maintains a `CircuitBreaker` per provider adapter, filtering candidate models with `breaker.allowRequest()` and recording successes and failures during request execution.

## Acceptance Criteria

- [x] `CircuitBreaker` transitions state correctly across failures, cooldowns, and successes.
- [x] `ProviderRouter` checks circuit breaker state before routing model requests.
- [x] Failures increment error counter; 5 failures trigger `open` state.
- [x] Half-open state allows trial requests and closes circuit on success.
- [x] All 348 tests pass (12 new circuit breaker unit tests + full suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/model-inference/circuit-breaker.ts` (NEW)
- `src/features/model-inference/router.ts` (MODIFIED — integrate per-provider circuit breaker)
- `src/features/model-inference/index.ts` (MODIFIED — export CircuitBreaker & types)
- `test/circuit-breaker.test.ts` (NEW — 12 unit tests)
