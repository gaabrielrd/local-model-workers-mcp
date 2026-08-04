# Task 046: JetBrains IDE Suite Support

**Status:** Implemented (v2.3.0)
**Depends on:** Task 031 (completed)

## Objective

Add interactive setup support for IntelliJ IDEA, PyCharm, WebStorm, GoLand, and
CLion via a shared JetBrains AI Assistant MCP configuration adapter and managed
steering prompt rules, matching the existing Claude Code, Codex, Antigravity,
Cursor, VS Code, and Neovim flows.

## Key Design Decisions

- JetBrains IDEs share a single AI Assistant MCP configuration file, so one
  `jetbrains` harness target registers the managed `local-model-workers` entry
  for all five IDEs:
  - macOS: `~/Library/Application Support/JetBrains/AIAssistant/mcp.json`
  - Linux: `~/.config/JetBrains/AIAssistant/mcp.json` (respects
    `XDG_CONFIG_HOME`)
  - Windows: `%APPDATA%\JetBrains\AIAssistant\mcp.json` (respects `APPDATA`)
- The entry uses the standard `mcpServers` JSON format, reusing the existing
  JSON merge/inspect machinery (fresh/identical/compatible/conflicting/
  malformed states, fail-closed on invalid JSON).
- Steering prompt rules install into JetBrains' native AI Assistant project
  rules directory: `.aiassistant/rules/local-model-workers.md` in the project
  root, using the same managed marker block as the other harnesses. Registration
  in the IDE UI (Settings > Tools > AI Assistant > Rules) remains a manual step.
- Unsupported IDE versions are detected by scanning the JetBrains config root
  for `<Product><Year>.<Major>` directories (`IntelliJIdea`, `IdeaIC`,
  `PyCharm`, `WebStorm`, `GoLand`, `CLion`) and reported as warnings when below
  `2025.1` (the AI Assistant MCP minimum). Detection is fail-soft: a missing or
  unreadable config root produces no warnings.
- `ProposeHarnessConfigurationsInput` gained `platform`; proposals gained a
  `warnings` array that is advisory and excluded from the content-based
  `proposal_id`.
- Bearer token is embedded in the JetBrains MCP `env` when present (same as the
  Antigravity harness).

## Acceptance Criteria

- [x] Interactive setup configures all five JetBrains IDEs without overwriting
      existing harness configuration.
- [x] Steering prompt rules are installed for each supported IDE.
- [x] Unsupported IDE versions are detected and reported.
- [x] `npm run validate` green.

## Files Changed

- `src/features/installation/jetbrains.ts` (new): platform-aware shared config
  path resolution, project rules path, version detection, and warnings.
- `src/features/installation/harnesses.ts`: `jetbrains` harness in the union and
  `all` selection, env/token handling, target/steering path resolution, and
  proposal `warnings`.
- `src/features/installation/cli.ts` and `interactive.ts`: `jetbrains` target
  parsing, checkbox option, warning printing, platform plumbing, and completion
  hints.
- `src/features/installation/index.ts`: exports the JetBrains helpers.
- `test/jetbrains.test.ts` (new): path resolution, version detection, propose/
  apply/merge, idempotence, fail-closed malformed, and CLI tests.
- `test/installation.test.ts` and `test/harness-steering.test.ts`: updated
  `all` selections and steering path expectations.
- `docs/installation.md`: JetBrains harness documentation.