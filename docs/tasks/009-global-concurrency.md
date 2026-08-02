# Task 009: Coordinate global concurrency and queueing

**Status:** Completed
**Depends on:** Task 008  
**PRD coverage:** RF-15, RF-16; RN-26; CA-24, CA-25

## Objective

Enforce the default processing capacity of two tasks across all local MCP
processes, with a bounded FIFO queue, five-minute default queue timeout,
cancellation, and abandoned-owner recovery.

## Requirements

- Capacity is shared across Claude Code and Codex server processes.
- At most two tasks process by default; extra tasks wait in a deterministic
  queue.
- Queue time and processing time are measured separately.
- A task waiting five minutes by default ends as `timed_out`.
- Cancellation removes a queued task and releases an acquired slot.
- Process crash or abandoned ownership cannot permanently leak capacity.
- Protected administrative maxima bound editable concurrency and queue values.
- Coordination persists identifiers and timing metadata only, never repository
  content, prompts, responses, or patches.
- The mechanism must work on macOS and have a portable tested path for Linux and
  Windows.

## Assumptions to resolve

Evaluate filesystem locks, local lock files with leases, or another
single-machine primitive. Select one based on atomicity, fairness, stale-owner
recovery, platform semantics, and testability. Record the choice and recovery
model in a dedicated ADR before implementing it.

Resolved by
[ADR-0009](../decisions/0009-coordinate-capacity-with-atomic-filesystem-state.md):
atomic lock-directory transactions over a metadata-only JSON state, FIFO by
committed sequence, PID plus per-process UUID recovery, a ten-second dead lock
threshold, strict configuration agreement while work is active, and portable
global configuration paths.

## Non-scope

No distributed multi-machine scheduler, shared service, prioritization,
multiple worker pools, or result consolidation.

## Implementation outline

1. Write and accept the cross-process coordination ADR.
2. Define a capacity lease and queue entry contract.
3. Implement atomic acquisition, renewal if needed, release, and stale recovery.
4. Integrate fake clocks for deterministic queue timeout tests.
5. Spawn real child processes in integration tests to prove global behavior.
6. Add exact cleanup rules that cannot target unrelated files.
7. Document operational state location and recovery behavior.

## Expected areas

- `src/features/task-execution` public coordinator port
- Cross-process coordination adapter
- Child-process integration test helpers
- Coordination ADR and platform documentation

## Tests

- Three simultaneous tasks across at least two processes: two process, one
  queues.
- FIFO or the selected documented fairness rule.
- Default and configured capacity within protected maxima.
- Five-minute queue timeout does not start processing timeout.
- Queued and processing cancellation.
- Normal release, process crash, stale lease, and restart recovery.
- Concurrent acquisition stress with no capacity oversubscription.
- Coordination artifacts contain metadata only.

## Risks

- Advisory locking semantics differ across filesystems and platforms.
- Aggressive stale recovery can allow two live owners.
- Weak cleanup target validation can remove unrelated local files.
- Fairness guarantees may be impossible with a simplistic lock.

## Acceptance criteria

- CA-24 and CA-25 pass using separate operating-system processes.
- Capacity never exceeds the effective configured limit.
- Crashed processes do not permanently block new work.
- Queue state contains no task content.
- The selected mechanism is documented in an accepted ADR.
- `npm run validate` passes.
