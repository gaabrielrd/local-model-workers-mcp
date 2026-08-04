# Task 041: Server Resource Supervision & Hardware-Aware Concurrency

**Status:** Completed  
**Depends on:** Tasks 005, 014 (completed)

## Objective

Implement hardware resource supervision (`getHardwareConcurrency`) to dynamically
calculate optimal worker concurrency limits based on system RAM and CPU core counts,
preventing system memory exhaustion during intensive model operations.

## Key Design Decisions

- **Hardware-based Scaling**: `getHardwareConcurrency` in `src/features/task-execution/hardware-concurrency.ts` caps max concurrency at 1 for systems with <8GB RAM or <=2 cores, 2 for 8-16GB RAM / <=4 cores, and up to 4 for high-spec systems.

## Acceptance Criteria

- [x] `getHardwareConcurrency` implemented and exported from `task-execution`.
- [x] Correctly scales concurrency limit based on RAM and CPU core count inputs.
- [x] All 367 tests pass (4 new hardware concurrency unit tests + full suite).
- [x] `npm run validate` green.

## Files Changed

- `src/features/task-execution/hardware-concurrency.ts` (NEW)
- `src/features/task-execution/index.ts` (MODIFIED — export `getHardwareConcurrency`)
- `test/hardware-concurrency.test.ts` (NEW — 4 unit tests)
