# Task 043: Daemon Process Supervision & Zero-Leak Memory Management

**Status:** Planned (v2.2.0)
**Depends on:** Task 041 (completed)

## Objective

Add memory monitoring and child-worker supervision so long-running `stdio` MCP
sessions keep a minimal memory footprint without leaks, with automatic recovery
from a wedged worker.

## Key Design Decisions

- TBD (to be resolved during planning/implementation).

## Acceptance Criteria

- [ ] Memory footprint of a long-running session stays bounded (leak test included).
- [ ] A wedged worker is detected and recovered without dropping the MCP session.
- [ ] Supervision and recovery run without repository writes and behind existing adapters.
- [ ] `npm run validate` green.

## Files Changed

- TBD.
