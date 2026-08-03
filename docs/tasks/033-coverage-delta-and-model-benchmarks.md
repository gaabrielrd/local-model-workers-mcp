# Task 033: Coverage Delta & Local Model Quality Benchmarks

**Status:** In Progress
**Depends on:** Tasks 015, 026, 030
**PRD coverage:** CAP-09 & Quality Benchmarking

## Objective

Provide coverage delta tracking and automated local model quality benchmarking for test proposal and patch generation.

## Requirements

1. **Coverage Delta Tracking**:
   - In `src/features/auto-validate/`, measure line coverage deltas before and after executing test proposal suites.
2. **Local Model Benchmark Harness**:
   - Expose benchmark runner script `scripts/benchmark-local-models.ts` that evaluates candidate models (e.g. Qwen 2.5/3.5, DeepSeek R1/Coder, Llama 3) against fixture tasks (exploration, lint fixing, test proposal).
3. **Documentation & Validation**:
   - Update `docs/mcp-tools.md` with all 14 MCP tools.
   - Run `npm run validate`.
