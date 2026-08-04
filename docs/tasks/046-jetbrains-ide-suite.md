# Task 046: JetBrains IDE Suite Support

**Status:** Planned (v2.3.0)
**Depends on:** Task 031 (completed)

## Objective

Add interactive setup support for IntelliJ IDEA, PyCharm, WebStorm, GoLand, and
CLion via `.idea` MCP configuration adapters and managed steering prompt rules,
matching the existing Claude Code, Codex, Antigravity, Cursor, VS Code, and
Neovim flows.

## Key Design Decisions

- TBD (to be resolved during planning/implementation).

## Acceptance Criteria

- [ ] Interactive setup configures all five JetBrains IDEs without overwriting
      existing harness configuration.
- [ ] Steering prompt rules are installed for each supported IDE.
- [ ] Unsupported IDE versions are detected and reported.
- [ ] `npm run validate` green.

## Files Changed

- TBD.
