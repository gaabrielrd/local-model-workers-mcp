# Task 003: Load and resolve effective configuration

**Status:** Completed
**Depends on:** Tasks 001-002  
**PRD coverage:** RF-22; RN-28, RN-29, RN-32; CA-33

## Objective

Implement read-only loading, validation, precedence, revisioning, origin
reporting, and redaction for protected, global, project, and built-in
configuration.

## Requirements

- Resolve protected policy above editable values, project preferences above
  global preferences, and built-in defaults last.
- Define concrete fields, types, units, defaults, administrative maxima, and
  allowed project overrides.
- Keep LM Studio credentials out of agent-editable JSON.
- Return the effective value, source layer, and revision without exposing
  secrets.
- Reject malformed files and unknown fields instead of silently coercing them.
- Resolve platform-appropriate global and project locations portably.
- Validate project roots before reading a project configuration.
- Snapshot resolved configuration as an immutable value for later task use.

## Assumptions to resolve

This task must decide configuration filenames, schema versioning, revision
representation, protected environment-variable names, default values, and
platform storage locations. Record durable choices in an ADR and update
`docs/configuration.md`.

## Non-scope

No configuration write, MCP tool, global configure command, LM Studio request,
or task execution.

## Implementation outline

1. Specify a versioned schema and protected/editable field allowlists.
2. Add protected, global, project, and default loaders behind adapters.
3. Implement deterministic precedence and maximum enforcement.
4. Compute a stable revision without including secret material.
5. Add a public `get effective configuration` use case with field origins.
6. Centralize secret redaction for values and validation diagnostics.
7. Add a placeholder-only `.env.example` if environment variables are chosen.

## Expected areas

- `src/features/configuration`
- Environment and filesystem adapters
- Versioned configuration schemas and fixtures
- Configuration ADR, README, and `docs/configuration.md`

## Tests

- Every precedence combination, including protected maxima.
- Missing optional files and malformed required protected settings.
- Unknown fields, wrong types, invalid units, and out-of-range values.
- Tokens never appear in effective views, revisions, errors, or snapshots.
- Project roots and paths cannot select a configuration outside the root.
- Equivalent effective configuration produces deterministic revisions.
- Platform path resolution is testable without using the real user profile.

## Risks

- Hashing raw configuration can leak or make revisions depend on secrets.
- Platform-specific locations can make tests non-hermetic.
- Defaults chosen without explicit units can create timeout mistakes.

## Acceptance criteria

- `get_config`'s domain use case satisfies RF-22 and CA-33 independently of MCP.
- All fields and origins are documented.
- Protected values and maxima cannot be overridden by global or project files.
- No credential is stored in editable JSON or returned to callers.
- `npm run validate` passes.

## Completion evidence

- A strict versioned schema resolves protected environment, global preferences,
  project preferences, and built-in limits with per-field origins.
- The loader validates canonical project roots and rejects a project preference
  symlink whose target escapes the root.
- Effective snapshots are deeply immutable; public views redact the token; and
  SHA-256 revisions exclude secret material while covering public values and
  origins.
- Tests cover precedence, maxima, malformed and unknown fields, missing
  protected settings, allowlisting, redaction, revision determinism, platform
  locations, containment, and immutability.
- ADR-0004, `.env.example`, configuration, security, testing, and README
  documentation record the implemented contract and remaining mutation scope.
- `npm run validate` passes formatting, linting, boundary checks, static types,
  the complete automated suite, and the production build.
