# Operational logging

**Status:** Implemented  
**Last reviewed:** 2026-08-05

Operational logs are local, metadata-only records. The lifecycle exposes a
narrow terminal observer containing exactly:

- `task_id`;
- `started_at_ms`, `ended_at_ms`, and `duration_ms`;
- `model`;
- terminal `status`;
- nullable `error_code`;
- optional `provider` (the provider that served the task's inference, set by
  the router when attributable); and
- optional `retry_count` (retry attempts performed by the inference layer for
  the task, set when greater than zero).

The runtime schema rejects unknown keys, control characters, inconsistent
timestamps, status/error mismatches, and identifiers longer than 256 ASCII
characters. There is no message, exception, arbitrary metadata, goal, path,
prompt, response, evidence, patch, token, or header field. Observer failures are
absorbed and cannot change a task result. The adapter never writes stdout.

## Durable rollup

Raw events are pruned after seven days, but the weekly/monthly/lifetime
`get_offload_stats` windows must outlive that. Each recorded event is therefore
also rolled up into a single owner-only `rollup.json` summary keyed by UTC day.
The rollup holds only numbers, status names, error codes, and provider names —
never repository content — and is retained for 400 days. A missing or corrupt
rollup restarts accumulation rather than failing the task that triggered it;
logs written before this feature fall back to the raw events still on disk.

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
