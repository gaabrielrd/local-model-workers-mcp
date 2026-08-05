# Task 043: Daemon Process Supervision & Zero-Leak Memory Management

**Status:** Implemented (v2.2.0)
**Depends on:** Task 041 (completed)

## Objective

Add memory monitoring and child-worker supervision so long-running `stdio` MCP
sessions keep a minimal memory footprint without leaks, with automatic recovery
from a wedged worker.

## Key Design Decisions

- **Sampling supervisor, not a watchdog process:** `src/features/process-supervision/`
  samples RSS and event-loop lag on a fixed interval inside the server process,
  so no extra child process has to be kept alive or reaped.
- **Eviction before restart:** a sustained memory breach fires registered
  evictors (caches, vector index) and writes one diagnostic, rather than
  recycling the process and dropping the MCP session.
- **Wedge recovery via signal reset:** sustained event-loop lag aborts in-flight
  tasks through a resettable abort signal and issues a fresh one, so the stdio
  session survives.

## Acceptance Criteria

- [x] Memory footprint of a long-running session stays bounded (leak test included).
- [x] A wedged worker is detected and recovered without dropping the MCP session.
- [x] Supervision and recovery run without repository writes and behind existing adapters.
- [x] `npm run validate` green.

## Files Changed

- TBD.

## Implementation notes

The status line above was stale: this pillar shipped in v2.2.0 alongside tasks
044-045, and `docs/tasks/README.md` has listed it as implemented since then.
Corrected during the v2.13.0 sweep after confirming the module and its nine
supervision tests are present and green.
