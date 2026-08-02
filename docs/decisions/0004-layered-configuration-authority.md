# ADR-0004: Use environment-protected policy and versioned preference files

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-22; RN-28, RN-29, RN-32; CA-33

## Context

The server needs credentials and administrative controls that repository
content cannot change, while developers also need global defaults and explicit
project preferences. Configuration must be portable, strict, inspectable
without leaking secrets, and stable enough for optimistic revision checks and
task snapshots.

## Decision

Keep the LM Studio URL, Bearer token, and allowed-model policy in required
process environment variables. Keep administrative maxima and fixed safety
limits as code-owned protected constants. Never place a credential in editable
JSON or in a resolved snapshot.

Use one strict `schema_version: 1` JSON shape for global and project
preferences. Store the global file in the operating system's standard
configuration directory and the project file as `.local-model-workers.json`
inside a validated canonical project root. Resolve editable fields as project,
global, then built-in, while protected policy always wins.

Represent revisions as a SHA-256 digest of normalized effective public values
and their origins. Exclude the Bearer token, but expose that Bearer
authentication is configured. Freeze the resolved object recursively before it
can be retained by a task.

## Consequences

### Positive

- Repository-controlled JSON cannot read or replace credentials and maxima.
- Strict schemas turn typos and unsupported fields into visible failures.
- Platform paths can be tested with injected environment and home values.
- Equivalent public configurations have deterministic, non-secret revisions.
- A task can retain an immutable starting policy even if files later change.

### Negative

- Launchers must provide three environment variables before configuration can
  resolve.
- The default model must be repeated in a preference file instead of guessed.
- Rotating only the token does not create a new public configuration revision.
- Schema evolution requires an explicit new version and migration decision.

## Alternatives considered

### Put all settings in the project file

Rejected because repository content could alter credentials, destinations, or
administrative controls and could expose secrets to agents or source control.

### Hash raw files and environment values

Rejected because formatting and unused values would create unstable revisions,
and including credential material would make hashes depend on a secret.

### Silently ignore unknown or invalid preferences

Rejected because a misspelled safety setting could appear to be active while
the server actually uses a weaker fallback.
