# Task 005: Enforce a read-only repository path sandbox

**Status:** Pending  
**Depends on:** Tasks 001-002  
**PRD coverage:** RF-04 input/root validation, RF-05; RN-05 through RN-07; CA-06 through CA-08

## Objective

Provide the only repository-access surface available to task features: bounded
directory listing, text search, and snippet reading within one canonical root.

## Requirements

- Validate that the supplied repository root exists, is a directory, and can be
  canonicalized before any model request.
- Resolve relative components and symlinks before authorization.
- Reject absolute or relative paths whose resolved target leaves the root.
- Repeat authorization for every operation; validation of a parent request is
  not sufficient.
- Expose only list, search, and bounded text-read operations.
- Never write, execute commands, change permissions, or follow escaping links.
- Return structured, redaction-safe errors without widening access.
- Design adapters so tests use temporary directories, not the active repository.

## Non-scope

Git ignore, sensitive-file classification, binary detection,
`.mcp-agent-ignore`, context budgets, LM Studio, or task orchestration. Those
filters are layered in Task 006.

## Implementation outline

1. Define a repository access capability owned by the exploration boundary.
2. Canonicalize roots and targets with explicit containment semantics.
3. Implement bounded directory listing with deterministic ordering.
4. Implement literal/regular-expression text search with result limits.
5. Implement line-addressed snippet reads with byte and line limits.
6. Reject unsupported file types and operation categories by default.
7. Document path semantics for macOS, Linux, and Windows.

## Expected areas

- `src/features/repository-exploration` public read capability
- Filesystem adapter and path policy
- Temporary repository fixtures
- Security and architecture documentation

## Tests

- Valid root, missing root, file-as-root, and inaccessible root.
- Relative, absolute, dot-segment, sibling-prefix, and nested paths.
- Symlink to an in-root target and symlink escaping the root.
- Root replacement or symlink change between validation and operation.
- Directory listing, search, and snippet bounds.
- Attempts to write, execute, or request an unsupported operation.
- Platform-specific case and separator behavior where applicable.
- Goal validation rejects empty input before any LM Studio adapter is called.

## Risks

- String-prefix containment checks are vulnerable to sibling-prefix paths.
- Validation performed only once is vulnerable to path changes during a task.
- Search implementations can consume unbounded memory or follow unsafe links.

## Acceptance criteria

- CA-06 through CA-08 pass with no network activity on rejected input.
- Only the three approved read-operation categories are public.
- Every successful access is proven inside the canonical root.
- No test mutates the developer's repository.
- `npm run validate` passes.

