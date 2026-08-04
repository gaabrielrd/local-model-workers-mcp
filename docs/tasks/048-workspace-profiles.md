# Task 048: Workspace Profiles & Multi-Preset Switching

**Status:** Planned (v2.4.0)
**Depends on:** Tasks 003, 040 (completed)

## Objective

Extend the global `fast`/`thorough`/`balanced` presets to project and workspace
scope, switchable at runtime via `update_config`, so a repository can move
between development, security-audit, refactoring, and documentation modes
without a server restart.

## Key Design Decisions

- TBD (to be resolved during planning/implementation).

## Acceptance Criteria

- [ ] Presets resolve at project and workspace scope over global scope.
- [ ] `update_config` switches presets at runtime without a restart.
- [ ] Resolution order and conflicts are documented and tested.
- [ ] `npm run validate` green.

## Files Changed

- TBD.
