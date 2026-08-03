<Task 029: Smart context-aware & task-type model routing>
**Status:** In Progress
**Depends on:** Tasks 023, 025
**PRD coverage:** Extended CAP-07 & Multi-model routing

## Objective

Enhance `resolveModelForTask` in `src/features/configuration` to support context-length-aware dynamic model routing alongside task-type routing. When a task requires processing large input contexts (e.g., repository exploration or large test suites), the router selects models configured or suited for large context windows.

## Requirements

- Update `resolveModelForTask(configuration, taskType, options)` to accept an optional `{ contextTokenCount?: number }` options parameter.
- Support threshold-based routing: if `contextTokenCount` exceeds 16,384 tokens and a `large_context` model route or large-context candidate model exists in `allowed_models`, route to that model.
- Retain existing task-type routing (`exploration`, `tests`, `docs`, `lint`, `embedding`) when explicit routes are configured in `model_routing`.
- Fall back to `default_model` or auto-detected embedding models when no specific route or threshold rule matches.
- Existing single-argument `resolveModelForTask(configuration, taskType)` calls continue working without breaking changes.

## Expected areas

- `src/features/configuration/configuration.ts` — `resolveModelForTask` context options
- `test/configuration.test.ts` — Unit tests for context-aware model routing

## Acceptance criteria

- `resolveModelForTask` selects large-context models when `contextTokenCount` exceeds threshold.
- Task-type and embedding auto-detection rules remain active.
- `npm run validate` passes.
