# Task 044: Live Hot-Reload Configuration

**Status:** Implemented (v2.2.0)
**Depends on:** Tasks 003, 040 (completed)

## Objective

Add file-watcher integration that applies configuration and profile changes
instantly without restarting the MCP server process, using atomic swaps that
never apply a partial file.

## Key Design Decisions

- New `createConfigurationReloader` in `src/features/mcp-server/config-reload.ts`
  with plain-object ports (`ConfigReloadWatchPort`, `ConfigReloadClock`) and node
  defaults injected via options.
- The reloader watches the **global preferences file** (`fs.watchFile` path-based
  polling, robust to the atomic temp+rename swap and to file creation; also
  portable to WSL2). Only the runtime-level snapshot is watched: per-task
  configuration already re-resolves from disk on every task via
  `taskDependencies`, and providers come from protected environment settings, so
  they are not file-watchable.
- `resolveConfiguration` re-runs `getEffectiveConfiguration`; a successful result
  atomically swaps the runtime's live configuration via a new
  `McpApplicationRuntime.currentConfiguration()` / `applyConfiguration()` pair.
- Fail-closed: invalid or malformed changes reject and keep the previous
  configuration; the outcome carries the error and the last applied revision.
- Overlapping reloads coalesce into a single resolution.
- Notifications use the stderr diagnostic writer (`[config] Configuration
  reloaded (...)`, `[config] Configuration reload rejected; ...`), consistent with
  process supervision. Operational events remain task-terminal-only.
- `checkHealth` reads the live configuration instead of the frozen startup
  snapshot. `serveMcpStdio` restarts the supervisor when supervision thresholds
  change on reload.
- `profile` is schema-only (semantics deferred to task 048); a profile change in
  the file still re-resolves and swaps the snapshot.

## Acceptance Criteria

- [x] Config/profile file changes apply live without a server restart.
- [x] Atomic swaps guarantee a partial file is never applied.
- [x] Invalid changes fail closed and keep the previous configuration active.
- [x] `npm run validate` green.

## Files Changed

- `src/features/mcp-server/config-reload.ts` (new): reloader core.
- `src/features/mcp-server/server.ts`: runtime live-configuration accessors,
  `checkHealth` live read, `serveMcpStdio` reloader + supervisor re-application.
- `src/features/mcp-server/index.ts`: exports reloader types.
- `test/config-reload.test.ts` (new): 7 unit tests.
