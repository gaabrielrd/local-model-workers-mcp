# ADR-0015: Surface error-rate observability through `get_offload_stats`

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

An operator today knows the system's throughput (`get_offload_stats`) but has
no aggregated view of failures. Problems surface only when tasks start timing
out, which is late. The circuit breaker, the router, and the operational log
all know about failures in isolation, but nothing composes them into a
degradation signal.

The existing stats surface already defines week, month, and lifetime windows
over metadata-only operational events. Two structural constraints shape the
design:

1. **Raw events are pruned after seven days.** Weekly, monthly, and lifetime
   windows must still mean something after that pruning.
2. **The router is the only place that knows which provider served a request**
   and how many providers were attempted, but task terminal metadata — the
   input to the operational log — is built by the task runtime, which sits
   above the router.

## Decision

Extend the existing `get_offload_stats` tool with an additive `reliability`
section and feed it from two sources.

1. **Durable daily rollup.** Every recorded event is rolled up into a single
   owner-only `rollup.json` keyed by UTC day, holding only numbers, status
   names, error codes, and provider names. The rollup survives the seven-day
   event pruning (retained 400 days), so month and lifetime failure windows
   stay correct. Logs written before this feature fall back to the raw events
   still on disk.
2. **Provider and retry attribution at the router boundary.** The router's
   `execute` attaches the serving provider and the retry count (adapter-internal
   retries reported by the adapters plus provider failovers) to every result,
   and attaches the failing provider to the error it throws when every
   candidate is transient. The task runtime captures both and includes them in
   the terminal metadata, where they flow into the operational log.
3. **Live breaker state, not a proxy.** `ProviderStatus` gains `circuit_state`
   read from the actual `CircuitBreaker.getState()` (`closed`/`open`/
   `half-open`), and `get_offload_stats` reports it per provider so an open
   circuit is visible even before the cumulative counts catch up.
4. **Metadata-only by construction.** Counters, error codes, and provider names
   carry no repository content, prompts, or credentials. The redaction and
   content-filtering boundaries are unchanged.

## Consequences

- `get_offload_stats` returns one tool for both throughput and reliability;
  existing token-savings fields, response shape, and schemas are unchanged
  (additive only).
- Failure and retry counts split per provider in multi-provider setups, so an
  unhealthy backend is attributable.
- The router is now the single attribution point: both the serving provider on
  success and the failing provider on total failure are named there, so
  attribution cannot drift between features.
- Reliability counts and token-savings counts use different time sources
  (rollup vs. pruned raw events). This is intentional: the rollup exists
  precisely to keep failure history beyond the raw retention window.
- A corrupt or missing rollup restarts accumulation; observability never breaks
  a task.

## Alternatives considered

- **Count failures only from raw events.** Simpler, but month and lifetime
  windows collapse to seven days once pruning runs, defeating the purpose.
- **Derive circuit state from health status.** Healthy/unhealthy already exists
  but is a proxy; an open circuit is not the same as an unhealthy status probe,
  and half-open would be invisible. Reading the breaker directly is exact.
- **A separate metrics tool.** Keeps concerns apart but multiplies the
  operator-facing surface and duplicates the window logic; the task direction
  was explicitly to extend the existing stats surface.
