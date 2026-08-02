# ADR-0005: Bind confirmation to an atomic project preference update

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-23 through RF-25; RN-30, RN-31, RN-33; CA-34 through CA-39

## Context

An agent may propose project configuration changes, but approval must not be
reused for different content or after the configuration changes. A crash or
filesystem error must not expose a partially written JSON file, and failed
operations must preserve the previous bytes. Existing task snapshots must not
observe a later update.

## Decision

Represent a proposal as a strict partial patch of project-editable fields. Use
`null` to remove an override. Validation is read-only and returns a SHA-256
`proposal_id` over the normalized patch and expected effective revision.
Updating requires `approved: true`, that exact identifier, the same patch, and
the same current revision.

Serialize updates for one canonical project root within a server process and
revalidate after entering the critical section. Persist a complete versioned
project document through an exclusive mode-`0600` temporary file in the target
directory. Flush and close the temporary file before atomically renaming it
over the target. On any failure, remove only the known temporary path and leave
the target untouched.

Return effective changed fields, including old/new values and origins, plus the
old and new revisions. Resolved snapshots remain recursive immutable values;
updating a file never mutates a snapshot already held by a task.

## Consequences

### Positive

- Approval cannot authorize different content or a later revision.
- Dry-run validation and all rejected updates perform no write.
- Readers observe either the old complete document or the new complete
  document, never a partially written target.
- Removing an override has an explicit representation and visible origin
  change.
- Exact temporary-path cleanup cannot delete a valid project file.

### Negative

- Callers perform validation before asking for confirmation, then repeat the
  proposal during update.
- An effective origin change counts even when the scalar value is unchanged.
- Same-process serialization does not provide a cross-process file lock;
  release qualification must exercise the supported harness topology and fail
  closed on external revision changes.
- Atomic replacement behavior still needs basic Windows and Linux smoke
  coverage, while macOS remains the fully validated V1 platform.

## Alternatives considered

### A confirmation boolean without a proposal identifier

Rejected because approval could be replayed for different content or after a
revision change.

### Edit the JSON file in place

Rejected because interruption can leave truncated or malformed configuration
visible to readers.

### Write global and protected settings through the same tool

Rejected because project tools do not own those authority layers and must not
alter credentials or administrative policy.
