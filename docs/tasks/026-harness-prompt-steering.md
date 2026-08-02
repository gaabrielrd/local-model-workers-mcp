<Task 026: Harness prompt steering & pre-message hooks>
**Status:** Completed
**Depends on:** Tasks 014, 018, 019
**PRD coverage:** Harness MCP Offloading Steering

## Objective

Configure pre-message hooks and system prompt steering instructions in supported harnesses (Claude Code, Codex, Antigravity) to direct the AI agent to proactively offload repository analysis, search, code graph queries, and test generation to `local-model-workers-mcp` tools whenever an opportunity arises.

## Requirements

- Extend `configure-harness` in `src/features/installation/harnesses.ts` to generate and manage harness prompt steering configuration files (e.g., `AGENTS.md` / `CLAUDE.md` / `.codex/instructions.md` / pre-message hook scripts).
- Define standardized steering instructions:
  - Direct the harness to call `explore_repository` and `search_semantic` for codebase navigation and searching instead of scanning raw files directly.
  - Direct the harness to call `query_code_graph` for symbol, caller, dependency, and export queries.
  - Direct the harness to call `propose_tests` when generating or verifying unit tests.
- Support atomic writing, dry-run previews, revision tracking, and conflict detection consistent with Task 014 harness installation standards.
- Ensure steering instructions are secret-safe, deterministic, and preserved during project configuration updates.
- Allow optional custom prompt directives via global and project preferences (`steering_prompt` configuration option).

## Non-scope

- Mutating third-party harness binary executables.
- Overwriting non-managed user prompt files without explicit approval.
- Intercepting network traffic directly outside configured harness hooks or instruction files.

## Implementation outline

1. Define `HarnessSteeringConfig` schema and instructions generator in `src/features/installation/steering.ts`.
2. Integrate steering instruction generation into `proposeHarnessConfigurations` and `applyHarnessConfiguration` in `src/features/installation/harnesses.ts`.
3. Add `steering_prompt` optional field to configuration schema (`src/features/configuration/configuration.ts`).
4. Update Antigravity, Claude Code, and Codex configuration targets to include system prompt / rule file management.
5. Export public capabilities from `src/features/installation/index.ts`.
6. Add unit and integration tests in `test/harness-steering.test.ts`.

## Expected areas

- `src/features/installation/steering.ts` — Prompt steering generator
- `src/features/installation/harnesses.ts` — Harness configuration integration
- `src/features/configuration/configuration.ts` — Optional `steering_prompt` preference
- `test/harness-steering.test.ts` — Harness steering unit tests

## Tests

- `configure-harness` proposal includes prompt steering instructions preview for all supported harnesses.
- Dry-run mode previews prompt steering changes without modifying filesystem.
- Applying proposal creates/updates harness instruction files atomically.
- Existing user instructions outside managed markers are strictly preserved.
- Custom `steering_prompt` from preferences is merged into system instructions.
- Portability checks pass on macOS, Linux, and Windows.

## Risks

- Different harnesses format system prompts / rules differently (`CLAUDE.md` vs `AGENTS.md` vs `.codex/instructions.md`); use versioned adapter templates for each harness.

## Acceptance criteria

- Harness installation configures system prompt steering directing agents to use MCP tools proactively.
- Managed instruction blocks use markers (`# local-model-workers-mcp:start` / `end`) to avoid overwriting user content.
- `npm run validate` passes.
