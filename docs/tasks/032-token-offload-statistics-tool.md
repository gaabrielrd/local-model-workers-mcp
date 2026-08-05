# Task 032: Token Offload Statistics Tool (`get_offload_stats`)

**Status:** Completed
**Depends on:** Tasks 013, 026
**PRD coverage:** CAP-08 & Token Savings Observability

## Objective

Expose an operational MCP tool `get_offload_stats` that calculates and returns aggregated token savings metrics over time (this week, this month, and lifetime/over time), fulfilling the user directive:
> *"quero que a economia de tokens seja uma estatistica acompanhavel com o tempo, mostrando ganhos da semana, mes, e over time"*

## Requirements

1. **Contracts & Schemas**:
   - `GetOffloadStatsInputSchema`: optional `period` filter (`"week" | "month" | "lifetime" | "all"`, default `"all"`).
   - Return schema:
     ```ts
     {
       weekly: { tokens_saved: number, queries_offloaded: number },
       monthly: { tokens_saved: number, queries_offloaded: number },
       lifetime: { tokens_saved: number, queries_offloaded: number },
       period_breakdown: Record<string, { tokens_saved: number, queries_offloaded: number }>
     }
     ```
2. **Persistence & Aggregation**:
   - Extend `OperationalLogStore` in `src/features/operational-logging/` to query lifecycle log events and aggregate prompt & output token estimates offloaded to local models instead of remote cloud LLMs.
3. **MCP Tool Registration**:
   - Register `TOOL_NAMES.getOffloadStats = "get_offload_stats"` under administrative/observability tools.
4. **Validation**:
   - Add unit tests verifying calculation of weekly, monthly, and lifetime offload statistics.
   - Run `npm run validate`.
