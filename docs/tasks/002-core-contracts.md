# Task 002: Define core contracts and uniform responses

**Status:** Completed
**Completed:** 2026-08-02
**Depends on:** Task 001  
**PRD coverage:** RF-02 contract names, RF-27; CA-41, CA-42

## Objective

Define transport-neutral contracts for tool names, task states, progress stages,
error codes, evidence, limitations, diagnostics, and uniform terminal responses.

## Requirements

- Represent only `completed`, `blocked`, `failed`, `cancelled`, and
  `timed_out` as terminal states.
- Define the common fields `task_id`, `status`, `model`, and
  `config_revision`, with explicit omission rules for non-task tools.
- Distinguish validated results from diagnostics and prevent partial output from
  being typed or serialized as completed.
- Define evidence as an existing path, line range, and explanation.
- Define stable English technical names and a catalog of machine-readable error
  codes.
- Carry a request language separately so human summaries can be localized
  without translating fields or state names.
- Keep MCP SDK and LM Studio wire types outside these contracts.

## Non-scope

No MCP registration, actual translation service, file validation, task runtime,
or external request is implemented.

## Implementation outline

1. Model result variants as discriminated types.
2. Add constructors that require the fields valid for each state.
3. Add centralized redaction-safe diagnostic serialization.
4. Define feature public exports and prevent imports of internal files.
5. Document the response envelope and initial error catalog.
6. Add compile-time and runtime contract tests.

## Expected areas

- `src/shared` for domain-neutral result primitives
- A feature-owned contract module exported through `index.ts`
- Contract fixtures and serialization tests
- Tool/API reference documentation

## Tests

- Every terminal state serializes with only permitted fields.
- A completed result cannot be constructed from partial diagnostics.
- Unknown state and error values are rejected.
- Portuguese request metadata changes explanations only; fields remain English.
- Redaction placeholders cannot be confused with original secret values.
- Architecture-boundary tests reject internal cross-feature imports.

## Risks

- A response envelope that is too generic can erase tool-specific guarantees.
- Exposing SDK types now would couple all later features to transport versions.
- Localization can accidentally translate machine-readable keys.

## Acceptance criteria

- RF-27 has a documented, transport-neutral contract.
- CA-41 fields are required for task results.
- CA-42 is representable and tested without translating technical fields.
- Exactly six approved tool-name constants exist, but no generic execution tool
  or tool registration is added.
- `npm run validate` passes.

## Completion evidence

- Strict Zod schemas and constructors cover all five terminal states, task
  identity, evidence, limitations, diagnostics, progress stages, and the error
  catalog.
- Exactly six tool-name constants exist and are partitioned into task and
  non-task tools without registering MCP handlers.
- Tests reject partial/diagnostic completed responses, unknown fields, invalid
  evidence ranges, unknown states/codes, unsafe diagnostic fields, and cascading
  redaction.
- The boundary validator covers static imports, exports, dynamic imports, and
  shared-to-feature dependencies with negative fixtures.
- `npm run validate` passes 29 tests plus formatting, linting, boundary checks,
  type checking, and the production build.
