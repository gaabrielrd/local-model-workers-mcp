# ADR-0006: Anchor repository reads to canonical filesystem identities

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-04 input validation, RF-05; RN-05 through RN-07; CA-06 through CA-08

## Context

Repository paths and symlinks are untrusted. A string-prefix check accepts
sibling paths with the same prefix, and validating only when a task starts lets
the root or a link change before a later read. The remote worker must receive a
small read-only surface with deterministic resource bounds and no generic local
operation.

## Decision

Create a capability anchored to one canonical directory and its device/inode
identity. Before and after every operation, verify that identity. Resolve every
requested target with `realpath`, prove component-aware containment, capture
its identity, read by the canonical path, and verify the identities again
before returning content.

Expose only bounded directory listing, text search, and line-addressed snippet
reading. Use deterministic ordering, fixed per-operation safety ceilings, strict
runtime input schemas, fatal UTF-8 decoding, and a restricted regular-expression
subset. Do not recursively follow symlinks during search.

Keep filesystem operations behind an injected adapter so negative and TOCTOU
tests use temporary repositories or controlled fakes.

## Consequences

### Positive

- Traversal, absolute escapes, sibling-prefix paths, and escaping symlinks fail
  before content is returned.
- Changing a requested symlink after resolution cannot redirect the read.
- Root or target replacement during an operation invalidates its result.
- Internal model requests cannot write, execute, or ask for an arbitrary
  operation through this capability.
- Tests never need the developer's active repository.

### Negative

- Repeated `realpath` and `stat` calls add local filesystem overhead.
- Broad search intentionally omits symlinks and stops at fixed scan ceilings.
- Device/inode checks cannot prove against an adversary able to replace and
  restore the same identity during one operation; OS-level descriptor handles
  remain preferable where later adapters can provide them portably.
- Content policy and Git awareness still require the separate filtering layer.

## Alternatives considered

### Normalize strings and check `startsWith(root)`

Rejected because sibling prefixes and platform separator/case rules bypass a
plain string-prefix comparison.

### Validate paths only when the capability is created

Rejected because symlinks and roots can change between task setup and a later
read.

### Expose a generic filesystem operation with an allowlist

Rejected because a closed capability with three methods is easier to audit and
cannot accidentally grow command or mutation authority through an input value.
