# Task 008: Implement isolated task lifecycle

**Status:** Completed
**Depends on:** Tasks 002-003 and 007  
**PRD coverage:** RF-14, RF-17, RF-18, RF-19; RN-25, RN-34, RN-35, RN-38, RN-39; CA-26 through CA-29, CA-39, CA-43

## Objective

Create a task runtime that owns one immutable configuration snapshot, model,
deadline, cancellation signal, retry budget, progress stream, and terminal
result without sharing content between tasks.

## Requirements

- Assign a unique task identifier and capture the effective configuration
  revision and selected model at creation.
- Separate queued time from the default ten-minute processing deadline.
- Propagate harness cancellation or connection close to repository and inference
  work as soon as technically possible.
- Permit exactly one terminal transition.
- Mark partial work as diagnostic and never `completed`.
- Release in-memory goals, snippets, prompts, responses, and patches after the
  task ends.
- Preserve a task's starting configuration when project configuration changes.
- Integrate the bounded LM Studio retry policy without resetting the processing
  deadline.
- Produce progress-domain events without assuming a transport.

## Non-scope

No global capacity or queue implementation, MCP notification, repository
exploration, test proposal, or persistent content.

## Implementation outline

1. Define the task state machine and terminal transition rules.
2. Inject clock, identifier, cancellation, and cleanup dependencies.
3. Snapshot configuration and model selection on creation.
4. Apply a processing deadline only when processing begins.
5. Compose abort signals across caller cancellation and timeouts.
6. Guarantee cleanup in success and all failure paths.
7. Expose progress events for later MCP mapping.

## Expected areas

- `src/features/task-execution`
- Clock, identifier, and cancellation ports
- State-machine and lifecycle tests
- Architecture and response-contract documentation

## Tests

- Unique independent tasks with distinct context objects.
- Exactly one terminal result under cancellation/timeout races.
- Default and configured processing deadline.
- Queued duration does not consume processing duration.
- Cancellation interrupts repository/inference fakes and skips unnecessary retry.
- Retry remains inside the original deadline.
- Configuration update does not mutate an active snapshot.
- A new task cannot observe a prior task's content or buffers.
- Cleanup runs for every terminal state.

## Risks

- Race conditions can overwrite a more accurate terminal state.
- Retained closures or event listeners can preserve sensitive task content.
- Layering retries and timeouts incorrectly can multiply total duration.

## Acceptance criteria

- CA-26 through CA-29, CA-39, and CA-43 pass at the runtime boundary.
- Task content is unreachable after cleanup in controlled lifecycle tests.
- Progress events and terminal states use the contracts from Task 002.
- No global concurrency assumption is embedded in the runtime.
- `npm run validate` passes.
