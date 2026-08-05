# Task 056: Error-Rate Observability

**Status:** Planned (v2.12.0)
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

- [ ] Failure, retry, and breaker-state metrics aggregate over week, month, and
      lifetime windows.
- [ ] Multi-provider failures are attributed per provider.
- [ ] No repository content or credentials enter the metrics.
- [ ] Existing `get_offload_stats` fields and schemas unchanged.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/operational-logging/` (MODIFIED — failure/retry counters and
  breaker-state capture)
- `src/features/mcp-server/` tools registration (MODIFIED — extended stats
  output)
- `test/` (MODIFIED — stats assertions)
- `docs/mcp-tools.md`, `docs/operational-logging.md` (MODIFIED — documented
  metrics)
- `docs/tasks/056-error-rate-observability.md` (NEW — this document)
