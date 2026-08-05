# Task 056: Error-Rate Observability

**Status:** Implemented (v2.12.0)
**Depends on:** Task 032 (token offload stats), Task 013 (operational logging)

## Objective

Give an operator a degradation signal — failure counts, retry counts, and
circuit-breaker state — so problems surface before users start seeing task
timeouts. Today the system knows its throughput (`get_offload_stats`) but has no
aggregated view of failures.

## Key Design Decisions

- **Extend the existing stats surface:** `get_offload_stats` gains a
  failure/retry/breaker section over the same week, month, and lifetime windows
  already documented, keeping one tool for offload observability.
- **Metadata-only by construction:** counters and breaker states carry no
  repository content, prompts, or outputs; the operational-logging allowlist
  and redaction rules are unchanged.
- **Per-provider breakdown:** in multi-provider setups the failure and retry
  counts split by provider so an unhealthy backend is attributable.
- **Breaker state surfaced:** the current open/closed/half-open state and
  cooldown status are reported, not just cumulative counts.
- **Backward compatible:** existing stats fields and response shape are
  preserved; the new section is additive.

## Acceptance Criteria

- [x] Failure, retry, and breaker-state metrics aggregate over week, month, and
      lifetime windows.
- [x] Multi-provider failures are attributed per provider.
- [x] No repository content or credentials enter the metrics.
- [x] Existing `get_offload_stats` fields and schemas unchanged.
- [x] `npm run validate` green.

## Implementation notes

- `rollup.json` (owner-only, retained 400 days) rolls every event up by UTC day
  so month/lifetime windows survive the seven-day raw-event pruning; logs from
  before the feature fall back to raw events.
- The router (`execute`) attaches `provider` and `retries` (adapter-internal
  retries plus provider failovers) to inference results and the failing provider
  to the error thrown when every candidate is transient; the task runtime
  captures both into `TaskTerminalMetadata`.
- `ProviderStatus` exposes the real `circuit_state` from the breaker
  (`closed`/`open`/`half-open`), surfaced per provider in the reliability
  section.

See [ADR-0015](../decisions/0015-error-rate-observability.md).

## Files Changed (anticipated)

- `src/features/operational-logging/` (MODIFIED — failure/retry counters and
  breaker-state capture)
- `src/features/mcp-server/` tools registration (MODIFIED — extended stats
  output)
- `test/` (MODIFIED — stats assertions)
- `docs/mcp-tools.md`, `docs/operational-logging.md` (MODIFIED — documented
  metrics)
- `docs/tasks/056-error-rate-observability.md` (NEW — this document)
