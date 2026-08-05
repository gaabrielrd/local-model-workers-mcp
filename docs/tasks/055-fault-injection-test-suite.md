# Task 055: Fault-Injection Test Suite

**Status:** Planned (v2.11.0)
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

- [ ] Injected transport faults never orphan capacity, locks, or temp files.
- [ ] Truncated/invalid SSE is handled without crashing or hanging.
- [ ] Circuit breaker transitions and recovery are exercised end to end.
- [ ] Tasks reach the documented terminal states under each fault class.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- `test/fault-injection/` (NEW — fault responder/proxy and scenario suite)
- `test/capacity.test.ts`, `test/sse*.test.ts`, `test/configuration*.test.ts`
  (MODIFIED — injected-fault cases)
- `src/features/` (MODIFIED only where a real defect surfaces)
- `docs/testing.md` (MODIFIED — fault-injection guidance)
- `docs/tasks/055-fault-injection-test-suite.md` (NEW — this document)
