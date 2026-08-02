<Task 021: Lint fix tool>
**Status:** Completed
**Depends on:** Tasks 011, 018
**PRD coverage:** New capability CAP-10

## Objective

Implement a new `fix_lint_violations` MCP tool that receives structured lint output, uses a local model to generate correction patches, and returns validated unified diffs that fix only the reported violations.

## Requirements

- Register `fix_lint_violations` as a new MCP tool.
- Input schema: `{ repository_root: string, lint_output: string, linter?: 'eslint' | 'biome' | 'ruff' | 'auto' (default 'auto'), max_files?: number (default 10, max 20) }`.
- Parse structured lint output to extract: file path, line number, column, rule ID, severity, message.
- Auto-detect linter from output format when `linter` is 'auto'.
- Read the affected source files via repository access (respecting content filtering).
- Use `inferStructured` to generate a unified diff patch that fixes the reported violations.
- Validate the generated patch using an adapted version of the existing patch validation policy:
  - Only files mentioned in the lint output may be modified.
  - Changes must be localized to the lines reported by the linter (±5 lines context).
  - No file deletions, renames, or binary changes.
  - Maximum 20 files and 500 changed lines per request.
- Return `{ patch: string, fixed_violations: Array<{ file, line, rule_id }>, unfixed_violations: Array<{ file, line, rule_id, reason }>, summary: string }`.
- Never write to the repository or execute linter commands.
- Report violations that could not be fixed (e.g., require architectural changes) in `unfixed_violations` with a reason.

## Non-scope

Running the linter, auto-detecting lint configuration, fixing type errors, refactoring, production behavior changes.

## Implementation outline

1. Create lint output parsers for ESLint (JSON format), Biome (JSON), and Ruff (JSON) in `src/features/lint-fix/parsers.ts`.
2. Implement auto-detection based on output structure.
3. Create the patch generation prompt with violation context.
4. Adapt the existing patch validation policy for production code (broader path acceptance than test-only).
5. Implement the `fix_lint_violations` tool handler.
6. Register in MCP server.

## Expected areas

- `src/features/lint-fix/contracts.ts` — Types and interfaces
- `src/features/lint-fix/parsers.ts` — Lint output parsers
- `src/features/lint-fix/fix.ts` — Fix generation and validation
- `src/features/lint-fix/index.ts` — Public exports
- `src/features/mcp-server/server.ts` — Tool registration
- `test/lint-fix.test.ts` — Unit and integration tests

## Tests

- ESLint JSON output with 3 violations generates a valid patch fixing all 3.
- Biome JSON output is correctly parsed and processed.
- Ruff JSON output for Python files is correctly parsed.
- Auto-detection correctly identifies the linter from output format.
- Patch only modifies lines near the reported violations (±5 lines).
- Patch that attempts to modify unreported files is rejected.
- Violations requiring architectural changes are reported as unfixed.
- Maximum file and line limits are enforced.
- No repository writes occur during the process.
- Malformed lint output returns a clear error.

## Risks

- Lint output format varies between linter versions; pin supported format versions.
- Model may generate fixes that introduce new violations; document this limitation.
- Localization constraint (±5 lines) may be too strict for some fixes; make configurable.

## Acceptance criteria

- Valid patches are generated for common ESLint, Biome, and Ruff violations.
- Patch validation prevents modifications outside reported violation areas.
- Unfixable violations are clearly reported with reasons.
- No repository files are modified during the process.
- `npm run validate` passes.
