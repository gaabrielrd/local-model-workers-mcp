<Task 023: Multi-model task routing>
**Status:** Not started
**Depends on:** Tasks 003, 004, 007
**PRD coverage:** New capability CAP-12

## Objective

Extend the configuration model to support mapping task types to specific models, enabling automatic routing of different workloads to specialized local models (e.g., small models for classification, embedding models for search, larger models for code generation).

## Requirements

- Add a new optional `model_routing` section to the configuration schema at all levels (global, project, built-in).
- Schema: `model_routing: { embedding?: string, exploration?: string, test_proposal?: string, lint_fix?: string, docs_generation?: string, summarization?: string, code_graph?: string }`.
- Each field maps a task type to a specific model ID from `allowedModels`.
- When a task-type-specific model is configured, use it instead of `default_model` for that task.
- When a task-type-specific model is NOT configured, fall back to `default_model`.
- All routed models must be in `allowedModels`; reject configuration that references unauthorized models.
- The `model_routing` section follows the same precedence rules: project > global > built-in.
- Expose routing configuration in `get_config` and allow updates via `validate_config` / `update_config`.
- Add `resolveModelForTask(taskType: string): string` utility to the configuration API.
- Update all existing tool implementations to use `resolveModelForTask` instead of hardcoded `default_model`.

## Non-scope

Automatic model selection based on benchmarks, load balancing across models, concurrent inference on multiple models, model performance monitoring.

## Implementation outline

1. Extend configuration schema with `model_routing` section and Zod validation.
2. Add `resolveModelForTask` to the effective configuration API.
3. Update `getEffectiveConfiguration` to merge `model_routing` across layers.
4. Update `explore_repository`, `propose_tests`, and all new V1.5/V2.0 tools to use `resolveModelForTask`.
5. Update `get_config` view to include routing information.
6. Add validation in `validate_config` for routing model references.
7. Update configuration documentation.

## Expected areas

- `src/features/configuration/configuration.ts` — Schema extension and resolution
- `src/features/configuration/mutation.ts` — Mutation validation
- `src/features/repository-exploration/exploration.ts` — Use resolved model
- `src/features/test-proposal/proposal.ts` — Use resolved model
- `docs/configuration.md` — Documentation update
- `test/configuration.test.ts` — Routing tests
- `test/configuration-mutation.test.ts` — Mutation tests

## Tests

- Task with specific routing uses the routed model instead of default.
- Task without specific routing falls back to `default_model`.
- Project-level routing overrides global-level routing.
- Routing to an unauthorized model (not in `allowedModels`) is rejected.
- `get_config` includes `model_routing` section.
- `update_config` can set and clear routing entries.
- `resolveModelForTask` returns correct model for each task type.
- Existing exploration and test proposal tests continue passing with default routing.
- Wildcard `allowedModels` (`["*"]`) allows any routed model.

## Risks

- Adding a new configuration section requires careful schema migration for existing preference files.
- Tool implementations must be updated consistently; missing a tool creates a silent regression.

## Acceptance criteria

- Model routing is correctly resolved across configuration layers.
- All tools use `resolveModelForTask` for model selection.
- Unauthorized routing references are rejected at validation time.
- Configuration view and mutation include routing information.
- Existing tests continue passing.
- `npm run validate` passes.
