# Task 048: Workspace Profiles & Multi-Preset Switching

**Status:** Implemented (v2.4.0)
**Depends on:** Tasks 003, 040 (completed)

## Objective

Extend the global `fast`/`thorough`/`balanced` presets to project and workspace
scope, switchable at runtime via `update_config`, so a repository can move
between development, security-audit, refactoring, and documentation modes
without a server restart.

## Key Design Decisions

- **Resolution order:** the effective `profile` resolves project over global
  over the `"balanced"` built-in default. `origins.profile` reports the layer
  that supplied it.
- **Explicit limits beat presets:** each editable limit resolves project >
  global > active profile preset > built-in default. A profile changes only the
  fallback values; any explicit preference at project or global scope wins.
- **Preset contents:** `fast`, `thorough`, and `balanced` live in
  `PROFILE_PRESETS` in `src/features/configuration/constants.ts`. `balanced`
  overrides nothing and keeps built-in defaults.
- **Runtime switch without restart:** `update_config` persists the profile to
  the project preferences file atomically. Every MCP tool call re-resolves the
  effective configuration through `taskDependencies`, so the very next call —
  including `get_config` with `project_root` — reflects the new profile with a
  new revision. No process restart is needed.
- **Mutation semantics:** the `profile` field is a nullable project override.
  Setting a value switches the profile; `null` removes the project override and
  falls back to the global preset or `balanced`.

## Acceptance Criteria

- [x] Presets resolve at project and workspace scope over global scope.
- [x] `update_config` switches presets at runtime without a restart.
- [x] Resolution order and conflicts are documented and tested.
- [x] `npm run validate` green (438 tests).

## Files Changed

- `src/features/configuration/constants.ts` (MODIFIED — `PROFILE_PRESETS`)
- `src/features/configuration/configuration.ts` (MODIFIED — `profile` field,
  `CONFIGURATION_PROFILES`, project > global > preset resolution)
- `src/features/configuration/mutation.ts` (MODIFIED — `profile` mutable field
  with set/`null`-to-clear semantics)
- `src/features/mcp-server/server.ts` (MODIFIED — per-call configuration
  re-resolution in `taskDependencies`)
- `test/configuration-profiles.test.ts` (MODIFIED — precedence, preset limits,
  explicit-beats-preset, runtime switch, `null` fallback)
- `test/configuration-mutation.test.ts` (MODIFIED — profile mutation coverage)
- `test/integration/mcp-server.test.ts` (MODIFIED — runtime profile switch
  through `validate_config`/`update_config`/`get_config`)
