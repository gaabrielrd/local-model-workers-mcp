<Task 031: Extended IDE & Harness Setup for Cursor, VS Code, and Neovim>
**Status:** Completed
**Depends on:** Tasks 014, 026
**PRD coverage:** Extended CAP-07 & Harness Installation

## Objective

Expand `harnesses.ts` and `cli.ts` to support automated MCP registration and steering instruction setup for Cursor, VS Code (Roo Code / Cline / Continue), and Neovim (Avante.nvim), alongside Claude Code, Codex, and Antigravity.

## Requirements

- Add `"cursor"`, `"vscode"`, and `"neovim"` to `Harness` types in `src/features/installation/harnesses.ts`.
- **Cursor Target**: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project).
- **VS Code Target**: `~/.vscode/mcp.json` (global) or `.vscode/mcp.json` (project).
- **Neovim Target**: `~/.config/nvim/mcp.json` (global) or `.neovim/mcp.json` (project).
- Support steering instruction files: `.cursor/rules/mcp.md` for Cursor, `.vscode/instructions.md` for VS Code, `.neovim/instructions.md` for Neovim.
- Interactive CLI setup includes Cursor, VS Code, and Neovim in checkbox options.
- Update tests in `test/installation.test.ts` to verify proposal generation and application for new harnesses.

## Expected areas

- `src/features/installation/harnesses.ts` — Harness target paths, JSON configuration proposals & steering
- `src/features/installation/cli.ts` — Interactive checkbox harness options
- `test/installation.test.ts` — Proposal & installation integration tests

## Acceptance criteria

- `proposeHarnessConfigurations` generates valid proposals for `cursor`, `vscode`, and `neovim`.
- `applyHarnessConfiguration` writes MCP configurations atomically.
- `npm run validate` passes.
