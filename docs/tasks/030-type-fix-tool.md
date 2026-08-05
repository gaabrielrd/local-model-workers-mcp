<Task 030: Type error correction tool fix_type_errors>
**Status:** Completed
**Depends on:** Tasks 011, 021
**PRD coverage:** Extended CAP-07 & Repetitive write offloading

## Objective

Implement the `fix_type_errors` MCP tool. It parses compiler/type-checker error logs (from TypeScript `tsc` or Python `mypy`/`pyright`), extracts affected file positions and error details, retrieves context from the repository, generates type annotation fixes via local LLM inference, and returns a validated, unapplied unified patch.

## Requirements

- Register `fix_type_errors` as an MCP tool.
- **Input Schema**:
  - `repository_root`: string
  - `type_output`: string (raw compiler output)
  - `checker`: `"tsc" | "mypy" | "pyright" | "auto"` (default `"auto"`)
  - `max_files`: number (1-20, default 10)
- **Output Schema**: Same envelope as `fix_lint_violations` (`patch`, `fixed_violations`, `unfixed_violations`, `summary`).
- Parsers:
  - `tsc`: parses lines like `file.ts(line,col): error TSxxxx: message` or `file.ts:line:col - error TSxxxx: message`.
  - `mypy`: parses lines like `file.py:line: error: message [error-code]`.
- Enforces strict patch policy (no production logic rewrites outside type fixes, max changed lines limit, path containment).

## Expected areas

- `src/features/lint-fix/contracts.ts` — Type error contracts & schemas
- `src/features/lint-fix/parsers.ts` — `tsc` and `mypy` type error log parsers
- `src/features/lint-fix/fix.ts` — `executeTypeFix` workflow
- `src/features/mcp-server/tool-names.ts` — `TOOL_NAMES.fixTypeErrors` registration
- `src/features/mcp-server/server.ts` — MCP tool declaration
- `test/lint-fix.test.ts` — Unit & integration tests

## Acceptance criteria

- `fix_type_errors` correctly parses `tsc` and `mypy` error logs.
- Generates valid unified diff patches fixing type violations.
- Rejects dangerous/oversized patches.
- `npm run validate` passes.
