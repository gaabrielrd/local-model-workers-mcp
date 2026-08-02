# ADR-0009: Coordinate local capacity with atomic filesystem state

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-15, RF-16; RN-26; CA-24, CA-25

## Context

Claude Code and Codex may each start their own MCP server process, but all of
those processes must share one processing limit and deterministic queue on a
single developer machine. Queue state must survive normal process boundaries,
recover from crashes, contain no repository content, and have a portable path
on macOS, Linux, and Windows without introducing a daemon or database.

Advisory file-lock APIs are not consistently available through Node.js across
the three platforms. Time-only leases can recover a crash, but they can also
steal capacity from a live process whose event loop was paused.

## Decision

Store one strict JSON state file under the application's global configuration
directory in `coordination/`. Serialize every state transition with atomic
creation of a `capacity-state.lock` directory. The short-lived lock contains an
owner file with only a process ID and per-process UUID. State replacement uses
a mode-`0600` temporary file and atomic rename while the lock is held.

Persist only schema version, configured capacity, next FIFO sequence, task
identifier, process ID, per-process UUID, and enqueue/acquisition timestamps.
Never persist goals, paths, snippets, prompts, responses, evidence, or patches.

Assign FIFO order when the enqueue transaction commits. A waiter may acquire
only when its persisted position is within the currently available slot count.
Use the effective configured queue deadline; processing starts only inside the
acquired callback, so its separate Task 008 deadline is untouched.

On every transaction, remove queue and active records whose process no longer
exists. A current-PID record with a different process UUID is also stale, which
handles PID reuse after restart. Recover a transaction lock only when it is at
least ten seconds old and its recorded process is dead. Cleanup names only the
fixed owner file and lock directory; it never recursively deletes an unresolved
target.

While work is active, reject a different configured capacity rather than risk
oversubscription. Once state is empty, the next task may establish a new
effective capacity. Configuration already bounds capacity and queue timeout by
their protected administrative maxima.

## Consequences

### Positive

- Independent MCP processes share the same slots without another service.
- FIFO order is explicit, persisted, and testable.
- A killed process loses its queue and active ownership on the next transaction.
- Queue cancellation and timeout remove their exact entry, while normal or
  exceptional processing completion releases its slot in `finally`.
- State is inspectable and restricted to an explicit metadata schema.
- The primitive uses filesystem operations supported by Node.js on macOS,
  Linux, and Windows.

### Negative

- Waiters poll the small state transaction at a bounded interval.
- A process that remains alive but hangs indefinitely retains its active slot;
  the coordinator prefers a safe capacity leak over stealing from a live owner.
- A stale transaction lock waits ten seconds before dead-owner recovery.
- Concurrent tasks with different effective capacities fail closed until the
  active queue drains.
- Atomic rename behavior still depends on a local filesystem; network-mounted
  configuration directories are unsupported.

## Alternatives considered

### Time-only renewable leases

Rejected because a scheduler pause could expire a live worker and permit more
than the configured capacity.

### One advisory lock per processing slot

Rejected because it does not provide a deterministic FIFO queue and portable
Node.js advisory locking would require another native dependency.

### Local coordinator daemon or embedded database

Rejected as unnecessary operational and dependency complexity for one-machine
metadata with short atomic transactions.
