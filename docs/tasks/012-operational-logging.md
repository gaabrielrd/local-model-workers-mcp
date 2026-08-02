# Task 012: Add metadata-only operational logging

**Status:** Completed
**Depends on:** Tasks 002 and 008  
**PRD coverage:** RF-29; RN-39, RN-40; CA-44, CA-45

## Objective

Record enough local metadata to diagnose task operation while making it
structurally impossible for repository content, prompts, responses, patches, or
credentials to enter logs, and remove records older than seven days.

## Requirements

- Log only an allowlisted schema: task identifier, timestamps, model identifier,
  duration, terminal status, and error code.
- Do not accept arbitrary messages, exception objects, prompts, paths, snippets,
  responses, evidence, patches, tokens, or headers in the logging API.
- Keep logs off MCP stdout.
- Store logs in a documented platform-appropriate local location.
- Enforce seven-day retention with deterministic cleanup and safe exact targets.
- Handle write, rotation/cleanup, malformed-record, and permission failures
  without changing task results or revealing content.
- Ensure model identifiers and error codes cannot carry control characters or
  unbounded data.

## Non-scope

No analytics, telemetry, remote logging, content debugging, user accounts, or
retention configuration beyond protected policy.

## Implementation outline

1. Define a narrow operational event type with no free-form content field.
2. Add serialization limits and newline/control-character handling.
3. Implement the local append/store adapter.
4. Implement retention using an injected clock.
5. Connect lifecycle terminal events without passing full results.
6. Add a log inspection test helper and privacy assertions.
7. Document location, schema, cleanup, and troubleshooting.

## Expected areas

- `src/features/operational-logging`
- Local persistence and retention adapters
- Task-lifecycle integration
- Logging documentation and privacy tests

## Tests

- Every terminal state writes only allowed keys.
- Goals, source markers, prompts, patches, tokens, headers, paths, and exceptions
  cannot be accepted or serialized.
- Seven days is retained and older records are deleted at the exact boundary.
- Malformed old records and permission failures fail safely.
- Cleanup targets only the application's log location.
- Concurrent process writes do not corrupt or leak records.
- MCP stdout remains untouched.

## Risks

- Logging raw exception objects can bypass field allowlists.
- Model identifiers or error strings can become injection channels.
- Retention cleanup is destructive and must resolve an exact application-owned
  target.

## Acceptance criteria

- CA-44 and CA-45 pass by inspecting produced files.
- The logging API has no general message or metadata bag.
- Content fixtures never appear in logs, stdout, or diagnostics.
- Retention behavior and local location are documented.
- `npm run validate` passes.
