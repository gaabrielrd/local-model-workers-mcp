# Task 047: Custom Post-Processing Hooks

**Status:** Implemented (v2.4.0)
**Depends on:** Tasks 011, 021 (completed)

## Objective

Run user-defined local scripts immediately after patch generation for custom
formatting, security-policy checks, or lint validation before a proposal is
returned to the client. Hooks run only with explicit developer configuration
and never alter the repository.

## Key Design Decisions

- **Explicit configuration only:** hooks are configured through the new
  `post_processing_hooks` preference (project over global over `[]`). An empty
  list disables the feature entirely; no hooks run implicitly.
- **Never touch the repository:** the runner materializes the generated patch
  in a fresh temporary directory per run and hands the hook only that directory
  as `cwd`, feeding the patch on stdin. Hook output is read from stdout; the
  repository is never a hook working directory and hooks receive no write
  access to it.
- **Fail closed:** a non-zero exit, timeout, spawn failure, or a transformation
  that the local patch policy rejects blocks the proposal. Blocked outcomes
  surface as `patch_not_allowed` (test proposal) or an empty patch with all
  violations reported as unfixed (lint/type fixes), or `invalid_output` (docs).
- **Transforms are re-validated:** a hook that rewrites the patch has its
  output revalidated by the same local patch policy before delivery.
- **Bounds:** at most `POST_PROCESSING_HOOKS_MAX` (8) hooks, each with a
  command, up to 128 args, and an optional `timeout_ms` between 1 and
  `POST_PROCESSING_HOOK_TIMEOUT_MS_MAX` (120 s, default 30 s). Captured
  stdout/stderr is capped at 256 KiB to keep diagnostics bounded.
- **New feature boundary:** `src/features/post-processing` exposes
  `PostProcessingService`, `PostProcessingAdapters`, and
  `createPostProcessingRunner` behind the public `index.ts`; the MCP server
  injects a runner per tool call through `taskDependencies`.
- **Sandboxed auto-validate is unchanged:** the `auto_validate_tests` internal
  revalidation loop stays a separate sandbox and does not re-run project hooks.

## Acceptance Criteria

- [x] Hooks execute only when explicitly configured.
- [x] Hooks run against generated patches and never write to the repository.
- [x] Hook failure fails closed and blocks the proposal.
- [x] `npm run validate` green (438 tests).

## Files Changed

- `src/features/post-processing/{contracts.ts,runner.ts,index.ts}` (NEW —
  service port, adapters, runner with process-group timeout handling)
- `src/features/configuration/configuration.ts` (MODIFIED — `PostProcessingHookSchema`,
  `PostProcessingHooksSchema`, `post_processing_hooks` in preference schemas,
  effective value + origin resolution)
- `src/features/configuration/mutation.ts` (MODIFIED — `post_processing_hooks`
  mutable field with set/`null`-to-clear semantics)
- `src/features/configuration/constants.ts` (MODIFIED — hook count/timeout/
  capture bounds)
- `src/features/test-proposal/proposal.ts` (MODIFIED — run hooks after patch
  validation; blocked → `patch_not_allowed`)
- `src/features/lint-fix/fix.ts` (MODIFIED — hooks before reconcile; blocked →
  empty patch with violations unfixed)
- `src/features/docs-generation/generate.ts` (MODIFIED — hooks after patch
  build; blocked → `invalid_output`; revalidate on transform)
- `src/features/mcp-server/server.ts` (MODIFIED — `postProcessing` runner in
  `taskDependencies`; hooks passed to the four patch tools)
- `test/post-processing.test.ts` (NEW — runner behavior with fake adapters)
- `test/test-proposal.test.ts`, `test/lint-fix.test.ts`,
  `test/docs-generation.test.ts` (MODIFIED — blocked/transform integration)
- `test/configuration-mutation.test.ts` (MODIFIED — hook set/clear/reject)
