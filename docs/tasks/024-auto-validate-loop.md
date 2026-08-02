<Task 024: Auto-validate test loop>
**Status:** Not started
**Depends on:** Tasks 011, 023
**PRD coverage:** New capability CAP-13

## Objective

Implement a new `auto_validate_tests` MCP tool that generates test proposals, executes them in an isolated sandbox, analyzes failures, and iteratively refines the tests until they pass — delivering only green, validated test patches to the caller.

## Requirements

- Register `auto_validate_tests` as a new MCP tool.
- Input schema: `{ repository_root: string, goal: string, max_iterations?: number (default 3, max 5), test_command?: string (auto-detected if omitted), timeout_per_iteration_ms?: number (default 120000, max 300000) }`.
- Workflow per iteration:
  1. Generate a test proposal using the existing `propose_tests` pipeline.
  2. Create an isolated temporary copy of the repository (or relevant subset).
  3. Apply the proposed unified diff patch to the temporary copy.
  4. Execute the test command in a sandboxed child process (no network, bounded timeout, bounded stdout/stderr capture).
  5. If tests pass: return the validated patch with execution evidence.
  6. If tests fail: feed the error output back to the local model for a refined proposal and iterate.
- The original repository is NEVER modified. All writes happen in the temporary sandbox.
- Sandbox process constraints: no network access (where platform supports it), CPU timeout, bounded stdout/stderr (max 64KB each), working directory restricted to the temporary copy.
- If all iterations fail, return the best attempt (fewest failures) with diagnostic information about remaining failures.
- Report progress events for each iteration: `{ iteration, status: 'generating' | 'applying' | 'running' | 'analyzing', test_results?: { passed, failed, errors } }`.
- Clean up all temporary directories after completion (success or failure).
- Use `resolveModelForTask('test_proposal')` for model selection.

## Non-scope

Production code changes, dependency installation in sandbox, parallel iteration execution, persistent sandbox state between tool calls, CI/CD integration.

## Implementation outline

1. Define sandbox contracts: `SandboxOptions`, `SandboxResult`, `SandboxExecution`.
2. Implement temporary directory creation with repository copy (only source + test files, respecting .gitignore).
3. Implement sandbox process runner with timeout, output capture, and network restriction.
4. Implement unified diff patch applier for the temporary copy.
5. Implement test result parser (exit code + stdout/stderr analysis).
6. Implement iteration loop with refinement prompt generation.
7. Implement the `auto_validate_tests` tool handler with progress reporting.
8. Register in MCP server.

## Expected areas

- `src/features/auto-validate/contracts.ts` — Types and interfaces
- `src/features/auto-validate/sandbox.ts` — Sandbox process execution
- `src/features/auto-validate/patch-apply.ts` — Diff application to temp directory
- `src/features/auto-validate/loop.ts` — Iteration loop logic
- `src/features/auto-validate/index.ts` — Public exports
- `src/features/mcp-server/server.ts` — Tool registration
- `test/auto-validate.test.ts` — Unit and integration tests

## Tests

- Test proposal that passes on first iteration returns validated patch with evidence.
- Test proposal that fails on first iteration but succeeds after refinement returns the refined patch.
- All iterations fail: returns best attempt with diagnostic information.
- Original repository is verified unchanged after every scenario.
- Temporary directory is cleaned up after success.
- Temporary directory is cleaned up after failure.
- Sandbox timeout kills the child process and moves to next iteration.
- Sandbox stdout/stderr capture is bounded to 64KB.
- Cancellation aborts the current iteration and cleans up.
- Progress events are emitted for each iteration phase.
- `max_iterations` limit is respected.
- Test command auto-detection works for TypeScript (npm test) and Python (pytest) projects.

## Risks

- Sandbox isolation without containers is limited; document platform-specific restrictions.
- Repository copy for large projects may be slow; copy only necessary files.
- Test command execution is inherently risky; bound all resources strictly.
- macOS lacks native network namespace isolation; document the limitation.

## Acceptance criteria

- Validated test patches are delivered only when tests pass in the sandbox.
- The original repository is never modified.
- Sandbox processes are bounded by timeout and output limits.
- Temporary directories are always cleaned up.
- Progress events are emitted for each iteration.
- `npm run validate` passes.
