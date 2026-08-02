# Operational logging

**Status:** Implemented  
**Last reviewed:** 2026-08-02

Operational logs are local, metadata-only records. The lifecycle exposes a
narrow terminal observer containing exactly:

- `task_id`;
- `started_at_ms`, `ended_at_ms`, and `duration_ms`;
- `model`;
- terminal `status`; and
- nullable `error_code`.

The runtime schema rejects unknown keys, control characters, inconsistent
timestamps, status/error mismatches, and identifiers longer than 256 ASCII
characters. There is no message, exception, arbitrary metadata, goal, path,
prompt, response, evidence, patch, token, or header field. Observer failures are
absorbed and cannot change a task result. The adapter never writes stdout.

## Locations

- macOS: `~/Library/Logs/local-model-workers-mcp`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/local-model-workers-mcp/logs`
- Windows: `%LOCALAPPDATA%\\local-model-workers-mcp\\logs`

Each event is written with exclusive creation as an owner-only
`event-<ended_at_ms>-<random-id>.json` file. Separate files avoid interleaved
JSON when multiple MCP processes finish tasks concurrently.

## Retention and failures

The protected retention period is exactly seven 24-hour days. Cleanup deletes
only direct regular files matching the exact event filename pattern whose
timestamp is strictly older than `now - seven days`; a record exactly on the
boundary is retained. Malformed matching records can therefore still expire by
their filename without parsing untrusted contents. Unrelated files,
subdirectories, and nonmatching names are never cleanup targets.

Write, inspection, malformed-record, permission, and cleanup failures must not
be copied into task diagnostics or alter terminal task results. Troubleshoot by
checking ownership and permissions of the platform location; do not paste log
directory contents into MCP stdout.
