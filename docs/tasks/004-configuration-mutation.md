# Task 004: Validate and update project configuration

**Status:** Completed
**Depends on:** Task 003  
**PRD coverage:** RF-23, RF-24, RF-25; RN-30, RN-31, RN-33; CA-34 through CA-39

## Objective

Implement dry-run validation and explicit, revision-controlled, atomic updates
of allowed project preferences while preserving active task snapshots.

## Requirements

- `validate_config` validates fields, types, ranges, protected policy, and an
  expected revision without writing.
- `update_config` requires explicit confirmation for exactly one proposal and
  expected revision.
- Only allowed project fields can change; protected and global settings cannot.
- A successful update atomically replaces the project file and increments its
  revision.
- Invalid, unconfirmed, interrupted, or stale updates leave the current
  configuration untouched.
- Return changed fields, old values, new values, and the new revision without
  secrets.
- Existing immutable snapshots remain unchanged after an update.

## Non-scope

No MCP transport, interactive CLI confirmation UI, or global preference update
command. The local global configuration command belongs to Task 014.

## Implementation outline

1. Reuse the versioned schema and field allowlist from Task 003.
2. Model validation as a pure proposal/result use case.
3. Bind confirmation to proposal content and expected revision.
4. Implement compare-and-swap semantics around an atomic temp-file replacement.
5. Define recovery and cleanup for interrupted writes.
6. Return a redacted change set and new effective snapshot.
7. Update configuration documentation with concrete examples in Portuguese.

## Expected areas

- `src/features/configuration` public use cases
- Atomic filesystem persistence adapter
- Mutation, conflict, and recovery fixtures
- Configuration documentation and possibly a persistence ADR

## Tests

- Dry-run validation never writes.
- Missing confirmation and mismatched confirmation never write.
- Current and stale revisions.
- Protected URL, token, allowed-model, and administrative-limit attempts.
- Unknown and out-of-range project fields.
- Atomic success, simulated interruption, rename failure, and cleanup.
- Active snapshot remains unchanged while a new resolution sees the new revision.
- Returned diffs and errors contain no secret.

## Risks

- Confirmation not structurally bound to the proposal can authorize a different
  change.
- Platform rename semantics differ, especially on Windows.
- Cleanup code can delete a valid configuration if targets are not exact.

## Acceptance criteria

- CA-34 through CA-39 pass at the feature boundary.
- Only project preferences can be updated.
- Failed operations preserve byte-for-byte current configuration.
- Successful writes are atomic and revisioned.
- `npm run validate` passes.

## Completion evidence

- Strict partial proposals cover only the six project-editable fields; `null`
  removes an override, while protected, global, unknown, invalid, empty, and
  no-op proposals fail without a write.
- Dry-run validation returns effective old/new values and origins plus a
  proposal identifier bound to normalized content and the expected revision.
- Updates require exact explicit confirmation, revalidate inside a
  project-scoped critical section, and reject stale or concurrent revisions.
- The persistence adapter flushes a mode-`0600` same-directory temporary file
  before rename and cleans its exact path after simulated interruption or
  rename failure while preserving existing bytes.
- Tests prove successful revision change, conflict behavior, confirmation
  binding, protected-field rejection, immutable active snapshots, and failure
  recovery; documentation and ADR-0005 record the contract.
- `npm run validate` passes formatting, linting, boundary checks, static types,
  the complete automated suite, and the production build.
