# Task 055: Fault-Injection Test Suite

**Status:** Implemented (v2.11.0)
**Depends on:** Task 039 (circuit breaker), Task 038 (streaming/SSE), Task 043 (daemon supervision)

## Objective

Prove the resilience machinery behaves correctly under injected faults —
not only on happy-path and unit tests. Exercise disconnects, malformed or
truncated frames, slow responses, races, and interrupted writes so regressions
are caught before they surface in production.

## Key Design Decisions

- **Transport fault injection:** an in-test HTTP proxy/responder that can
  disconnect mid-task, deliver truncated or interleaved SSE frames, return
  non-JSON bodies, exceed timeouts, and answer slowly, driven per scenario.
- **State-race injection:** forced capacity-coordinator races (duplicate
  owners, stale current-PID UUIDs, dead-lock cleanup timing) and atomic config
  writes interrupted between temp-file write and rename.
- **Assertions on the contract, not the implementation:** injected faults must
  leave no orphaned capacity or locks, terminate tasks in the documented
  terminal states (`failed`, `timed_out`, `cancelled`), keep retries bounded by
  policy, and never leave a partial config file selected as active.
- **Breaker transitions exercised:** open → half-open → closed recovery and
  fail-open behavior under sustained failure.
- **Sandbox auto-validate:** faults in the isolated test-copy runner must fail
  cleanly without touching the developer's repository.

## Acceptance Criteria

- [x] Injected transport faults never orphan capacity, locks, or temp files.
- [x] Truncated/invalid SSE is handled without crashing or hanging.
- [x] Circuit breaker transitions and recovery are exercised end to end.
- [x] Tasks reach the documented terminal states under each fault class.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- `test/fault-injection/` (NEW — fault responder/proxy and scenario suite)
- `test/capacity.test.ts`, `test/sse*.test.ts`, `test/configuration*.test.ts`
  (MODIFIED — injected-fault cases)
- `src/features/` (MODIFIED only where a real defect surfaces)
- `docs/testing.md` (MODIFIED — fault-injection guidance)
- `docs/tasks/055-fault-injection-test-suite.md` (NEW — this document)

## Implementation notes

- `test/fault-injection/responder.ts` is an in-test HTTP server that misbehaves
  on demand: dies mid-body, truncates SSE, interleaves keep-alive comments,
  returns an HTML error page, answers slowly, returns an empty body, or returns
  an arbitrary status. Faults are queued per request.
- `test/fault-injection.test.ts` covers three fault classes: transport
  (mid-body disconnect, non-JSON page, empty body, deadline cut-off, caller
  cancellation), stream (truncated frame, keep-alive interleaving, mid-flight
  stream error), and capacity state (thrown task, dead-process owner, corrupt
  state file, concurrency ceiling).
- Assertions are on the contract, not the implementation: every fault must
  produce a typed `InferenceError`, and the shared capacity state must end with
  zero active and zero queued entries however the task settled.

### One finding, deliberately not "fixed"

A truncated SSE frame *is* flushed to the caller rather than discarded. That
looked like a defect at first. It is not: a well-formed final frame may
legitimately arrive without a terminating newline, and the parser cannot tell
that apart from a truncation syntactically. The real guarantee is downstream —
a truncated payload does not parse as JSON, so schema validation rejects it and
the task fails closed. The test now documents that contract explicitly instead
of asserting a behavior the parser was never meant to have.
